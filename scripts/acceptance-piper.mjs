// Opt-in acceptance test: real model downloads and local neural synthesis. Never run by normal CI.
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(
  pathToFileURL(join(root, "frontend/node_modules/playwright-core/index.mjs"))
    .href
);
import { spawn } from "node:child_process";
import { createBrowserProbes } from "./acceptance-piper/probes.mjs";
import {
  createDiagramHelpers,
  exportModelFixtures,
} from "./acceptance-piper/fixtures.mjs";
import { checkMovie } from "./acceptance-piper/movie.mjs";
import { runSpeechCases } from "./acceptance-piper/cases.mjs";
import {
  assertPortFree,
  waitForBridge,
  stopBridge,
} from "./acceptance-piper/server.mjs";
import { openSync, writeFileSync, mkdirSync } from "node:fs";
const port = Number(process.env.PIPER_ACCEPTANCE_PORT || 4328);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PIPER_ACCEPTANCE_PORT must be between 1024 and 65535.");
const origin = `http://127.0.0.1:${port}`;
const staticDir = resolve(process.env.PIPER_STATIC_DIR || join(root, "public"));
const outputDir = resolve(
  process.env.PIPER_ACCEPTANCE_OUTPUT ||
    join(tmpdir(), "visualnerve-piper-acceptance"),
);
mkdirSync(outputDir, { recursive: true });
const output = (name) => join(outputDir, name);
const fixtures = process.env.PIPER_MODEL_FIXTURES
  ? resolve(process.env.PIPER_MODEL_FIXTURES)
  : outputDir;
const env = { ...process.env };
for (const key of [
  "VISUAL_NERVE_BRIDGE_TOKEN",
  "VISUAL_NERVE_TLS_CERT",
  "VISUAL_NERVE_TLS_KEY",
  "VISUAL_NERVE_ALLOWED_ORIGINS",
])
  delete env[key];
await assertPortFree(port);
const bridge = spawn(
  join(root, "bin/visual-nerve"),
  ["--static", staticDir, "--bridge", "--addr", `127.0.0.1:${port}`],
  {
    env,
    stdio: [
      "ignore",
      openSync(output("browser-bridge.log"), "w"),
      openSync(output("browser-bridge.log"), "a"),
    ],
  },
);
let browser;
const results = { staticDir, cases: [], errors: [], remote: [], leaks: [] };
const marker = "PRIVATE_Q7F9R_SPEECH_TEXT";
const savedVoices = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { setup } = createBrowserProbes({
  fixtures,
  output,
  origin,
  results,
  marker,
  sleep,
  savedVoices,
});
const { diagram, waitPreload } = createDiagramHelpers({ sleep, marker });
const movieCheck = (page, api) =>
  checkMovie({
    page,
    api,
    diagram,
    waitPreload,
    root,
    output,
    origin,
    results,
  });
try {
  await waitForBridge(bridge, origin);
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
  });
  if (process.env.PIPER_MOVIE_ONLY === "1") {
    const { page, api } = await setup(context, {
      routeModels: Boolean(process.env.PIPER_MODEL_FIXTURES),
    });
    await movieCheck(page, api);
    await context.close();
  } else {
    await runSpeechCases({
      context,
      setup,
      diagram,
      waitPreload,
      movieCheck,
      output,
      sleep,
      results,
      fixtures,
      marker,
      browser,
      exportModelFixtures,
    });
  }
  if (results.errors.length || results.leaks.length)
    throw new Error(
      "Page/privacy errors " +
        JSON.stringify({ errors: results.errors, leaks: results.leaks }),
    );
  writeFileSync(
    output("browser-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...results,
        remote: results.remote.map((v) => ({
          host: new URL(v.url).hostname,
          method: v.method,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  writeFileSync(
    output("browser-results.json"),
    JSON.stringify({ ...results, failure: String(error) }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopBridge(bridge);
}
