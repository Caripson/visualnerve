import { pathToFileURL } from "node:url";

/** Explicit fixture targets: never silently run the test against production. */
export function mcpDockerTarget(environment = process.env) {
  const appUrl =
    environment.VN_MCP_TEST_APP_URL || "https://mcp-docker.test:4342/";
  const hosted = appUrl === "https://visualnerve.caripson.com/app/";
  if (!hosted && appUrl !== "https://mcp-docker.test:4342/")
    throw new Error(
      "Use the local fixture URL or https://visualnerve.caripson.com/app/ exactly.",
    );
  const expectedEntrySha256 = environment.VN_MCP_TEST_EXPECTED_ENTRY_SHA256;
  const expectedRevision = environment.VN_MCP_TEST_EXPECTED_REVISION;
  if (expectedEntrySha256 && !/^[a-f0-9]{64}$/.test(expectedEntrySha256))
    throw new Error(
      "Expected entry SHA256 must be a complete lowercase SHA256 hash.",
    );
  if (expectedRevision && !/^[a-f0-9]{40}$/.test(expectedRevision))
    throw new Error(
      "Expected revision must be a complete lowercase Git commit SHA.",
    );
  if (hosted && !expectedEntrySha256)
    throw new Error(
      "Hosted staging requires VN_MCP_TEST_EXPECTED_ENTRY_SHA256 from the reviewed build artifact.",
    );
  return {
    appUrl,
    origin: new URL(appUrl).origin,
    hosted,
    expectedEntrySha256,
    expectedRevision,
  };
}

export function mcpDockerBrowserOptions(target, executablePath) {
  return {
    ignoreHTTPSErrors: !target.hosted,
    launchOptions: {
      ...(executablePath ? { executablePath } : { channel: "chrome" }),
      // Real hosted staging uses normal DNS and TLS trust, without overrides.
      args: target.hosted
        ? []
        : [
            "--host-resolver-rules=MAP mcp-docker.test 127.0.0.1",
            "--no-proxy-server",
            "--ignore-certificate-errors",
          ],
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] !== "--origin")
    throw new Error("Usage: config.mjs --origin");
  console.log(mcpDockerTarget().origin);
}
