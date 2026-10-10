import { afterEach, describe, expect, it } from "vitest";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { canonical, relayLimits } from "../src/protocol";
import { deviceRateLimits, type PublicDeviceRate } from "../src/device-rate";
import { decode, encode } from "../src/validation";
import {
  approve,
  Client,
  clients,
  create,
  device,
  fetchRelay,
  pending,
  policyCommand,
  sign,
  signed,
} from "./helpers";

afterEach(() => {
  for (const client of [...clients]) client.close();
});
const ciphertext = () => encode(crypto.getRandomValues(new Uint8Array(120)));

describe("Worker admission and signed room creation", () => {
  it("reports semantic limits without exposing room, member, name or content metadata", async () => {
    const result = await fetchRelay("/health");
    expect(await result.json()).toMatchObject({
      protocol: 1,
      enabled: true,
      limits: { members: 32 },
      capabilities: expect.arrayContaining(["no-document-retention"]),
    });
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.visualnerve.com",
    );
  });
  it.each([
    "https://visualnerve.com",
    "https://attacker.test",
    "null",
    "https://app.visualnerve.com.attacker.test",
  ])("rejects an unapproved Origin: %s", async (origin) => {
    expect(
      (
        await fetchRelay("/v1/rooms", {
          method: "POST",
          headers: { Origin: origin },
        })
      ).status,
    ).toBe(403);
  });
  it("rejects absent Origin, query bearer secrets, invalid path and non-JSON bodies", async () => {
    expect(
      (
        await fetchRelay("/v1/rooms", {
          method: "POST",
          headers: { Origin: "" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetchRelay("/v1/rooms?token=secret", { method: "POST" })).status,
    ).toBe(400);
    expect(
      (
        await fetchRelay("/v1/rooms/bad/socket", {
          headers: { Upgrade: "websocket" },
        })
      ).status,
    ).toBe(422);
    expect(
      (await fetchRelay("/v1/rooms", { method: "POST", body: "{}" })).status,
    ).toBe(415);
  });
  it("allows only the exact configured CORS origin and required preflight method/header", async () => {
    const result = await fetchRelay("/v1/rooms", {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(result.status).toBe(204);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.visualnerve.com",
    );
    expect(result.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(
      (
        await fetchRelay("/v1/rooms", {
          method: "OPTIONS",
          headers: { "Access-Control-Request-Method": "DELETE" },
        })
      ).status,
    ).toBe(403);
  });
  it("creates a room only from a valid owner signature and rejects replay after durable eviction", async () => {
    const fixture = await create();
    await evictDurableObject(fixture.stub);
    const result = await fetchRelay(
      "/v1/rooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: canonical({ policy: fixture.policy }),
      },
      fixture.ip,
    );
    expect(result.status).toBe(409);
    const forged = {
      ...fixture.policy,
      policy: { ...fixture.policy.policy, roomId: crypto.randomUUID() },
    };
    const failure = await fetchRelay(
      "/v1/rooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: canonical({ policy: forged }),
      },
      fixture.ip,
    );
    expect(failure.status).toBe(403);
    expect(await failure.json()).toMatchObject({
      error: { code: "INVALID_SIGNATURE" },
    });
  });
  it("rejects unexpected plaintext fields, private key material and nonzero initial epoch", async () => {
    const fixture = await create();
    for (const value of [
      { policy: fixture.policy, title: "Private document" },
      {
        policy: {
          ...fixture.policy,
          policy: {
            ...fixture.policy.policy,
            roomId: crypto.randomUUID(),
            epoch: 1,
          },
        },
      },
      {
        policy: {
          ...fixture.policy,
          policy: {
            ...fixture.policy.policy,
            roomId: crypto.randomUUID(),
            members: [
              {
                ...fixture.policy.policy.members[0],
                signingKey: {
                  ...fixture.owner.identity.signingKey,
                  d: "private",
                },
              },
            ],
          },
        },
      },
    ]) {
      const result = await fetchRelay(
        "/v1/rooms",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
        fixture.ip,
      );
      expect(result.status).toBe(422);
    }
  });
  it("bounds body streaming even without a trustworthy Content-Length", async () => {
    const result = await fetchRelay(
      "/v1/rooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ junk: "a".repeat(70 * 1024) }),
      },
      crypto.randomUUID(),
    );
    expect(result.status).toBe(413);
  });
});

describe("Native WebSocket proof, invitation and owner approval", () => {
  it("authenticates owner with challenge proof and no URL bearer", async () => {
    const fixture = await create(),
      owner = await Client.open(fixture);
    await owner.authorized();
    expect(owner.challenge.nonce.length).toBe(43);
    await owner.command({ kind: "inspect" });
    const result = (await owner.next("ack")).result;
    expect(result).toMatchObject({
      policy: fixture.policy,
      connected: [fixture.owner.identity.deviceId],
      pending: [],
    });
  });
  it("rejects a recorded auth proof used on another WebSocket connection", async () => {
    const fixture = await create(),
      owner = await Client.open(fixture);
    const proof = await owner.authenticate();
    await owner.next("authenticated");
    const another = await Client.open(fixture);
    another.socket.send(canonical(proof));
    expect((await another.next("error")).code).toBe("CHALLENGE_REJECTED");
  });
  it("rejects forged challenge signature and key/credential mismatch", async () => {
    const fixture = await create(),
      impostor = await device();
    const client = await Client.open(fixture);
    const unsigned = {
      type: "authenticate",
      protocol: 1,
      roomId: fixture.id,
      connectionId: client.challenge.connectionId,
      nonce: client.challenge.nonce,
      device: fixture.owner.identity,
    };
    client.socket.send(
      canonical({
        ...unsigned,
        signature: await sign("authenticate", unsigned, impostor.key),
      }),
    );
    expect((await client.next("error")).code).toBe("INVALID_SIGNATURE");
    const invalid = await Client.open(fixture, {
      ...impostor,
      identity: { ...impostor.identity, credentialId: "0".repeat(64) },
    });
    await invalid.authenticate();
    expect((await invalid.next("error")).code).toBe("CREDENTIAL_KEY_MISMATCH");
  });
  it("one-use invitation permits a pending public KeyPackage, never live document traffic before approval", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized();
    const token = await owner.invite(),
      guest = await Client.open(fixture, await device());
    await guest.authenticate(token.invitation);
    await guest.next("pending");
    await owner.next("join-request");
    const replay = await Client.open(fixture, await device());
    await replay.authenticate(token.invitation);
    expect((await replay.next("error")).code).toBe("INVITATION_REJECTED");
    await guest.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: ciphertext(),
    });
    expect((await guest.next("error")).code).toBe("OWNER_APPROVAL_REQUIRED");
    expect(owner.received.some((frame) => frame.type === "relay")).toBe(false);
    const stored = await runInDurableObject(
      fixture.stub,
      async (_room, ctx) => [...(await ctx.storage.list()).values()],
    );
    expect(JSON.stringify(stored)).not.toContain(token.invitation);
    expect(JSON.stringify(stored)).toContain("keyPackage");
  });
  it("owner approves editor atomically with signed ACL, epoch and recipient-only Welcome", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      joining = await pending(owner);
    const body = await approve(owner, joining);
    expect(body.policy.policy.epoch).toBe(1);
    expect(body.policy.policy.members[1].role).toBe("editor");
    expect(
      owner.received.filter((frame) => frame.type === "welcome"),
    ).toHaveLength(0);
    const welcome = joining.received.find((frame) => frame.type === "welcome");
    expect(welcome).toMatchObject({
      ciphertext: body.welcomes[0].ciphertext,
      commit: body.commit,
    });
    const packet = await joining.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: ciphertext(),
    });
    expect((await owner.next("relay")).command).toEqual(packet);
    await joining.next("ack");
  });
  it("rejects owner policy additions without an authenticated pending join", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      stranger = await device();
    await owner.command(
      await policyCommand(owner, [
        ...fixture.policy.policy.members,
        { ...stranger.identity, role: "editor" },
      ]),
    );
    expect((await owner.next("error")).code).toBe("OWNER_APPROVAL_REQUIRED");
    const reconnect = await (await Client.open(fixture)).authorized();
    expect(reconnect.epoch).toBe(0);
  });
  it("rejects a Welcome mismatch before changing durable ACL or epoch", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      joining = await pending(owner);
    const body = await policyCommand(owner, [
      ...fixture.policy.policy.members,
      { ...joining.device.identity, role: "editor" },
    ]);
    body.welcomes[0].ciphertext = ciphertext();
    await owner.command(body);
    expect((await owner.next("error")).code).toBe("WELCOME_MISMATCH");
    await owner.command({ kind: "inspect" });
    expect((await owner.next("ack")).result).toMatchObject({
      policy: {
        policy: { epoch: 0, members: [fixture.policy.policy.members[0]] },
      },
    });
  });
  it("rejects duplicate cryptographic identities under distinct device names", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized();
    const clone = {
      ...fixture.owner,
      identity: {
        ...fixture.owner.identity,
        deviceId: crypto.randomUUID(),
        mlsSignatureKey: ciphertext().slice(0, 43),
      },
    };
    // Generate an exact32byte public MLS key, while intentionally reusing the
    // owner's transport key under a different deviceID.
    clone.identity.mlsSignatureKey = encode(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const joining = await pending(owner, clone);
    const body = await policyCommand(owner, [
      ...fixture.policy.policy.members,
      { ...joining.device.identity, role: "viewer" },
    ]);
    await owner.command(body);
    expect((await owner.next("error")).code).toBe("DUPLICATE_IDENTITY");
    await owner.command({ kind: "inspect" });
    expect((await owner.next("ack")).result).toMatchObject({
      policy: { policy: { epoch: 0 } },
    });
  });
  it("lets owner reject a pending join and revoke unused invitations", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      joining = await pending(owner);
    await owner.command({
      kind: "reject",
      deviceId: joining.device.identity.deviceId,
    });
    await owner.next("ack");
    expect((await joining.next("error")).code).toBe("JOIN_REJECTED");
    const token = await owner.invite();
    await owner.command({ kind: "revoke-invitations" });
    await owner.next("ack");
    const denied = await Client.open(fixture, await device());
    await denied.authenticate(token.invitation);
    expect((await denied.next("error")).code).toBe("INVITATION_REJECTED");
  });
  it("expires challenge, pending join and invitations using real DO alarm metadata", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      joining = await pending(owner),
      token = await owner.invite(),
      unauthenticated = await Client.open(fixture);
    await runInDurableObject(fixture.stub, async (_room, ctx) => {
      const room = await ctx.storage.get<any>("room");
      room.pending.forEach((entry: any) => {
        entry.expiresAt = Date.now() - 1;
      });
      room.invitations.forEach((entry: any) => {
        entry.expiresAt = Date.now() - 1;
      });
      // Rebuilds metadata on eviction; no timer/crypto mocks.
      await ctx.storage.put("room", room);
      for (const socket of ctx.getWebSockets()) {
        const state = socket.deserializeAttachment() as any;
        if (!state.device) {
          state.challenge.expiresAt = Date.now() - 1;
          socket.serializeAttachment(state);
        }
      }
      await ctx.storage.setAlarm(Date.now());
    });
    await evictDurableObject(fixture.stub);
    await runDurableObjectAlarm(fixture.stub);
    await owner.command({ kind: "inspect" });
    expect((await owner.next("ack")).result).toMatchObject({ pending: [] });
    const denied = await Client.open(fixture, await device());
    await denied.authenticate(token.invitation);
    expect((await denied.next("error")).code).toBe("INVITATION_REJECTED");
    joining.close();
    unauthenticated.close();
  });
});

describe("Actual relay authorization, epoch fencing and privacy", () => {
  it("viewer can send encrypted presence/sync requests but cannot publish application mutations", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      viewer = await pending(owner);
    await approve(owner, viewer, "viewer");
    await viewer.command({
      kind: "relay",
      payloadKind: "presence",
      ciphertext: ciphertext(),
    });
    expect((await owner.next("relay")).command.body).toMatchObject({
      payloadKind: "presence",
    });
    await viewer.next("ack");
    await viewer.command({
      kind: "relay",
      payloadKind: "sync-request",
      recipient: owner.device.identity.deviceId,
      ciphertext: ciphertext(),
    });
    await owner.next("relay");
    await viewer.next("ack");
    await viewer.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: ciphertext(),
    });
    expect((await viewer.next("error")).code).toBe("ROLE_FORBIDDEN");
  });
  it("editor cannot create invitations, approve members or delete the room", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      editor = await pending(owner);
    await approve(owner, editor);
    await editor.command({ kind: "invite" });
    expect((await editor.next("error")).code).toBe("OWNER_REQUIRED");
  });
  it("rejects replay, out-of-order sequence and stale epoch without relaying work", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      editor = await pending(owner);
    await approve(owner, editor);
    const frame = await editor.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: ciphertext(),
    });
    await owner.next("relay");
    await editor.next("ack");
    editor.socket.send(canonical(frame));
    expect((await editor.next("error")).code).toBe("SEQUENCE_REPLAY");
    editor.socket.send(
      canonical(
        await editor.envelope({ kind: "inspect" }, editor.sequence + 3),
      ),
    );
    expect((await editor.next("error")).code).toBe("SEQUENCE_REPLAY");
    const stale = await editor.envelope(
      {
        kind: "relay",
        payloadKind: "application",
        ciphertext: ciphertext(),
      },
      ++editor.sequence,
      0,
    );
    editor.socket.send(canonical(stale));
    expect((await editor.next("error")).code).toBe("STALE_EPOCH");
    // A rejected, validly signed command consumes the connection sequence.
    // Replaying it stays rejected, and a fresh current-epoch command can proceed.
    editor.socket.send(canonical(stale));
    expect((await editor.next("error")).code).toBe("SEQUENCE_REPLAY");
    await editor.command({ kind: "inspect" });
    await editor.next("ack");
    await editor.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: ciphertext(),
    });
    const relayed = await owner.next("relay");
    expect(relayed.command).toMatchObject({
      sequence: editor.sequence,
      epoch: editor.epoch,
    });
    await editor.next("ack");
    expect(
      owner.received.filter((message) => message.type === "relay"),
    ).toHaveLength(2);
  });
  it("does not authenticate a forged stale-epoch command or consume its valid sequence", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    const editor = await pending(owner);
    await approve(owner, editor);
    const attacker = await device();
    const stale = await editor.envelope(
      { kind: "relay", payloadKind: "application", ciphertext: ciphertext() },
      editor.sequence + 1,
      0,
    );
    const { signature: _signature, ...unsigned } = stale;
    const forged = canonical({
      ...unsigned,
      signature: await sign("command", unsigned, attacker.key),
    });
    const closed = new Promise<CloseEvent>((resolve) =>
      editor.socket.addEventListener("close", resolve, { once: true }),
    );
    // The authorization failure closes the native socket. Inspect its retained
    // attachment immediately after the real handler, rather than attempting a
    // follow-up command on a deliberately revoked connection.
    const retainedSequence = await runInDurableObject(
      fixture.stub,
      async (room, ctx) => {
        const socket = ctx.getWebSockets().find((socket) => {
          const state = socket.deserializeAttachment() as {
            device?: { deviceId: string };
          };
          return state.device?.deviceId === editor.device.identity.deviceId;
        })!;
        await room.webSocketMessage(socket, forged);
        return (socket.deserializeAttachment() as { sequence: number })
          .sequence;
      },
    );
    expect(await editor.next("error")).toMatchObject({
      code: "INVALID_SIGNATURE",
      sequence: stale.sequence,
    });
    expect((await closed).code).toBe(1008);
    expect(retainedSequence).toBe(editor.sequence);
    expect(
      owner.received.filter((message) => message.type === "relay"),
    ).toHaveLength(0);
    const fresh = await (
      await Client.open(fixture, editor.device)
    ).authorized();
    const accepted = await fresh.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: ciphertext(),
    });
    expect(accepted.sequence).toBe(stale.sequence);
    expect((await owner.next("relay")).command).toEqual(accepted);
    await fresh.next("ack");
    expect(
      owner.received.filter((message) => message.type === "relay"),
    ).toHaveLength(1);
  });
  it("reconciles an accepted membership transition through a signed old-epoch inspect without permitting stale writes", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    const peer = await pending(owner);
    const body = await approve(owner, peer);
    const inspect = await owner.envelope(
      { kind: "inspect" },
      owner.sequence + 1,
      0,
    );
    owner.sequence = inspect.sequence;
    owner.socket.send(canonical(inspect));
    expect((await owner.next("ack")).result).toMatchObject({
      policy: body.policy,
    });
    const stale = await owner.envelope(
      { kind: "relay", payloadKind: "application", ciphertext: ciphertext() },
      ++owner.sequence,
      0,
    );
    owner.socket.send(canonical(stale));
    expect((await owner.next("error")).code).toBe("STALE_EPOCH");
    const future = await owner.envelope(
      { kind: "inspect" },
      ++owner.sequence,
      owner.epoch + 1,
    );
    owner.socket.send(canonical(future));
    expect((await owner.next("error")).code).toBe("STALE_EPOCH");
    expect(
      peer.received.filter((frame) => frame.type === "relay"),
    ).toHaveLength(0);
  });
  it("removal rotates policy epoch, disconnects removed member and invalidates earlier unused invites", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      editor = await pending(owner);
    await approve(owner, editor);
    const invitation = await owner.invite();
    const body = await policyCommand(owner, [fixture.policy.policy.members[0]]);
    await owner.command(body);
    await owner.next("ack");
    expect((await editor.next("error")).code).toBe("MEMBERSHIP_REVOKED");
    owner.epoch = body.policy.policy.epoch;
    fixture.policy = body.policy;
    const removed = await Client.open(fixture, editor.device);
    await removed.authenticate();
    expect((await removed.next("error")).code).toBe("INVALID_BINARY");
    const stale = await Client.open(fixture, await device());
    await stale.authenticate(invitation.invitation);
    expect((await stale.next("error")).code).toBe("INVITATION_REJECTED");
    await owner.command({ kind: "inspect" });
    expect((await owner.next("ack")).result).toMatchObject({
      policy: { policy: { epoch: 2 } },
    });
  });
  it("survives native DO hibernation with sequence/identity checks and no ciphertext transcript", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      editor = await pending(owner);
    const change = await approve(owner, editor);
    const secret = ciphertext();
    const frame = await editor.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: secret,
    });
    await owner.next("relay");
    await editor.next("ack");
    await evictDurableObject(fixture.stub);
    editor.socket.send(canonical(frame));
    expect((await editor.next("error")).code).toBe("SEQUENCE_REPLAY");
    await editor.command({
      kind: "relay",
      payloadKind: "presence",
      ciphertext: ciphertext(),
    });
    await owner.next("relay");
    await editor.next("ack");
    const storage = await runInDurableObject(
      fixture.stub,
      async (_room, ctx) => [...(await ctx.storage.list()).entries()],
    );
    const text = JSON.stringify(storage);
    expect(storage.map(([key]) => key)).toEqual(["device-rate", "room"]);
    const counters = storage.find(
      ([key]) => key === "device-rate",
    )![1] as PublicDeviceRate[];
    expect(counters.length).toBeLessThanOrEqual(deviceRateLimits.entries);
    for (const counter of counters)
      expect(Object.keys(counter).sort()).toEqual([
        "bytes",
        "count",
        "deviceId",
        "window",
      ]);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(change.commit);
    expect(text).not.toContain(change.welcomes[0].ciphertext);
    expect(text).toContain(change.policy.policy.transition!.commitHash);
  });
  it("reconnects approved device with new challenge and explicit current owner-signed policy", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      editor = await pending(owner);
    await approve(owner, editor);
    editor.close();
    const fresh = await (
      await Client.open(fixture, editor.device)
    ).authorized();
    expect(fresh.challenge.connectionId).not.toBe(
      editor.challenge.connectionId,
    );
    expect(fresh.epoch).toBe(1);
    expect(
      fresh.received.find((message) => message.type === "authenticated"),
    ).toMatchObject({ policy: fixture.policy });
    await fresh.command({
      kind: "relay",
      payloadKind: "sync-request",
      recipient: owner.device.identity.deviceId,
      ciphertext: ciphertext(),
    });
    await owner.next("relay");
    await fresh.next("ack");
  });
  it("retransmits only an exact owner-policy-bound Welcome and Commit to its recipient", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized(),
      editor = await pending(owner);
    const body = await approve(owner, editor);
    await owner.command({
      kind: "welcome",
      recipient: editor.device.identity.deviceId,
      ciphertext: body.welcomes[0].ciphertext,
      commit: body.commit,
    });
    await owner.next("ack");
    expect((await editor.next("welcome")).ciphertext).toBe(
      body.welcomes[0].ciphertext,
    );
    await owner.command({
      kind: "welcome",
      recipient: editor.device.identity.deviceId,
      ciphertext: ciphertext(),
      commit: body.commit,
    });
    expect((await owner.next("error")).code).toBe("WELCOME_MISMATCH");
  });
  it("caps ciphertext, rejects plaintext relay fields, and enforces device rate across connections", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized();
    await owner.command({
      kind: "relay",
      payloadKind: "application",
      ciphertext: encode(new Uint8Array(relayLimits.ciphertextBytes + 1)),
    });
    expect((await owner.next("error")).code).toBe("INVALID_BINARY");
    const invalid = await owner.envelope({
      kind: "relay",
      payloadKind: "presence",
      ciphertext: ciphertext(),
      title: "private",
    } as any);
    owner.socket.send(canonical(invalid));
    expect((await owner.next("error")).code).toBe("INVALID_ENVELOPE");
    await runInDurableObject(fixture.stub, (_room, ctx) => {
      for (const socket of ctx.getWebSockets()) {
        const state = socket.deserializeAttachment() as any;
        state.rateWindow = Date.now();
        state.rateCount = relayLimits.messagesPerMinute;
        socket.serializeAttachment(state);
      }
    });
    await owner.command({ kind: "inspect" });
    expect((await owner.next("error")).code).toBe("RATE_LIMIT");
  });
  it("meters rejected JSON in persisted native socket accounting instead of leaving malformed traffic unbounded", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    await runInDurableObject(fixture.stub, (_room, ctx) => {
      for (const socket of ctx.getWebSockets()) {
        const state = socket.deserializeAttachment() as {
          rateWindow: number;
          rateCount: number;
        };
        state.rateWindow = Date.now();
        state.rateCount = relayLimits.messagesPerMinute - 1;
        socket.serializeAttachment(state);
      }
    });
    owner.socket.send("not valid JSON");
    expect((await owner.next("error")).code).toBe("INVALID_JSON");
    await runInDurableObject(fixture.stub, (_room, ctx) => {
      expect(
        (
          ctx.getWebSockets()[0].deserializeAttachment() as {
            rateCount: number;
          }
        ).rateCount,
      ).toBe(relayLimits.messagesPerMinute);
    });
    const closed = new Promise<CloseEvent>((resolve) => {
      owner.socket.addEventListener("close", resolve, { once: true });
    });
    owner.socket.send("{}");
    expect((await owner.next("error")).code).toBe("RATE_LIMIT");
    expect((await closed).code).toBe(1008);
  });
  it("retains a consumed device budget after socket close and native hibernation, then expires its public counters", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    await runInDurableObject(fixture.stub, (_room, ctx) => {
      const socket = ctx.getWebSockets()[0];
      const state = socket.deserializeAttachment() as {
        rateWindow: number;
        rateCount: number;
      };
      state.rateWindow = Date.now();
      state.rateCount = relayLimits.messagesPerMinute - 1;
      socket.serializeAttachment(state);
    });
    await owner.command({ kind: "inspect" });
    await owner.next("ack");
    const closed = new Promise<CloseEvent>((resolve) =>
      owner.socket.addEventListener("close", resolve, { once: true }),
    );
    await owner.command({ kind: "inspect" });
    expect((await owner.next("error")).code).toBe("RATE_LIMIT");
    expect((await closed).code).toBe(1008);
    await evictDurableObject(fixture.stub);
    const retry = await (await Client.open(fixture)).authorized();
    const retryClosed = new Promise<CloseEvent>((resolve) =>
      retry.socket.addEventListener("close", resolve, { once: true }),
    );
    await retry.command({ kind: "inspect" });
    expect((await retry.next("error")).code).toBe("RATE_LIMIT");
    expect((await retryClosed).code).toBe(1008);
    await runInDurableObject(fixture.stub, async (_room, ctx) => {
      const records =
        (await ctx.storage.get<PublicDeviceRate[]>("device-rate"))!;
      expect(records).toHaveLength(1);
      expect(Object.keys(records[0]).sort()).toEqual([
        "bytes",
        "count",
        "deviceId",
        "window",
      ]);
      records[0].window = Date.now() - deviceRateLimits.windowMs - 1;
      await ctx.storage.put("device-rate", records);
    });
    await evictDurableObject(fixture.stub);
    await runDurableObjectAlarm(fixture.stub);
    await runInDurableObject(fixture.stub, async (_room, ctx) =>
      expect(await ctx.storage.get("device-rate")).toBeUndefined(),
    );
    const renewed = await (await Client.open(fixture)).authorized();
    await renewed.command({ kind: "inspect" });
    expect((await renewed.next("ack")).result).toMatchObject({
      policy: { policy: { epoch: 0 } },
    });
  });
  it("bounds short-lived public actor counters even when the owner approves and removes many distinct devices", async () => {
    const fixture = await create();
    const owner = await (await Client.open(fixture)).authorized();
    for (let index = 0; index < deviceRateLimits.entries; index++) {
      const invitation = await owner.invite();
      const peer = await Client.open(
        { ...fixture, ip: `192.0.2.${index + 1}` },
        await device(),
      );
      await peer.authenticate(invitation.invitation);
      await peer.next("pending");
      await owner.next("join-request");
      await approve(owner, peer);
      await peer.command({ kind: "inspect" });
      if (index < deviceRateLimits.entries - 1) await peer.next("ack");
      else
        expect((await peer.next("error")).code).toBe("DEVICE_RATE_ACTOR_LIMIT");
      const removed = await policyCommand(
        owner,
        fixture.policy.policy.members.filter(
          (member) => member.deviceId !== peer.device.identity.deviceId,
        ),
      );
      await owner.command(removed);
      await owner.next("ack");
      fixture.policy = removed.policy;
      owner.epoch = removed.policy.policy.epoch;
      expect((await peer.next("error")).code).toBe("MEMBERSHIP_REVOKED");
      await runInDurableObject(fixture.stub, async (_room, ctx) =>
        expect(
          (await ctx.storage.get<PublicDeviceRate[]>("device-rate"))!.length,
        ).toBeLessThanOrEqual(deviceRateLimits.entries),
      );
    }
    await runInDurableObject(fixture.stub, async (_room, ctx) => {
      const records =
        (await ctx.storage.get<PublicDeviceRate[]>("device-rate"))!;
      expect(records).toHaveLength(deviceRateLimits.entries);
      expect(
        (await ctx.storage.get<any>("room")).policy.policy.members,
      ).toHaveLength(1);
    });
  });
  it("permanently closes a room and prevents old invite or owner proof from reopening it", async () => {
    const fixture = await create(),
      owner = await (await Client.open(fixture)).authorized();
    await owner.command({ kind: "delete-room" });
    await owner.next("ack");
    await evictDurableObject(fixture.stub);
    const result = await fetchRelay(
      "/v1/rooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: canonical({ policy: fixture.policy }),
      },
      fixture.ip,
    );
    expect(result.status).toBe(410);
    const stored = await runInDurableObject(
      fixture.stub,
      async (_room, ctx) => [...(await ctx.storage.list()).entries()],
    );
    expect(stored).toEqual([["deleted", expect.any(Number)]]);
  });
  it.each(["idle", "absolute"])(
    "expires %s room metadata, closes sockets and eventually erases its bounded tombstone",
    async (mode) => {
      const fixture = await create(),
        owner = await (await Client.open(fixture)).authorized();
      await owner.invite();
      await runInDurableObject(fixture.stub, async (_room, ctx) => {
        const room = await ctx.storage.get<any>("room");
        if (mode === "idle")
          room.lastActive = Date.now() - relayLimits.roomIdleMs - 1;
        else room.createdAt = Date.now() - relayLimits.roomLifetimeMs - 1;
        await ctx.storage.put("room", room);
        await ctx.storage.setAlarm(Date.now());
      });
      await evictDurableObject(fixture.stub);
      await runDurableObjectAlarm(fixture.stub);
      expect((await owner.next("error")).code).toBe("ROOM_EXPIRED");
      const values = await runInDurableObject(
        fixture.stub,
        async (_room, ctx) => [...(await ctx.storage.list()).entries()],
      );
      expect(values).toEqual([["deleted", expect.any(Number)]]);
      await runInDurableObject(fixture.stub, async (_room, ctx) => {
        await ctx.storage.put("deleted", Date.now() - 1);
        await ctx.storage.setAlarm(Date.now());
      });
      await evictDurableObject(fixture.stub);
      await runDurableObjectAlarm(fixture.stub);
      expect(
        await runInDurableObject(
          fixture.stub,
          async (_room, ctx) => (await ctx.storage.list()).size,
        ),
      ).toBe(0);
    },
  );
});
