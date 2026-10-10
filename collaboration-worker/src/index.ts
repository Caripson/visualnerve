import { canonical, relayLimits } from "./protocol";
import { CollaborationRoom, readJson, response, type RelayEnv } from "./room";
import { record, RelayError, roomId, signedPolicy } from "./validation";
export { CollaborationRoom };

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed =
      !!origin &&
      env.ALLOWED_ORIGINS.split(",")
        .map((value) => value.trim())
        .includes(origin);
    let result: Response;
    try {
      const url = new URL(request.url);
      if (url.search) throw new RelayError("QUERY_FORBIDDEN", 400);
      if (url.pathname === "/health" && request.method === "GET") {
        result = response(200, {
          protocol: 1,
          enabled: env.ENABLED === "true",
          capabilities: [
            "mls-opaque-relay",
            "device-proof-of-possession",
            "owner-signed-policy",
            "one-use-invitations",
            "no-document-retention",
          ],
          limits: relayLimits,
        });
      } else if (!allowed) throw new RelayError("ORIGIN_FORBIDDEN", 403);
      else if (env.ENABLED !== "true")
        throw new RelayError("COLLABORATION_DISABLED", 503);
      else if (request.method === "OPTIONS") {
        const headers = request.headers.get("Access-Control-Request-Headers");
        if (
          request.headers.get("Access-Control-Request-Method") !== "POST" ||
          (headers && headers.toLowerCase() !== "content-type")
        )
          throw new RelayError("PREFLIGHT_FORBIDDEN", 403);
        result = new Response(null, { status: 204 });
      } else {
        const ip = request.headers.get("CF-Connecting-IP") ?? "local";
        if (
          !(await env.ADMISSION_RATE.limit({ key: `${request.method}:${ip}` }))
            .success
        )
          throw new RelayError("ADMISSION_RATE_LIMIT", 429);
        let id: string;
        let forwarded = request;
        if (url.pathname === "/v1/rooms" && request.method === "POST") {
          const input = record(await readJson(request, 64 * 1024), ["policy"]);
          id = signedPolicy(input.policy).policy.roomId;
          forwarded = new Request(request, { body: canonical(input) });
        } else {
          const path = /^\/v1\/rooms\/([^/]+)\/socket$/.exec(url.pathname);
          if (!path || request.method !== "GET")
            throw new RelayError("NOT_FOUND", 404);
          id = roomId(path[1]);
        }
        result = await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(forwarded);
        if (result.status === 101) return result;
      }
    } catch (error) {
      result = response(error instanceof RelayError ? error.status : 500, {
        protocol: 1,
        error: {
          code: error instanceof RelayError ? error.code : "RELAY_FAILURE",
        },
      });
    }
    if (allowed) {
      const headers = new Headers(result.headers);
      headers.set("Access-Control-Allow-Origin", origin!);
      headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Methods", "POST");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      result = new Response(result.body, { status: result.status, headers });
    }
    return result;
  },
} satisfies ExportedHandler<RelayEnv>;
