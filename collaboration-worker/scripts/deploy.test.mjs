import { test } from "node:test";
import assert from "node:assert/strict";
import {
  credentialOptions,
  DeploymentOutput,
  deploymentOptions,
  redact,
  verifyCredentials,
} from "./deploy.mjs";
const environment = {
  CLOUDFLARE_API_TOKEN: "synthetic-test-token-value-123456789",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  COLLABORATION_WORKER_NAME: "visual-nerve-collaboration",
  COLLABORATION_WORKER_URL:
    "https://visual-nerve-collaboration.example.workers.dev",
  COLLABORATION_ALLOWED_ORIGINS: "https://app.visualnerve.com",
};
test("validates public deployment options and rejects unsafe origins/URL/CLI names without echoing values", () => {
  const options = deploymentOptions(environment);
  assert.equal(options.workersDev, true);
  for (const patch of [
    { COLLABORATION_WORKER_NAME: "unsafe;echo" },
    { COLLABORATION_WORKER_URL: "https://relay.test?token=private" },
    { COLLABORATION_ALLOWED_ORIGINS: "https://attacker.test" },
    { COLLABORATION_ALLOWED_ORIGINS: "http://localhost:5173" },
    { CLOUDFLARE_API_TOKEN: "value with whitespace" },
    { CLOUDFLARE_ACCOUNT_ID: "invalid" },
  ])
    assert.throws(
      () => deploymentOptions({ ...environment, ...patch }),
      (error) =>
        !Object.values(patch).some((value) => error.message.includes(value)),
    );
});
test("redacts both credentials even when log chunks were assembled across boundaries", () => {
  const text = [
    "prefix synthetic-test-",
    "token-value-123456789 account ",
    "a".repeat(32),
    " suffix",
  ].join("");
  const output = redact(text, [
    environment.CLOUDFLARE_API_TOKEN,
    environment.CLOUDFLARE_ACCOUNT_ID,
  ]);
  assert.equal(output, "prefix [redacted] account [redacted] suffix");
});
test("bounds a contiguous CLI prefix and never accepts smaller chunks after a secret crosses truncation", () => {
  const token = "synthetic-secret-" + "t".repeat(48);
  const account = "b".repeat(32);
  const maximum = 1024 * 1024;
  const prefix = token.slice(0, -1);
  const output = new DeploymentOutput([token, account]);
  output.collect(
    Buffer.from("z".repeat(maximum - 1000 - prefix.length) + prefix),
  );
  output.collect(Buffer.from(token.at(-1) + "x".repeat(1000)));
  // This would fit the unused space. Accepting it moves the discarded secret
  // boundary into the middle of the log, beyond the final protective tail strip.
  output.collect(Buffer.from("y".repeat(1000)));
  const text = output.text();
  assert.equal(
    text,
    "z".repeat(maximum - 1000 - token.length) +
      "\nAdditional CLI output omitted.\n",
  );
  assert.ok(!text.includes(prefix));
  assert.ok(!text.includes("y"));
  assert.ok(text.length < maximum);
});
test("collects and redacts complete stdout/stderr secrets split over multiple retained chunks", () => {
  const output = new DeploymentOutput([
    environment.CLOUDFLARE_API_TOKEN,
    environment.CLOUDFLARE_ACCOUNT_ID,
  ]);
  for (const part of [
    "prefix synthetic-test-",
    "token-value-123456789 account ",
    "a".repeat(16),
    "a".repeat(16) + " suffix",
  ])
    output.collect(Buffer.from(part));
  assert.equal(output.text(), "prefix [redacted] account [redacted] suffix");
});
test("verifies credentials with read-only requests and returns no account/token response content", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return url.endsWith("/verify")
      ? {
          ok: true,
          json: async () => ({
            success: true,
            result: { status: "active", id: "private token metadata" },
          }),
        }
      : { ok: true };
  };
  assert.equal(
    await verifyCredentials(
      credentialOptions({
        CLOUDFLARE_API_TOKEN: environment.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: environment.CLOUDFLARE_ACCOUNT_ID,
      }),
      fetcher,
    ),
    undefined,
  );
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (call) =>
        call.init.method === undefined && call.init.redirect === "error",
    ),
  );
  assert.equal(
    calls[0].init.headers.Authorization,
    `Bearer ${environment.CLOUDFLARE_API_TOKEN}`,
  );
});
test("fails closed without echoing API error response contents", async () => {
  await assert.rejects(
    verifyCredentials(deploymentOptions(environment), async () => ({
      ok: false,
      json: async () => ({
        errors: [{ message: environment.CLOUDFLARE_API_TOKEN }],
      }),
    })),
    (error) => !error.message.includes(environment.CLOUDFLARE_API_TOKEN),
  );
});
