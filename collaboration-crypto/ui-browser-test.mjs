/** Real React/CSS rendering with a test-only controller, not a live relay test. */
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
const root = fileURLToPath(new URL("../", import.meta.url));
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const output = `${root}tmp/collaboration-ui-screenshots`;
await mkdir(output, { recursive: true });
const vite = await createServer({
  root: frontend,
  envFile: false,
  configFile: `${frontend}vite.config.ts`,
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
const deadline = setTimeout(() => {
  console.error("Collaboration UI verification exceeded 120 seconds.");
  process.exit(1);
}, 120_000);
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const html = await vite.transformIndexHtml(
    "/collaboration-ui-harness",
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collaboration component verification</title></head><body><div id="root"></div><script type="module" src="/tests/browser/collaboration-ui-harness.tsx"></script></body></html>',
  );
  const verified = [];
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(20_000);
      await page.route("**/collaboration-ui-harness", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/collaboration-ui-harness`);
      await page.getByRole("dialog", { name: "Live collaboration" }).waitFor();
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      // Theme changes trigger the existing 100 ms button background transition;
      // audit its settled colors rather than a mixed light/dark transition frame.
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState !== "running"),
      );
      await page.addScriptTag({
        path: `${frontend}node_modules/axe-core/axe.min.js`,
      });
      const verifyLayout = async () => {
        const result = await page.evaluate(async () => {
          const modal = document.querySelector(".collaboration-panel");
          const a11y = await window.axe.run(modal, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return {
            scrollWidth: modal.scrollWidth,
            clientWidth: modal.clientWidth,
            violations: a11y.violations.map(({ id, nodes }) => ({
              id,
              targets: nodes.map((node) => ({
                target: node.target,
                detail: node.failureSummary,
              })),
            })),
          };
        });
        if (result.scrollWidth > result.clientWidth + 1)
          throw new Error(
            `Horizontal overflow ${JSON.stringify({ viewport, theme, result })}`,
          );
        if (result.violations.length)
          throw new Error(
            `Accessibility violations ${JSON.stringify({ viewport, theme, result })}`,
          );
      };
      await verifyLayout();
      await page.screenshot({
        path: `${output}/create-${viewport.width}-${theme}.png`,
      });
      await page.evaluate(() =>
        window.collaborationUiTest.emit({
          status: "live",
          roomId: "review-room",
          role: "owner",
          selfDeviceId: "owner-device",
          ownerCredentialId: "a".repeat(64),
          participants: [
            {
              deviceId: "owner-device",
              name: "Casey Morgan",
              role: "owner",
              credentialId: "a".repeat(64),
              connected: true,
              selectedNodeIds: [],
              lastSeen: Date.now(),
            },
            {
              deviceId: "editor-device",
              name: "Sam Patel",
              role: "editor",
              credentialId: "b".repeat(64),
              connected: true,
              selectedNodeIds: ["review-node"],
              lastSeen: Date.now(),
            },
          ],
          pendingJoins: [
            {
              deviceId: "joining-device",
              credentialId: "c".repeat(64),
              expiresAt: Date.now() + 60_000,
            },
          ],
        }),
      );
      await page
        .getByRole("button", { name: "Approve device" })
        .scrollIntoViewIfNeeded();
      await verifyLayout();
      await page.screenshot({
        path: `${output}/approval-${viewport.width}-${theme}.png`,
      });
      await page.getByRole("button", { name: "Remove participant" }).click();
      await page.getByRole("alertdialog").waitFor();
      await page
        .getByRole("button", { name: "Cancel", exact: true })
        .scrollIntoViewIfNeeded();
      await verifyLayout();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      if (
        (
          await page.evaluate(() => window.collaborationUiTest.actions)
        ).includes("remove")
      )
        throw new Error("Cancel invoked a destructive action.");
      if (errors.length) throw new Error(`Browser errors ${errors.join("; ")}`);
      verified.push(
        `${viewport.width}×${viewport.height} ${theme}: creation, fingerprint approval, confirmation, WCAG and no horizontal overflow`,
      );
      await page.close();
    }
  }
  console.log(JSON.stringify({ verified, screenshots: output }, null, 2));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await vite.close();
}
