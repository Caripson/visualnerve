import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { binaryHash, fingerprint } from "../src/auth";
import {
  canonical,
  signingInput,
  type Authentication,
  type Challenge,
  type DeviceIdentity,
  type PolicyCommand,
  type RoomMember,
  type RoomPolicy,
  type ServerFrame,
  type SignedCommand,
  type SignedRoomPolicy,
} from "../src/protocol";
import type { RelayEnv } from "../src/room";
import { decode, encode } from "../src/validation";

export const bindings = env as unknown as RelayEnv;
export interface Device {
  identity: DeviceIdentity;
  key: CryptoKey;
  keyPackage: string;
}
export async function device(): Promise<Device> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as JsonWebKey;
  const signingKey = {
    kty: "EC" as const,
    crv: "P-256" as const,
    x: jwk.x!,
    y: jwk.y!,
  };
  return {
    identity: {
      deviceId: crypto.randomUUID(),
      signingKey,
      credentialId: await fingerprint(signingKey),
      mlsSignatureKey: encode(crypto.getRandomValues(new Uint8Array(32))),
    },
    key: pair.privateKey,
    keyPackage: encode(crypto.getRandomValues(new Uint8Array(64))),
  };
}
export async function sign(
  domain: "policy" | "authenticate" | "command",
  value: unknown,
  key: CryptoKey,
) {
  return encode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signingInput(domain, value),
      ),
    ),
  );
}
export async function signed(
  policy: RoomPolicy,
  owner: Device,
): Promise<SignedRoomPolicy> {
  return { policy, signature: await sign("policy", policy, owner.key) };
}
export async function fetchRelay(
  path: string,
  init: RequestInit = {},
  ip = "local-fixture",
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin"))
    headers.set("Origin", "https://app.visualnerve.com");
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", ip);
  return (
    exports as unknown as {
      default: { fetch(request: Request): Promise<Response> };
    }
  ).default.fetch(
    new Request(`https://relay.test${path}`, { ...init, headers }),
  );
}
export async function create(input?: Device) {
  const owner = input ?? (await device());
  const id = crypto.randomUUID(),
    ip = crypto.randomUUID();
  const policy = await signed(
    {
      protocol: 1,
      roomId: id,
      ownerDeviceId: owner.identity.deviceId,
      revision: 1,
      epoch: 0,
      transition: null,
      members: [{ ...owner.identity, role: "owner" }],
    },
    owner,
  );
  const result = await fetchRelay(
    "/v1/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: canonical({ policy }),
    },
    ip,
  );
  expect(result.status, await result.clone().text()).toBe(201);
  return {
    id,
    ip,
    owner,
    policy,
    stub: bindings.ROOMS.get(bindings.ROOMS.idFromName(id)),
  };
}
export type Fixture = Awaited<ReturnType<typeof create>>;
export const clients = new Set<Client>();
export class Client {
  readonly received: ServerFrame[] = [];
  private waiters: {
    type: ServerFrame["type"];
    resolve: (value: ServerFrame) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }[] = [];
  private queued: ServerFrame[] = [];
  challenge!: Challenge;
  sequence = 0;
  epoch = 0;
  private constructor(
    readonly socket: WebSocket,
    readonly fixture: Fixture,
    readonly device: Device,
  ) {
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      this.received.push(frame);
      const index = this.waiters.findIndex(
        (waiter) => waiter.type === frame.type,
      );
      if (index >= 0) {
        const waiter = this.waiters.splice(index, 1)[0];
        clearTimeout(waiter.timeout);
        waiter.resolve(frame);
      } else this.queued.push(frame);
    });
    socket.accept();
  }
  static async open(fixture: Fixture, device = fixture.owner) {
    const response = await fetchRelay(
      `/v1/rooms/${fixture.id}/socket`,
      { headers: { Upgrade: "websocket" } },
      fixture.ip,
    );
    expect(
      response.status,
      response.status === 101 ? undefined : await response.text(),
    ).toBe(101);
    const client = new Client(response.webSocket!, fixture, device);
    clients.add(client);
    client.challenge = (await client.next("challenge")) as Challenge;
    return client;
  }
  next<T extends ServerFrame["type"]>(
    type: T,
  ): Promise<Extract<ServerFrame, { type: T }>> {
    const index = this.queued.findIndex((frame) => frame.type === type);
    if (index >= 0)
      return Promise.resolve(
        this.queued.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>,
      );
    return new Promise((resolve, reject) => {
      const waiter = {
        type,
        resolve: resolve as (value: ServerFrame) => void,
        reject,
        timeout: setTimeout(() => {
          this.waiters = this.waiters.filter((other) => other !== waiter);
          reject(new Error(`No ${type} frame`));
        }, 5000),
      };
      this.waiters.push(waiter);
    });
  }
  async authenticate(invitation?: string) {
    const value: Omit<Authentication, "signature"> = {
      type: "authenticate",
      protocol: 1,
      roomId: this.fixture.id,
      connectionId: this.challenge.connectionId,
      nonce: this.challenge.nonce,
      device: this.device.identity,
      ...(invitation ? { invitation, keyPackage: this.device.keyPackage } : {}),
    };
    const frame = {
      ...value,
      signature: await sign("authenticate", value, this.device.key),
    };
    this.socket.send(canonical(frame));
    return frame;
  }
  async authorized() {
    await this.authenticate();
    const frame = await this.next("authenticated");
    this.epoch = frame.policy.policy.epoch;
    return this;
  }
  async envelope(
    body: SignedCommand["body"],
    sequence = ++this.sequence,
    epoch = this.epoch,
  ): Promise<SignedCommand> {
    const value: Omit<SignedCommand, "signature"> = {
      type: "command",
      protocol: 1,
      roomId: this.fixture.id,
      connectionId: this.challenge.connectionId,
      deviceId: this.device.identity.deviceId,
      sequence,
      epoch,
      body,
    };
    return {
      ...value,
      signature: await sign("command", value, this.device.key),
    };
  }
  async command(body: SignedCommand["body"]) {
    const frame = await this.envelope(body);
    this.socket.send(canonical(frame));
    return frame;
  }
  async invite() {
    await this.command({ kind: "invite" });
    const ack = await this.next("ack");
    return ack.result as { invitation: string; expiresAt: number };
  }
  close() {
    clients.delete(this);
    try {
      this.socket.close(1000);
    } catch {}
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Client closed"));
    }
    this.waiters = [];
  }
}
export async function pending(owner: Client, input?: Device) {
  const participant = input ?? (await device());
  const invitation = await owner.invite();
  const client = await Client.open(owner.fixture, participant);
  await client.authenticate(invitation.invitation);
  await client.next("pending");
  const request = await owner.next("join-request");
  expect(request.request.deviceId).toBe(participant.identity.deviceId);
  return client;
}
export async function policyCommand(
  owner: Client,
  members: RoomMember[],
  before = owner.fixture.policy,
): Promise<PolicyCommand> {
  const commit = encode(crypto.getRandomValues(new Uint8Array(100)));
  const added = members.filter(
    (member) =>
      !before.policy.members.some((old) => old.deviceId === member.deviceId),
  );
  const welcomes = added.map((member) => ({
    deviceId: member.deviceId,
    ciphertext: encode(crypto.getRandomValues(new Uint8Array(80))),
  }));
  const policy = await signed(
    {
      ...before.policy,
      members,
      epoch: before.policy.epoch + 1,
      revision: before.policy.revision + 1,
      transition: {
        previousEpoch: before.policy.epoch,
        commitHash: await binaryHash(decode(commit, 128 * 1024)),
        welcomeHashes: await Promise.all(
          welcomes.map(async (welcome) => ({
            deviceId: welcome.deviceId,
            hash: await binaryHash(decode(welcome.ciphertext, 128 * 1024)),
          })),
        ),
      },
    },
    owner.device,
  );
  return { kind: "policy", policy, commit, welcomes };
}
export async function approve(
  owner: Client,
  joining: Client,
  role: "editor" | "viewer" = "editor",
) {
  const body = await policyCommand(owner, [
    ...owner.fixture.policy.policy.members,
    { ...joining.device.identity, role },
  ]);
  await owner.command(body);
  await owner.next("ack");
  await joining.next("welcome");
  await joining.next("authenticated");
  owner.fixture.policy = body.policy;
  owner.epoch = body.policy.policy.epoch;
  joining.epoch = owner.epoch;
  return body;
}
