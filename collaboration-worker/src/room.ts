import { DurableObject } from "cloudflare:workers";
import { MembershipTransition } from "./membership";
import {
  DeviceRateLedger,
  deviceRateLimits,
  type PublicDeviceRate,
} from "./device-rate";
import { binaryHash, tokenHash, verify, verifyIdentity } from "./auth";
import {
  canonical,
  relayLimits,
  type Authentication,
  type Challenge,
  type DeviceIdentity,
  type PendingJoin,
  type ServerFrame,
  type SignedCommand,
  type SignedRoomPolicy,
} from "./protocol";
import {
  decode,
  deviceId,
  encode,
  identity,
  integer,
  record,
  RelayError,
  roomId,
  sameIdentity,
  signedPolicy,
} from "./validation";

export interface RelayEnv {
  ROOMS: DurableObjectNamespace<CollaborationRoom>;
  ADMISSION_RATE: RateLimit;
  ALLOWED_ORIGINS: string;
  ENABLED: string;
}
interface Invitation {
  hash: string;
  expiresAt: number;
  revision: number;
}
interface RoomRecord {
  policy: SignedRoomPolicy;
  invitations: Invitation[];
  pending: PendingJoin[];
  createdAt: number;
  lastActive: number;
}
interface SocketState {
  challenge: Challenge;
  device?: DeviceIdentity;
  authenticated: boolean;
  pending: boolean;
  sequence: number;
  rateWindow: number;
  rateCount: number;
  rateBytes: number;
}
export function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function readJson(
  request: Request,
  maximum: number,
): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new RelayError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new RelayError("JSON_REQUIRED");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new RelayError("PAYLOAD_LIMIT", 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError("INVALID_JSON");
  }
}
export class CollaborationRoom extends DurableObject<RelayEnv> {
  private room?: RoomRecord;
  private deleted = false;
  private deleteUntil = 0;
  private deviceRates = new DeviceRateLedger();
  constructor(ctx: DurableObjectState, env: RelayEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get<RoomRecord>("room");
      this.deleteUntil = (await ctx.storage.get<number>("deleted")) ?? 0;
      this.deleted = this.deleteUntil > 0;
      this.deviceRates = new DeviceRateLedger(
        (await ctx.storage.get<PublicDeviceRate[]>("device-rate")) ?? [],
      );
    });
  }
  async fetch(request: Request): Promise<Response> {
    try {
      await this.expireIfNeeded();
      if (this.deleted) throw new RelayError("ROOM_CLOSED", 410);
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/rooms") {
        return await this.ctx.blockConcurrencyWhile(async () => {
          try {
            if (this.room) throw new RelayError("ROOM_EXISTS", 409);
            const input = record(await readJson(request, 64 * 1024), [
              "policy",
            ]);
            const initial = signedPolicy(input.policy);
            const policy = initial.policy;
            if (
              policy.epoch !== 0 ||
              policy.revision !== 1 ||
              policy.members.length !== 1 ||
              policy.transition !== null
            )
              throw new RelayError("INVALID_INITIAL_POLICY");
            const owner = policy.members[0];
            await verifyIdentity(owner);
            await verify(owner.signingKey, "policy", policy, initial.signature);
            this.room = {
              policy: initial,
              invitations: [],
              pending: [],
              createdAt: Date.now(),
              lastActive: Date.now(),
            };
            await this.save();
            await this.scheduleAlarm(
              this.room.lastActive + relayLimits.roomIdleMs,
            );
            return response(201, {
              protocol: 1,
              roomId: policy.roomId,
              policy: initial,
              limits: relayLimits,
            });
          } catch (error) {
            return this.failure(error);
          }
        });
      }
      const path = /^\/v1\/rooms\/([^/]+)\/socket$/.exec(url.pathname);
      if (!path || request.method !== "GET")
        throw new RelayError("NOT_FOUND", 404);
      roomId(path[1]);
      if (!this.room || this.room.policy.policy.roomId !== path[1])
        throw new RelayError("NOT_FOUND", 404);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        throw new RelayError("WEBSOCKET_REQUIRED", 426);
      if (this.ctx.getWebSockets().length >= relayLimits.sockets)
        throw new RelayError("SOCKET_LIMIT", 429);
      const pair = new WebSocketPair();
      const challenge: Challenge = {
        type: "challenge",
        protocol: 1,
        roomId: path[1],
        connectionId: crypto.randomUUID(),
        nonce: encode(crypto.getRandomValues(new Uint8Array(32))),
        expiresAt: Date.now() + relayLimits.challengeMs,
      };
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({
        challenge,
        authenticated: false,
        pending: false,
        sequence: 0,
        rateWindow: Date.now(),
        rateCount: 0,
        rateBytes: 0,
      } satisfies SocketState);
      this.send(pair[1], challenge);
      await this.scheduleAlarm(challenge.expiresAt);
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch (error) {
      return this.failure(error);
    }
  }
  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    // WebCrypto yields; serialize authorization and ACL transitions explicitly.
    await this.ctx.blockConcurrencyWhile(async () => {
      let sequence: number | undefined;
      try {
        await this.expireIfNeeded();
        if (!this.room || this.deleted)
          throw new RelayError("ROOM_CLOSED", 410);
        if (typeof message !== "string")
          throw new RelayError("PAYLOAD_LIMIT", 413);
        const messageBytes = new TextEncoder().encode(message).length;
        if (
          message.length > relayLimits.envelopeBytes ||
          messageBytes > relayLimits.envelopeBytes
        )
          throw new RelayError("PAYLOAD_LIMIT", 413);
        const state = this.state(socket);
        await this.rate(state, messageBytes);
        // Account for rejected JSON too: attachments are deserialized copies,
        // and parsing failure must not provide an unmetered open connection.
        socket.serializeAttachment(state);
        let frame: unknown;
        try {
          frame = JSON.parse(message);
        } catch {
          throw new RelayError("INVALID_JSON");
        }
        if (!state.authenticated) {
          if (state.pending)
            throw new RelayError("OWNER_APPROVAL_REQUIRED", 403);
          await this.authenticate(socket, state, frame);
          return;
        }
        const object = record(frame, [
          "type",
          "protocol",
          "roomId",
          "connectionId",
          "deviceId",
          "sequence",
          "epoch",
          "body",
          "signature",
        ]);
        sequence = integer(object.sequence, 1);
        if (
          object.type !== "command" ||
          object.protocol !== 1 ||
          object.roomId !== this.room.policy.policy.roomId ||
          object.connectionId !== state.challenge.connectionId ||
          object.deviceId !== state.device?.deviceId
        )
          throw new RelayError("INVALID_AUTHORITY", 403);
        if (sequence !== state.sequence + 1)
          throw new RelayError("SEQUENCE_REPLAY", 409);
        const member = this.room.policy.policy.members.find(
          (member) => member.deviceId === state.device!.deviceId,
        );
        if (!member || !sameIdentity(member, state.device!))
          throw new RelayError("MEMBERSHIP_REVOKED", 403);
        const { signature, ...unsigned } = object;
        await verify(member.signingKey, "command", unsigned, String(signature));
        if (Date.now() - this.room.lastActive >= 60_000) {
          this.room.lastActive = Date.now();
          await this.save();
        }
        const command = object as unknown as SignedCommand;
        // Even a rejected authorized command consumes its sequence; retry must use
        // a fresh signed envelope and reconcile any unknown transition first.
        state.sequence = sequence;
        socket.serializeAttachment(state);
        // Authenticate and consume the sequence before rejecting an old epoch:
        // an approved device may already have sent its next command while the
        // owner's membership transition was in flight. A rejected old write
        // must not leave that connection's sequence permanently behind.
        // A timed-out membership write may already have advanced the durable
        // epoch. Its still-approved signer can inspect the public policy before
        // deciding whether to merge its locally pending commit.
        const requestedEpoch = integer(object.epoch);
        const readPolicy =
          object.body !== null &&
          typeof object.body === "object" &&
          !Array.isArray(object.body) &&
          (object.body as { kind?: unknown }).kind === "inspect";
        if (
          requestedEpoch !== this.room.policy.policy.epoch &&
          !(readPolicy && requestedEpoch < this.room.policy.policy.epoch)
        )
          throw new RelayError("STALE_EPOCH", 409);
        const body = command.body;
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new RelayError("INVALID_COMMAND");
        if (body.kind === "relay") {
          const payload = record(
            body,
            ["kind", "payloadKind", "ciphertext"],
            ["recipient"],
          );
          if (
            !["application", "presence", "snapshot", "sync-request"].includes(
              String(payload.payloadKind),
            )
          )
            throw new RelayError("INVALID_PAYLOAD_KIND");
          decode(payload.ciphertext, relayLimits.ciphertextBytes);
          if (payload.recipient !== undefined) deviceId(payload.recipient);
          if (
            member.role === "viewer" &&
            ["application", "snapshot"].includes(body.payloadKind)
          )
            throw new RelayError("ROLE_FORBIDDEN", 403);
          if (
            body.recipient &&
            !this.room.policy.policy.members.some(
              (member) => member.deviceId === body.recipient,
            )
          )
            throw new RelayError("UNKNOWN_RECIPIENT");
          this.broadcast(
            { type: "relay", protocol: 1, command },
            socket,
            body.recipient,
          );
          this.ack(socket, sequence);
          return;
        }
        if (body.kind === "inspect") {
          record(body, ["kind"]);
          this.ack(socket, sequence, {
            policy: this.room.policy,
            pending: member.role === "owner" ? this.room.pending : [],
            connected: this.connected(),
          });
          return;
        }
        if (body.kind === "leave") {
          record(body, ["kind"]);
          this.ack(socket, sequence);
          socket.close(1000, "Left room");
          return;
        }
        if (member.role !== "owner")
          throw new RelayError("OWNER_REQUIRED", 403);
        if (body.kind === "invite") {
          record(body, ["kind"]);
          this.prune();
          if (this.room.invitations.length >= relayLimits.invitations)
            throw new RelayError("INVITATION_LIMIT", 429);
          const invitation = encode(crypto.getRandomValues(new Uint8Array(32)));
          const expiresAt = Date.now() + relayLimits.invitationMs;
          this.room.invitations.push({
            hash: await tokenHash(invitation),
            expiresAt,
            revision: this.room.policy.policy.revision,
          });
          await this.save();
          await this.scheduleAlarm(expiresAt);
          this.ack(socket, sequence, {
            invitation,
            expiresAt,
            roomId: this.room.policy.policy.roomId,
          });
        } else if (body.kind === "reject") {
          record(body, ["kind", "deviceId"]);
          deviceId(body.deviceId);
          this.room.pending = this.room.pending.filter(
            (pending) => pending.deviceId !== body.deviceId,
          );
          await this.save();
          this.closePending(body.deviceId, "JOIN_REJECTED");
          this.ack(socket, sequence);
        } else if (body.kind === "revoke-invitations") {
          record(body, ["kind"]);
          this.room.invitations = [];
          await this.save();
          this.ack(socket, sequence);
        } else if (body.kind === "policy") {
          await this.transition(socket, command, sequence);
        } else if (body.kind === "welcome") {
          record(body, ["kind", "recipient", "ciphertext", "commit"]);
          deviceId(body.recipient);
          const hash = await binaryHash(
            decode(body.ciphertext, relayLimits.ciphertextBytes),
          );
          const expected =
            this.room.policy.policy.transition?.welcomeHashes.find(
              (entry) => entry.deviceId === body.recipient,
            );
          if (
            !expected ||
            expected.hash !== hash ||
            (await binaryHash(
              decode(body.commit, relayLimits.ciphertextBytes),
            )) !== this.room.policy.policy.transition?.commitHash
          )
            throw new RelayError("WELCOME_MISMATCH");
          this.broadcast(
            {
              type: "welcome",
              protocol: 1,
              policy: this.room.policy,
              commit: body.commit,
              ciphertext: body.ciphertext,
            },
            socket,
            body.recipient,
          );
          this.ack(socket, sequence);
        } else if (body.kind === "delete-room") {
          record(body, ["kind"]);
          await this.erase();
          this.ack(socket, sequence);
          for (const peer of this.ctx.getWebSockets())
            peer.close(1000, "Room closed");
        } else throw new RelayError("INVALID_COMMAND");
      } catch (error) {
        this.send(socket, {
          type: "error",
          protocol: 1,
          code: error instanceof RelayError ? error.code : "RELAY_FAILURE",
          ...(sequence === undefined ? {} : { sequence }),
        });
        if (
          !(error instanceof RelayError) ||
          [401, 403, 413].includes(error.status) ||
          error.code === "RATE_LIMIT"
        )
          socket.close(1008, "Authorization rejected");
      }
    });
  }
  private async authenticate(
    socket: WebSocket,
    state: SocketState,
    frame: unknown,
  ) {
    const object = record(
      frame,
      [
        "type",
        "protocol",
        "roomId",
        "connectionId",
        "nonce",
        "device",
        "signature",
      ],
      ["invitation", "keyPackage"],
    );
    const auth = object as unknown as Authentication;
    if (
      auth.type !== "authenticate" ||
      auth.protocol !== 1 ||
      auth.roomId !== state.challenge.roomId ||
      auth.connectionId !== state.challenge.connectionId ||
      auth.nonce !== state.challenge.nonce ||
      Date.now() >= state.challenge.expiresAt
    )
      throw new RelayError("CHALLENGE_REJECTED", 403);
    const device = identity(auth.device);
    await verifyIdentity(device);
    const { signature, ...unsigned } = auth;
    await verify(device.signingKey, "authenticate", unsigned, signature);
    const member = this.room!.policy.policy.members.find(
      (member) => member.deviceId === device.deviceId,
    );
    if (member && !sameIdentity(member, device))
      throw new RelayError("IDENTITY_MISMATCH", 403);
    if (
      this.ctx
        .getWebSockets()
        .filter((peer) => this.state(peer).device?.deviceId === device.deviceId)
        .length >= relayLimits.socketsPerDevice
    )
      throw new RelayError("DEVICE_SOCKET_LIMIT", 429);
    if (member) {
      if (auth.invitation !== undefined || auth.keyPackage !== undefined)
        throw new RelayError("UNEXPECTED_JOIN_DATA");
      state.device = device;
      state.authenticated = true;
      socket.serializeAttachment(state);
      this.send(socket, {
        type: "authenticated",
        protocol: 1,
        policy: this.room!.policy,
        role: member.role,
      });
      return;
    }
    this.prune();
    decode(auth.invitation, 32, 32);
    decode(auth.keyPackage, relayLimits.keyPackageBytes);
    const hash = await tokenHash(auth.invitation!);
    const invitation = this.room!.invitations.find(
      (invite) =>
        invite.hash === hash &&
        invite.expiresAt > Date.now() &&
        invite.revision === this.room!.policy.policy.revision,
    );
    if (!invitation) throw new RelayError("INVITATION_REJECTED", 403);
    if (
      this.room!.pending.some((pending) => pending.deviceId === device.deviceId)
    )
      throw new RelayError("JOIN_ALREADY_PENDING", 409);
    if (
      this.room!.pending.length >= relayLimits.pendingJoins ||
      this.room!.policy.policy.members.length >= relayLimits.members
    )
      throw new RelayError("MEMBER_LIMIT", 429);
    // Consume exactly once only after all checks, within the serialized event.
    this.room!.invitations = this.room!.invitations.filter(
      (invite) => invite !== invitation,
    );
    const pending: PendingJoin = {
      ...device,
      keyPackage: auth.keyPackage!,
      expiresAt: Date.now() + relayLimits.pendingJoinMs,
    };
    this.room!.pending.push(pending);
    await this.save();
    await this.scheduleAlarm(pending.expiresAt);
    state.device = device;
    state.pending = true;
    socket.serializeAttachment(state);
    this.send(socket, {
      type: "pending",
      protocol: 1,
      expiresAt: pending.expiresAt,
    });
    this.broadcast(
      { type: "join-request", protocol: 1, request: pending },
      undefined,
      this.room!.policy.policy.ownerDeviceId,
    );
  }
  private async transition(
    socket: WebSocket,
    command: SignedCommand,
    sequence: number,
  ) {
    const { body, next, after, added } = await new MembershipTransition(
      this.room!,
      Date.now(),
    ).validate(command.body);
    this.prune();
    this.room!.policy = next;
    this.room!.invitations = [];
    this.room!.pending = this.room!.pending.filter(
      (pending) => !added.includes(pending.deviceId),
    );
    await this.save();
    // Commit durable authorization before acknowledging, then relay only live
    // opaque bytes. No MLS Commit/Welcome/application transcript is persisted.
    this.ack(socket, sequence, { policy: next });
    for (const peer of this.ctx.getWebSockets()) {
      const state = this.state(peer);
      const member = after.members.find(
        (member) => member.deviceId === state.device?.deviceId,
      );
      if (state.authenticated && !member) {
        this.send(peer, {
          type: "error",
          protocol: 1,
          code: "MEMBERSHIP_REVOKED",
        });
        peer.close(1008, "Membership revoked");
        continue;
      }
      const welcome = body.welcomes.find(
        (welcome) => welcome.deviceId === state.device?.deviceId,
      );
      if (state.pending && member && welcome) {
        state.pending = false;
        state.authenticated = true;
        peer.serializeAttachment(state);
        this.send(peer, {
          type: "welcome",
          protocol: 1,
          policy: next,
          commit: body.commit,
          ciphertext: welcome.ciphertext,
        });
        this.send(peer, {
          type: "authenticated",
          protocol: 1,
          policy: next,
          role: member.role,
        });
      } else if (state.authenticated && peer !== socket)
        this.send(peer, {
          type: "policy",
          protocol: 1,
          policy: next,
          commit: body.commit,
        });
    }
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.deleted) {
        if (this.deleteUntil <= Date.now()) {
          await this.ctx.storage.deleteAll();
          this.deleted = false;
          this.deleteUntil = 0;
        } else await this.ctx.storage.setAlarm(this.deleteUntil);
        return;
      }
      await this.expireIfNeeded();
      if (!this.room) return;
      if (this.deviceRates.expire(Date.now())) await this.saveDeviceRates();
      this.prune();
      await this.save();
      let next = Math.min(
        this.room.lastActive + relayLimits.roomIdleMs,
        this.room.createdAt + relayLimits.roomLifetimeMs,
      );
      for (const socket of this.ctx.getWebSockets()) {
        const state = this.state(socket);
        if (!state.authenticated && !state.pending) {
          if (state.challenge.expiresAt <= Date.now())
            socket.close(1008, "Authentication expired");
          else next = Math.min(next, state.challenge.expiresAt);
        }
        if (
          state.pending &&
          !this.room.pending.some(
            (pending) => pending.deviceId === state.device?.deviceId,
          )
        )
          socket.close(1008, "Approval expired");
      }
      for (const pending of this.room.pending)
        next = Math.min(next, pending.expiresAt);
      for (const invite of this.room.invitations)
        next = Math.min(next, invite.expiresAt);
      for (const budget of this.deviceRates.snapshot())
        next = Math.min(next, budget.window + deviceRateLimits.windowMs);
      if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    });
  }
  webSocketClose(socket: WebSocket, code: number, _reason: string) {
    // 1005/1006/1015 are received sentinel codes, never valid outgoing frames.
    try {
      socket.close(
        code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code)
          ? code
          : 1000,
        "Connection closed",
      );
    } catch {
      /* Already closed. */
    }
  }
  webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "Connection closed");
    } catch {
      /* Already closed. */
    }
  }
  private state(socket: WebSocket): SocketState {
    return socket.deserializeAttachment() as SocketState;
  }
  private async rate(state: SocketState, bytes: number) {
    const now = Date.now();
    if (now - state.rateWindow >= 60_000) {
      state.rateWindow = now;
      state.rateCount = 0;
      state.rateBytes = 0;
    }
    const related = this.ctx
      .getWebSockets()
      .map((socket) => this.state(socket))
      .filter(
        (other) =>
          now - other.rateWindow < 60_000 &&
          other.device?.deviceId === state.device?.deviceId,
      );
    const baseline = {
      count: related.reduce((sum, other) => sum + other.rateCount, 0),
      bytes: related.reduce((sum, other) => sum + other.rateBytes, 0),
    };
    if (state.authenticated && state.device) {
      try {
        this.deviceRates.record(state.device.deviceId, bytes, baseline, now);
      } finally {
        await this.saveDeviceRates();
        await this.scheduleAlarm(now + deviceRateLimits.windowMs);
      }
    } else if (
      baseline.count >= relayLimits.messagesPerMinute ||
      baseline.bytes + bytes > relayLimits.bytesPerMinute
    ) {
      throw new RelayError("RATE_LIMIT", 429);
    }
    state.rateCount++;
    state.rateBytes += bytes;
  }
  private async saveDeviceRates() {
    const records = this.deviceRates.snapshot();
    if (records.length) await this.ctx.storage.put("device-rate", records);
    else await this.ctx.storage.delete("device-rate");
  }
  private prune() {
    this.room!.invitations = this.room!.invitations.filter(
      (invite) => invite.expiresAt > Date.now(),
    );
    this.room!.pending = this.room!.pending.filter(
      (pending) => pending.expiresAt > Date.now(),
    );
  }
  private connected(): string[] {
    return [
      ...new Set(
        this.ctx
          .getWebSockets()
          .map((socket) => this.state(socket))
          .filter((state) => state.authenticated)
          .map((state) => state.device!.deviceId),
      ),
    ];
  }
  private async save() {
    await this.ctx.storage.put("room", this.room);
  }
  private async erase() {
    await this.ctx.storage.deleteAll();
    this.deviceRates.clear();
    this.deleteUntil = Date.now() + relayLimits.roomLifetimeMs;
    await this.ctx.storage.put("deleted", this.deleteUntil);
    await this.ctx.storage.setAlarm(this.deleteUntil);
    this.room = undefined;
    this.deleted = true;
  }
  private async expireIfNeeded() {
    if (
      this.room &&
      (Date.now() >= this.room.lastActive + relayLimits.roomIdleMs ||
        Date.now() >= this.room.createdAt + relayLimits.roomLifetimeMs)
    ) {
      await this.erase();
      for (const socket of this.ctx.getWebSockets()) {
        this.send(socket, { type: "error", protocol: 1, code: "ROOM_EXPIRED" });
        try {
          socket.close(1000, "Room expired");
        } catch {
          /* Already closed. */
        }
      }
    }
  }
  private async scheduleAlarm(time: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || time < current)
      await this.ctx.storage.setAlarm(time);
  }
  private ack(socket: WebSocket, sequence: number, result?: unknown) {
    this.send(socket, {
      type: "ack",
      protocol: 1,
      sequence,
      ...(result === undefined ? {} : { result }),
    });
  }
  private send(socket: WebSocket, frame: ServerFrame) {
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      try {
        socket.close(1011, "Connection closed");
      } catch {
        /* Already closed. */
      }
    }
  }
  private broadcast(
    frame: ServerFrame,
    except?: WebSocket,
    recipient?: string,
  ) {
    for (const socket of this.ctx.getWebSockets()) {
      const state = this.state(socket);
      if (
        socket !== except &&
        state.authenticated &&
        (!recipient || recipient === state.device?.deviceId)
      )
        this.send(socket, frame);
    }
  }
  private closePending(id: string, code: string) {
    for (const socket of this.ctx.getWebSockets()) {
      const state = this.state(socket);
      if (state.pending && state.device?.deviceId === id) {
        this.send(socket, { type: "error", protocol: 1, code });
        socket.close(1008, "Join rejected");
      }
    }
  }
  private failure(error: unknown): Response {
    return response(error instanceof RelayError ? error.status : 500, {
      protocol: 1,
      error: {
        code: error instanceof RelayError ? error.code : "RELAY_FAILURE",
      },
    });
  }
}
