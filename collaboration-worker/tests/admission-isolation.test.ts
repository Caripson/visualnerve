import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { relayLimits } from "../src/protocol";
import { Client, clients, create, device, fetchRelay, pending } from "./helpers";

afterEach(() => {
  for (const client of [...clients]) client.close();
});

function closed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) resolve();
    else socket.addEventListener("close", () => resolve(), { once: true });
  });
}

describe("unauthenticated admission resource isolation", () => {
  it("closes invalid unauthenticated JSON without charging another device admission budget", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    const { invitation } = await owner.invite();
    const malformed = await Client.open(fixture, await device());
    const rejection = closed(malformed.socket);
    malformed.socket.send("invalid-json");
    await rejection;
    const joiner = await Client.open(fixture, await device());
    await joiner.authenticate(invitation);
    const request = await owner.next("join-request");
    expect(request.request.deviceId).toBe(joiner.device.identity.deviceId);
  });

  it("replaces only the oldest unproved challenge so an approved member can reconnect", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    const joining = await pending(owner);
    const unknown: Client[] = [];
    for (let index = 0; index < relayLimits.preAuthenticationSockets; index++)
      unknown.push(await Client.open(fixture));
    const oldestClosed = closed(unknown[0].socket);

    const reconnecting = await (await Client.open(fixture)).authorized();
    await oldestClosed;

    expect(owner.socket.readyState).toBe(WebSocket.OPEN);
    expect(joining.socket.readyState).toBe(WebSocket.OPEN);
    for (const remaining of unknown.slice(1))
      expect(remaining.socket.readyState).toBe(WebSocket.OPEN);
    expect(reconnecting.socket.readyState).toBe(WebSocket.OPEN);
    await reconnecting.command({ kind: "inspect" });
    expect((await reconnecting.next("ack")).result).toMatchObject({
      connected: [fixture.owner.identity.deviceId],
      pending: [{ deviceId: joining.device.identity.deviceId }],
    });
  });

  it("bounds rolling unknown challenges in the native runtime across many source addresses", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    const unknown: Client[] = [];
    // More attempts than the complete room socket limit. IPs are deliberately
    // independent: the room bound must not rely on one network identity.
    for (let index = 0; index < relayLimits.sockets + 8; index++) {
      unknown.push(await Client.open({ ...fixture, ip: crypto.randomUUID() }));
      const sockets = await runInDurableObject(fixture.stub, (_instance, ctx) => ({
        active: ctx.getWebSockets().filter((socket) =>
          socket.readyState === WebSocket.OPEN,
        ).length,
        total: ctx.getWebSockets().length,
      }));
      expect(sockets.active).toBeLessThanOrEqual(
        relayLimits.preAuthenticationSockets + 1,
      );
      expect(sockets.total).toBeLessThanOrEqual(relayLimits.sockets);
    }
    const reconnecting = await (await Client.open(fixture)).authorized();
    expect(reconnecting.socket.readyState).toBe(WebSocket.OPEN);
    expect(owner.socket.readyState).toBe(WebSocket.OPEN);
    await reconnecting.command({ kind: "inspect" });
    expect((await reconnecting.next("ack")).result).toMatchObject({
      connected: [fixture.owner.identity.deviceId],
    });
  });

  it("counts withheld close handshakes against the hard cap without evicting authenticated participants", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    const unproved: Client[] = [];
    // This disposable native peer intentionally opts out of auto-reply to
    // simulate an external socket that receives our Close and never echoes it.
    // Enabling auto-reply on the relay cannot force that peer to cooperate.
    for (let index = 0; index < relayLimits.sockets - 1; index++) {
      unproved.push(
        await Client.open(
          { ...fixture, ip: crypto.randomUUID() },
          fixture.owner,
          { allowHalfOpen: true },
        ),
      );
    }
    expect(unproved[0].socket.readyState).toBe(WebSocket.CLOSING);
    const occupancy = await runInDurableObject(fixture.stub, (_instance, ctx) => ({
      total: ctx.getWebSockets().length,
      closing: ctx.getWebSockets().filter((socket) =>
        socket.readyState === WebSocket.CLOSING,
      ).length,
    }));
    expect(occupancy.total).toBe(relayLimits.sockets);
    expect(occupancy.closing).toBeGreaterThan(0);

    const refused = await fetchRelay(
      `/v1/rooms/${fixture.id}/socket`,
      { headers: { Upgrade: "websocket" } },
      crypto.randomUUID(),
    );
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      error: { code: "SOCKET_LIMIT" },
    });
    expect(owner.socket.readyState).toBe(WebSocket.OPEN);
    await owner.command({ kind: "inspect" });
    expect((await owner.next("ack")).result).toMatchObject({
      connected: [fixture.owner.identity.deviceId],
    });
  });
});
