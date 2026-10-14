import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpDockerTarget, mcpDockerBrowserOptions } from "./config.mjs";

const hosted = {
  VN_MCP_TEST_APP_URL: "https://visualnerve.caripson.com/app/",
  VN_MCP_TEST_EXPECTED_ENTRY_SHA256: "a".repeat(64),
  VN_MCP_TEST_EXPECTED_REVISION: "b".repeat(40),
};
test("the local fixture keeps its isolated origin and self-signed test configuration", () => {
  const target = mcpDockerTarget({});
  assert.equal(target.hosted, false);
  assert.equal(target.origin, "https://mcp-docker.test:4342");
  const browser = mcpDockerBrowserOptions(target);
  assert.equal(browser.ignoreHTTPSErrors, true);
  assert.ok(browser.launchOptions.args.includes("--ignore-certificate-errors"));
});
test("hosted staging preserves its /app/ route and has no DNS or TLS overrides", () => {
  const target = mcpDockerTarget(hosted);
  assert.equal(target.appUrl, hosted.VN_MCP_TEST_APP_URL);
  assert.equal(target.origin, "https://visualnerve.caripson.com");
  assert.equal(target.expectedRevision, "b".repeat(40));
  const browser = mcpDockerBrowserOptions(target, "/test/chrome");
  assert.equal(browser.ignoreHTTPSErrors, false);
  assert.deepEqual(browser.launchOptions, {
    executablePath: "/test/chrome",
    args: [],
  });
});
test("hosted verification requires the reviewed artifact hash before any browser is opened", () => {
  assert.throws(
    () => mcpDockerTarget({ VN_MCP_TEST_APP_URL: hosted.VN_MCP_TEST_APP_URL }),
    /requires/,
  );
  for (const key of [
    "VN_MCP_TEST_EXPECTED_ENTRY_SHA256",
    "VN_MCP_TEST_EXPECTED_REVISION",
  ])
    assert.throws(
      () => mcpDockerTarget({ ...hosted, [key]: "partial-or-invalid" }),
      /complete/,
    );
});
test("production URLs, credentials, alternate origins and URL payloads are rejected", () => {
  for (const url of [
    "https://app.visualnerve.com/",
    "https://www.visualnerve.com/app/",
    "http://visualnerve.caripson.com/app/",
    "https://visualnerve.caripson.com/",
    "https://visualnerve.caripson.com/app/?data=private",
    "https://visualnerve.caripson.com/app/#secret",
    "https://user:pass@visualnerve.caripson.com/app/",
    "https://untrusted.invalid/app/",
  ])
    assert.throws(
      () => mcpDockerTarget({ ...hosted, VN_MCP_TEST_APP_URL: url }),
      /exactly/,
    );
});
