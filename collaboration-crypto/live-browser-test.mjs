/** Two actual encrypted workspaces + MLS workers + local Cloudflare DO relay.
 * Never reads .env or uses a Cloudflare API credential. No mock controller/crypto.
 */
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const frontend = `${root}frontend`;
const origin = "http://127.0.0.1:5177";
const relay = "http://127.0.0.1:4358";
const shareCsv = process.env.COLLABORATION_TEST_SHARE_CSV === "1";
const output = `${root}tmp/collaboration-live-screenshots${shareCsv ? "-csv" : ""}`;
await mkdir(output, { recursive: true });
const emptyEnvFile = `${output}/test-only-empty.env`;
await writeFile(
  emptyEnvFile,
  "# Local test intentionally uses no deployment credentials.\n",
);
let worker;
const workerOutput = [];
if (!process.env.COLLABORATION_TEST_EXTERNAL_RELAY) {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  for (const key of Object.keys(env))
    if (/^(CLOUDFLARE_|CF_API_|WRANGLER_API_)/.test(key)) delete env[key];
  worker = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--local",
      "--env-file",
      emptyEnvFile,
      "--port",
      "4358",
      "--ip",
      "127.0.0.1",
      "--var",
      "ENABLED:true",
      "--var",
      `ALLOWED_ORIGINS:${origin}`,
    ],
    {
      cwd: `${root}collaboration-worker`,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [worker.stdout, worker.stderr])
    stream.on("data", (chunk) => workerOutput.push(chunk.toString()));
}
const vite = await createServer({
  root: frontend,
  cacheDir: `${root}tmp/collaboration-live-vite-cache`,
  envFile: false,
  configFile: `${frontend}/vite.config.ts`,
  // This fixture intentionally has no app entrypoint. Explicit prebundles avoid
  // discovery-triggered development reloads destroying its live MLS sessions.
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react-dom/client",
      "zustand",
      "lucide-react",
      "yjs",
      "papaparse",
      "dexie",
      "@xyflow/react",
      "elkjs/lib/elk-api.js",
    ],
  },
  server: { host: "127.0.0.1", port: 5177, strictPort: true, hmr: false },
});
let browser, owner, guest;
const deadline = setTimeout(() => {
  console.error("Live collaboration test exceeded 240 seconds.");
  worker?.kill("SIGTERM");
  process.exit(1);
}, 240_000);
const checked = [],
  errors = [];
const evaluate = (page, method, ...args) =>
  page.evaluate(
    async ([method, args]) => window.collaborationLiveTest[method](...args),
    [method, args],
  );
const waitStatus = (page, status) =>
  page.waitForFunction(
    (status) => window.collaborationLiveTest?.snapshot().status === status,
    status,
    { timeout: 30_000 },
  );
const waitTitle = (page, title) =>
  page.waitForFunction(
    async (title) =>
      (await window.collaborationLiveTest.graph()).nodes[0].title === title,
    title,
    { timeout: 30_000 },
  );
try {
  for (let n = 0; ; n++) {
    try {
      const health = await fetch(`${relay}/health`).then((response) =>
        response.json(),
      );
      if (health.enabled) break;
    } catch {}
    if (n === 120)
      throw new Error(`Local relay did not start: ${workerOutput.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const html = await vite.transformIndexHtml(
    "/collaboration-live-harness",
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual encrypted collaboration integration test</title></head><body><div id="root"></div><script type="module" src="/tests/browser/collaboration-live-harness.tsx"></script></body></html>',
  );
  for (const name of ["owner", "guest"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    // Chrome155 asks for loopback permission, even for these local test pages.
    // Grant only this fixture origin; no browser security checks are disabled.
    await context.grantPermissions(["local-network-access"], { origin });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error(`${name} console: ${message.text()}`);
    });
    page.on("requestfailed", (request) =>
      console.error(
        `${name} request failed: ${request.url()} ${request.failure()?.errorText}`,
      ),
    );
    await page.route("**/collaboration-live-harness?*", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.goto(
      `${origin}/collaboration-live-harness?relay=${encodeURIComponent(relay)}${shareCsv ? "&shareCsv=1" : ""}`,
    );
    await page.getByRole("dialog", { name: "Live collaboration" }).waitFor();
    if (name === "owner") owner = page;
    else guest = page;
  }
  await owner.getByLabel("Your display name").fill("Owner browser");
  if (shareCsv)
    await owner.getByLabel("Raw datasets and CSV analysis data").check();
  await owner
    .getByLabel(
      "I have reviewed the diagram and am allowed to share this information.",
    )
    .check();
  await owner.getByRole("button", { name: "Start private room" }).click();
  await waitStatus(owner, "live");
  checked.push(
    "Actual owner creates room using UI and encrypted IndexedDB/MLS",
  );
  await owner
    .getByRole("button", { name: "Create one-use invitation" })
    .click();
  const invitation = await owner
    .getByRole("textbox", { name: "Private invitation link", exact: true })
    .inputValue();
  await guest.getByRole("button", { name: "Join a room", exact: true }).click();
  await guest.getByLabel("Your display name").fill("Guest browser");
  await guest
    .getByRole("textbox", { name: "Private invitation link", exact: true })
    .fill(invitation);
  await guest.getByRole("button", { name: "Request to join" }).click();
  await waitStatus(guest, "awaiting-approval");
  await owner.getByRole("button", { name: "Approve device" }).waitFor();
  const pendingFingerprint = (await evaluate(guest, "snapshot"))
    .selfCredentialId;
  assert.match(pendingFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    await guest.getByText(pendingFingerprint, { exact: true }).count(),
    1,
  );
  await guest.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await guest.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await guest.waitForFunction(() =>
      document
        .getAnimations()
        .every((animation) => animation.playState !== "running"),
    );
    await guest.screenshot({ path: `${output}/pending-mobile-${theme}.png` });
  }
  await guest.setViewportSize({ width: 1440, height: 900 });
  await owner.locator(".collaboration-request select").selectOption("editor");
  await owner.getByRole("button", { name: "Approve device" }).click();
  await waitStatus(guest, "live");
  const sharedOwner = await evaluate(owner, "graph"),
    sharedGuest = await evaluate(guest, "graph");
  assert.equal(sharedGuest.diagram.id, sharedOwner.diagram.id);
  assert.equal(sharedGuest.nodes[0].title, "Shared initial node");
  assert.equal(sharedGuest.nodes[0].metadata.privateMarker, undefined);
  const expectedRows = shareCsv ? sharedOwner.dataset.rows : undefined;
  if (shareCsv) assert.deepEqual(sharedGuest.dataset.rows, expectedRows);
  checked.push(
    "One-use invitation, explicit owner approval, authenticated shared snapshot and excluded metadata",
  );
  await evaluate(owner, "clearCommits");
  await evaluate(guest, "clearCommits");
  await evaluate(owner, "edit", "Owner API edit");
  await waitTitle(guest, "Owner API edit");
  await evaluate(guest, "edit", "Guest UI edit", "ui");
  await waitTitle(owner, "Guest UI edit");
  if (shareCsv) {
    for (const page of [owner, guest])
      assert.deepEqual(
        (await evaluate(page, "graph")).dataset.rows,
        expectedRows,
      );
    checked.push(
      "Opted-in CSV rows survive actual bidirectional UI autosave and repository/API updates in both encrypted vaults",
    );
  }
  for (const page of [owner, guest]) {
    const commits = await evaluate(page, "commits");
    assert.ok(
      commits.some(
        (item) =>
          item.stores.includes("nodes") &&
          item.stores.includes("collaboration"),
      ),
      "Graph + CRDT/outbox must commit in one physical vault transaction",
    );
    const disk = JSON.stringify(await evaluate(page, "raw"));
    assert.doesNotMatch(
      disk,
      /Shared initial node|Owner API edit|Guest UI edit|NEVER-SHARE-METADATA/,
    );
  }
  checked.push(
    "Bidirectional Workspace API/UI edits; both vault journals atomically commit graph+CRDT/outbox; disk has only ciphertext",
  );
  const graphBefore = await evaluate(guest, "graph"),
    privateBefore = await evaluate(guest, "privateState");
  await evaluate(guest, "failNextAtomic");
  const rejected = await guest.evaluate(async () => {
    try {
      await window.collaborationLiveTest.edit("MUST-NOT-COMMIT");
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(rejected, /atomic vault commit failure/);
  assert.deepEqual(await evaluate(guest, "graph"), graphBefore);
  assert.deepEqual(await evaluate(guest, "privateState"), privateBefore);
  await evaluate(guest, "edit", "Commit after rollback");
  await waitTitle(owner, "Commit after rollback");
  checked.push(
    "Injected physical commit failure rolls back graph and encrypted outbox together; next MLS ratchet message still works",
  );
  const epochBefore = await evaluate(guest, "epoch");
  await evaluate(guest, "disconnect");
  await evaluate(guest, "edit", "Encrypted offline edit");
  await waitStatus(guest, "offline");
  assert.ok(
    (await evaluate(guest, "privateState")).pending.length > 0,
    "Offline edit must have a durable encrypted outbox",
  );
  assert.equal(
    (await evaluate(owner, "graph")).nodes[0].title,
    "Commit after rollback",
  );
  await evaluate(guest, "reconnect");
  await waitStatus(guest, "live");
  assert.equal(await evaluate(guest, "epoch"), epochBefore);
  await waitTitle(owner, "Encrypted offline edit");
  await evaluate(guest, "edit", "Same epoch after reconnect");
  await waitTitle(owner, "Same epoch after reconnect");
  checked.push(
    "Offline edit persists with encrypted outbox; reconnect reconciles the full document using a fresh proof and unchanged live MLS epoch",
  );
  await Promise.all([
    evaluate(owner, "patchUi", { x: 777 }),
    evaluate(guest, "patchUi", { description: "Concurrent editor detail" }),
  ]);
  for (const page of [owner, guest]) {
    await page.waitForFunction(async () => {
      const graph = await window.collaborationLiveTest.graph();
      return (
        graph.nodes[0].x === 777 &&
        graph.nodes[0].description === "Concurrent editor detail"
      );
    });
  }
  checked.push(
    "Concurrent UI edits to separate fields converge without losing either change across the two encrypted repositories",
  );
  const freshJoin = async (role, name) => {
    await owner
      .getByRole("button", { name: "Create one-use invitation" })
      .click();
    const invitation = await owner
      .getByRole("textbox", { name: "Private invitation link", exact: true })
      .inputValue();
    await guest
      .getByRole("button", { name: "Join a room", exact: true })
      .click();
    await guest.getByLabel("Your display name").fill(name);
    await guest
      .getByRole("textbox", { name: "Private invitation link", exact: true })
      .fill(invitation);
    await guest.getByRole("button", { name: "Request to join" }).click();
    await owner.getByRole("button", { name: "Approve device" }).waitFor();
    await owner.locator(".collaboration-request select").selectOption(role);
    await owner.getByRole("button", { name: "Approve device" }).click();
    await waitStatus(guest, "live");
  };
  const removeNamed = async (name) => {
    await owner
      .locator(".collaboration-participant")
      .filter({ hasText: name })
      .getByRole("button", { name: "Remove participant" })
      .click();
    await owner
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await waitStatus(owner, "live");
  };
  const previousDevice = (await evaluate(guest, "snapshot")).selfDeviceId;
  await evaluate(guest, "disconnect");
  await evaluate(guest, "edit", "Recover unsent editor work");
  await waitStatus(guest, "offline");
  await evaluate(guest, "leave");
  await waitStatus(guest, "idle");
  await freshJoin("editor", "Recovery editor");
  assert.notEqual(
    (await evaluate(guest, "snapshot")).selfDeviceId,
    previousDevice,
  );
  await waitTitle(owner, "Recover unsent editor work");
  await removeNamed("Guest browser");
  checked.push(
    "Fresh MLS device approved into the same encrypted vault merges and republishes previously unsent editor work",
  );
  const participantSelect = owner
    .locator(".collaboration-participant")
    .filter({ hasText: "Recovery editor" })
    .locator("select");
  // The owner may change policy again before another device has finished its
  // prior synchronization. Do not hide legitimate transport/epoch races with
  // an artificial per-peer acknowledgement wait between owner UI operations.
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const role of ["viewer", "editor"]) {
      await participantSelect.selectOption(role);
      await owner
        .getByRole("button", { name: "Confirm change", exact: true })
        .click();
      await waitStatus(owner, "live");
    }
  }
  await guest.waitForFunction(
    () =>
      window.collaborationLiveTest.snapshot().role === "editor" &&
      window.collaborationLiveTest.snapshot().status === "live",
  );
  assert.equal(await evaluate(guest, "epoch"), await evaluate(owner, "epoch"));
  checked.push(
    "Five back-to-back owner viewer/editor policy cycles converge without waiting for peer synchronization between transitions",
  );
  await participantSelect.selectOption("viewer");
  await owner
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await guest.waitForFunction(
    () => window.collaborationLiveTest.snapshot().role === "viewer",
  );
  let denied;
  for (let attempt = 0; attempt < 3; attempt++) {
    denied = await guest.evaluate(async () => {
      try {
        await window.collaborationLiveTest.edit("VIEWER-FORBIDDEN");
        return null;
      } catch (error) {
        return { status: error.status, message: error.message };
      }
    });
    if (denied?.status !== 409) break;
  }
  assert.equal(denied.status, 403);
  await evaluate(owner, "edit", "Viewer can read owner edits");
  await waitTitle(guest, "Viewer can read owner edits");
  checked.push(
    "Owner-signed role rotation; viewer API writes denied, future authorized owner updates still readable",
  );
  await participantSelect.selectOption("editor");
  await owner
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await guest.waitForFunction(
    () =>
      window.collaborationLiveTest.snapshot().role === "editor" &&
      window.collaborationLiveTest.snapshot().status === "live",
  );
  await evaluate(guest, "disconnect");
  await evaluate(guest, "edit", "Viewer recovery must remain private");
  await waitStatus(guest, "offline");
  await evaluate(guest, "leave");
  await freshJoin("viewer", "Recovery viewer");
  await waitTitle(guest, "Viewer can read owner edits");
  await guest.waitForFunction(
    () => !!window.collaborationLiveTest.snapshot().recoveryCopy,
  );
  const recovery = (await evaluate(guest, "snapshot")).recoveryCopy;
  const recoveryGraph = await evaluate(guest, "graphById", recovery.diagramId);
  assert.equal(
    recoveryGraph.nodes[0].title,
    "Viewer recovery must remain private",
  );
  assert.equal(
    (await evaluate(owner, "graph")).nodes[0].title,
    "Viewer can read owner edits",
  );
  await guest
    .getByText(/Your unsent changes were kept in a local recovery diagram/)
    .waitFor();
  await removeNamed("Recovery editor");
  checked.push(
    "Fresh viewer admission follows only the owner state; unsent former-editor changes survive in a separate local recovery copy without being published",
  );
  await owner.screenshot({ path: `${output}/owner-desktop-live.png` });
  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.screenshot({ path: `${output}/viewer-mobile-live.png` });
  await guest.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await guest.screenshot({ path: `${output}/viewer-mobile-dark-live.png` });
  await owner.addScriptTag({
    path: `${frontend}/node_modules/axe-core/axe.min.js`,
  });
  for (const width of [390, 768, 1440]) {
    await owner.setViewportSize({ width, height: width === 1440 ? 900 : 1024 });
    for (const theme of ["light", "dark"]) {
      await owner.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.querySelector(".collaboration-panel").scrollTop = 0;
      }, theme);
      await owner.waitForFunction(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState !== "running"),
      );
      const result = await owner.evaluate(async () => {
        const modal = document.querySelector(".collaboration-panel");
        const audit = await window.axe.run(modal, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        });
        return {
          overflow: modal.scrollWidth > modal.clientWidth + 1,
          violations: audit.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((node) => node.target),
          })),
        };
      });
      assert.equal(result.overflow, false);
      assert.deepEqual(result.violations, []);
      await owner.screenshot({
        path: `${output}/owner-${width}-${theme}-live.png`,
      });
      if (width === 1440) {
        await owner.evaluate(() => {
          const modal = document.querySelector(".collaboration-panel");
          const participants = document.querySelector(
            'section[aria-label="People in this room"]',
          );
          for (const identity of participants.querySelectorAll("details"))
            identity.open = true;
          modal.scrollTop +=
            participants.getBoundingClientRect().top -
            modal.getBoundingClientRect().top -
            84;
        });
        await owner.screenshot({
          path: `${output}/owner-members-desktop-${theme}.png`,
        });
      }
    }
  }
  checked.push(
    "Actual approved-room controls at mobile/tablet/desktop in light/dark pass WCAG audits without horizontal overflow",
  );
  await owner
    .locator(".collaboration-participant")
    .filter({ hasText: "Recovery viewer" })
    .getByRole("button", { name: "Remove participant" })
    .click();
  await owner
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await guest.waitForFunction(() =>
    ["offline", "error"].includes(
      window.collaborationLiveTest.snapshot().status,
    ),
  );
  await evaluate(owner, "edit", "Future message after removal");
  assert.equal(
    (await evaluate(guest, "graph")).nodes[0].title,
    "Viewer can read owner edits",
  );
  checked.push(
    "Removed device cannot receive future document messages; previously copied local diagram remains",
  );
  if (shareCsv)
    for (const page of [owner, guest])
      assert.deepEqual(
        (await evaluate(page, "graph")).dataset.rows,
        expectedRows,
      );
  await evaluate(owner, "lock");
  assert.equal((await evaluate(owner, "snapshot")).status, "idle");
  assert.equal(await evaluate(owner, "epoch"), undefined);
  assert.equal((await evaluate(owner, "snapshot")).participants.length, 0);
  checked.push(
    "Vault lock clears room, presence, MLS worker state and live private-key capabilities",
  );
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(
    JSON.stringify({ verified: checked, screenshots: output }, null, 2),
  );
} catch (error) {
  console.error(error);
  const publicSnapshot = async (page) => {
    const state = page && (await evaluate(page, "snapshot").catch(() => null));
    if (state?.invitation)
      state.invitation = { expiresAt: state.invitation.expiresAt };
    return state;
  };
  console.error(
    JSON.stringify(
      {
        verified: checked,
        owner: await publicSnapshot(owner),
        guest: await publicSnapshot(guest),
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.error(workerOutput.slice(-8).join(""));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await vite.close();
  worker?.kill("SIGTERM");
}
