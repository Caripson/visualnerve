/** Real React/CSS rendering with a test-only controller, not a live relay test. */
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const output = `${root}tmp/collaboration-ui-screenshots`;

/** Check rendered controls rather than relying on a particular flex/grid rule. */
async function verifyControls(container, { viewport, theme }) {
  const result = await container.evaluate((element) => {
    const card = element.getBoundingClientRect();
    return {
      card: { left: card.left, right: card.right },
      controls: [...element.querySelectorAll("select, button")].map(
        (control) => {
          const bounds = control.getBoundingClientRect();
          return {
            name:
              control.getAttribute("aria-label") || control.textContent.trim(),
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            height: bounds.height,
          };
        },
      ),
    };
  });
  const detail = JSON.stringify({ viewport, theme, result });
  for (const control of result.controls) {
    assert.ok(
      control.left >= result.card.left - 1 &&
        control.right <= result.card.right + 1,
      `Control escapes its card: ${detail}`,
    );
    if (viewport.width <= 900)
      assert.ok(
        control.height >= 44,
        `Small-screen target below 44px: ${detail}`,
      );
  }
  for (let first = 0; first < result.controls.length; first++) {
    for (let second = first + 1; second < result.controls.length; second++) {
      const left = result.controls[first],
        right = result.controls[second];
      const overlapsHorizontally =
        Math.min(left.right, right.right) > Math.max(left.left, right.left) + 1;
      const overlapsVertically =
        Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top) + 1;
      assert.ok(
        !(overlapsHorizontally && overlapsVertically),
        `Controls overlap: ${detail}`,
      );
      if (overlapsVertically) {
        assert.ok(
          Math.abs(left.top - right.top) <= 1 &&
            Math.abs(left.bottom - right.bottom) <= 1,
          `Controls sharing a row are not aligned: ${detail}`,
        );
        assert.ok(
          Math.max(left.left, right.left) - Math.min(left.right, right.right) >=
            8,
          `Controls sharing a row have insufficient separation: ${detail}`,
        );
      } else if (overlapsHorizontally) {
        assert.ok(
          Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom) >=
            8,
          `Stacked controls have insufficient separation: ${detail}`,
        );
      }
    }
  }
}

function copyButton(page, name, value) {
  if (name === "Copy private invitation")
    return page.getByRole("button", { name, exact: true });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Visible public values are part of the accessible name (WCAG label-in-name).
  // Match the semantic action and its actual value without depending on punctuation.
  return page
    .getByRole("button", { name: new RegExp(`^${escaped}(?:$|\\s|:)`) })
    .filter({ has: page.getByText(value, { exact: true }) });
}

async function verifyCopy(page, { name, value, touch, keys = true }) {
  const button = copyButton(page, name, value);
  const field = page
    .locator(".collaboration-copy-field")
    .filter({ has: button });
  // A keyboard user may focus sensitive values without choosing to copy them.
  await page.evaluate(() =>
    navigator.clipboard.writeText("test-only-untouched"),
  );
  await button.focus();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "test-only-untouched",
    "Focus alone copied a value without deliberate activation.",
  );
  for (const activation of keys ? ["pointer", "Enter", "Space"] : ["pointer"]) {
    await page.evaluate(() =>
      navigator.clipboard.writeText("test-only-untouched"),
    );
    await button.scrollIntoViewIfNeeded();
    if (activation === "pointer") {
      if (touch) await button.tap();
      else await button.click();
    } else await button.press(activation);
    await page.waitForFunction(
      async (value) => (await navigator.clipboard.readText()) === value,
      value,
    );
    await field
      .getByRole("status")
      .filter({ hasText: /^Copied/i })
      .waitFor();
    assert.match(
      await field.getByRole("status").innerText(),
      /^Copied/i,
      "Successful clipboard writing must provide visible live feedback.",
    );
  }
}

async function verifyUnavailableClipboard(page, name, value) {
  const button = copyButton(page, name, value);
  const field = page
    .locator(".collaboration-copy-field")
    .filter({ has: button });
  await page.evaluate(() => {
    window.collaborationTestClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  try {
    await button.click();
    await field
      .getByRole("status")
      .filter({ hasText: /could not copy/i })
      .waitFor();
    assert.equal(
      await page.evaluate(() => getSelection()?.toString()),
      value,
      "A refused/unavailable clipboard must leave the entire value selected for manual copying.",
    );
  } finally {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: window.collaborationTestClipboard,
      });
      delete window.collaborationTestClipboard;
    });
  }
  await verifyCopy(page, { name, value, touch: false, keys: false });
}

async function verifyRejectedInvitationCopy(page, value) {
  const input = page.getByRole("textbox", { name: "Private invitation link" });
  const field = page
    .locator(".collaboration-copy-field")
    .filter({ has: input });
  await page.evaluate(() => {
    window.collaborationTestClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException(
            "Test-only clipboard permission refusal",
            "NotAllowedError",
          );
        },
      },
    });
  });
  try {
    await input.click();
    await field
      .getByRole("status")
      .filter({ hasText: /could not copy/i })
      .waitFor();
    assert.equal(
      await input.evaluate((element) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
      value,
      "A permission-refused invitation must remain completely selected for manual copying.",
    );
  } finally {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: window.collaborationTestClipboard,
      });
      delete window.collaborationTestClipboard;
    });
  }
}

await mkdir(output, { recursive: true });
const vite = await createServer({
  root: frontend,
  cacheDir: `${root}tmp/collaboration-ui-vite-cache`,
  envFile: false,
  configFile: `${frontend}vite.config.ts`,
  // This synthetic page is not the app entrypoint. Complete its dependencies
  // before navigation rather than letting discovery reload a partially loaded UI.
  optimizeDeps: {
    noDiscovery: true,
    include: ["react", "react/jsx-runtime", "react-dom/client", "lucide-react"],
  },
  server: { host: "127.0.0.1", port: 0, hmr: false },
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
      const context = await browser.newContext({
        viewport,
        hasTouch: viewport.width <= 390,
        isMobile: viewport.width <= 390,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
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
          invitation: {
            // A deliberately invalid synthetic invitation, never a real room token.
            url: "https://app.example/#collaboration=synthetic-ui-only",
            expiresAt: Date.now() + 60_000,
          },
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
              name: "Sam Patel · Operations and Capacity Planning",
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
      await verifyCopy(page, {
        name: "Copy Room ID",
        value: "review-room",
        touch: viewport.width <= 390,
      });
      await verifyCopy(page, {
        name: "Copy Owner device fingerprint",
        value: "a".repeat(64),
        touch: viewport.width <= 390,
        keys: false,
      });
      const invitation = page.getByRole("textbox", {
        name: "Private invitation link",
      });
      if (viewport.width <= 390) await invitation.tap();
      else await invitation.click();
      await page.waitForFunction(
        async () =>
          (await navigator.clipboard.readText()) ===
          "https://app.example/#collaboration=synthetic-ui-only",
      );
      await verifyCopy(page, {
        name: "Copy private invitation",
        value: "https://app.example/#collaboration=synthetic-ui-only",
        touch: viewport.width <= 390,
      });
      await verifyCopy(page, {
        name: "Copy Device ID",
        value: "joining-device",
        touch: viewport.width <= 390,
        keys: false,
      });
      await verifyCopy(page, {
        name: "Copy Device fingerprint",
        value: "c".repeat(64),
        touch: viewport.width <= 390,
        keys: false,
      });
      const editor = page
        .locator(".collaboration-participant")
        .filter({ hasText: "Sam Patel" });
      await editor.getByText("Device fingerprint", { exact: true }).click();
      await verifyCopy(page, {
        name: "Copy Device fingerprint · Sam Patel · Operations and Capacity Planning",
        value: "b".repeat(64),
        touch: viewport.width <= 390,
        keys: false,
      });
      if (viewport.width === 1440 && theme === "light") {
        await verifyUnavailableClipboard(page, "Copy Room ID", "review-room");
        await verifyRejectedInvitationCopy(
          page,
          "https://app.example/#collaboration=synthetic-ui-only",
        );
        await page.evaluate(() =>
          window.collaborationUiTest.emit({
            invitation: {
              url: "https://app.example/#collaboration=replacement-ui-only",
              expiresAt: Date.now() + 60_000,
            },
          }),
        );
        await page.waitForFunction(
          () =>
            document.querySelector(".collaboration-copy-input textarea")
              ?.value ===
            "https://app.example/#collaboration=replacement-ui-only",
        );
        await verifyCopy(page, {
          name: "Copy private invitation",
          value: "https://app.example/#collaboration=replacement-ui-only",
          touch: false,
        });
      }
      await page
        .getByRole("button", { name: "Approve device" })
        .scrollIntoViewIfNeeded();
      await verifyLayout();
      await verifyControls(page.locator(".collaboration-member-controls"), {
        viewport,
        theme,
      });
      await verifyControls(page.locator(".collaboration-request"), {
        viewport,
        theme,
      });
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
      await page.evaluate(() =>
        window.collaborationUiTest.emit({
          status: "awaiting-approval",
          role: undefined,
          selfDeviceId: "waiting-device",
          selfCredentialId: "d".repeat(64),
          participants: [],
          pendingJoins: [],
        }),
      );
      await verifyCopy(page, {
        name: "Copy Your device fingerprint",
        value: "d".repeat(64),
        touch: viewport.width <= 390,
      });
      await verifyLayout();
      await page.screenshot({
        path: `${output}/pending-${viewport.width}-${theme}.png`,
      });
      if (errors.length) throw new Error(`Browser errors ${errors.join("; ")}`);
      verified.push(
        `${viewport.width}×${viewport.height} ${theme}: creation, deliberate pointer/key copy with real clipboard readback and feedback, fingerprint approval, aligned controls, confirmation, WCAG and no horizontal overflow`,
      );
      await context.close();
    }
  }
  console.log(JSON.stringify({ verified, screenshots: output }, null, 2));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await vite.close();
}
