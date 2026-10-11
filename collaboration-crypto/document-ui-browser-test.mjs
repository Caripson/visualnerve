/** Browser coverage for document forms, avatar canonicalization and accessibility. */
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}tmp/collaboration-document-review`;
await mkdir(output, { recursive: true });
const vite = await createServer({
  root: `${root}frontend`,
  cacheDir: `${output}/vite-cache`,
  envFile: false,
  configFile: `${root}frontend/vite.config.ts`,
  // This routed fixture is not the application entrypoint. Prebundle its full
  // dependency graph before navigation so discovery cannot reset form state.
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react-dom/client",
      "lucide-react",
      "zustand",
      "yjs",
      "papaparse",
      "dexie",
      "@xyflow/react",
      "elkjs/lib/elk-api.js",
    ],
  },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
const errors = [];
const verified = [];
async function layout(page, detail) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  const result = await page
    .locator(".document-workspace")
    .evaluate((element) => {
      const modal = element.closest(".modal").getBoundingClientRect();
      return {
        modal: { left: modal.left, right: modal.right },
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        controls: [...element.querySelectorAll("input,button,select,textarea")]
          .filter((control) => control.getClientRects().length)
          .map((control) => {
            const bounds = control.getBoundingClientRect();
            return {
              name:
                control.getAttribute("aria-label") ||
                control.textContent.trim(),
              left: bounds.left,
              right: bounds.right,
              height: bounds.height,
            };
          }),
      };
    });
  const message = JSON.stringify({ ...detail, result });
  assert.ok(!result.overflow, `Page overflows: ${message}`);
  for (const control of result.controls) {
    assert.ok(
      control.left >= result.modal.left - 1 &&
        control.right <= result.modal.right + 1,
      `Control escapes modal: ${message}`,
    );
    if (detail.viewport.width <= 900)
      assert.ok(control.height >= 44, `Touch target below44px: ${message}`);
  }
  const a11y = await page.evaluate(async () =>
    window.axe.run(document.querySelector(".document-workspace"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }),
  );
  assert.deepEqual(
    a11y.violations.map((issue) => ({
      id: issue.id,
      nodes: issue.nodes.map((node) => node.target),
    })),
    [],
    `Accessibility violations: ${message}`,
  );
  verified.push(detail);
}
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const html = await vite.transformIndexHtml(
    "/document-work-harness",
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document workflow verification</title></head><body><div id="root"></div><script type="module" src="/tests/browser/collaboration-document-workspace-harness.tsx"></script></body></html>',
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 980 },
  ]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport,
        isMobile: viewport.width <= 390,
        hasTouch: viewport.width <= 390,
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/document-work-harness", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      await page.goto(`${origin}/document-work-harness`);
      await page
        .getByRole("dialog", { name: "Document work", exact: true })
        .waitFor();
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.addScriptTag({
        path: `${root}frontend/node_modules/axe-core/axe.min.js`,
      });
      for (const tab of ["Profiles", "Comments", "Tasks", "Activity"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await layout(page, { viewport, theme, tab, mode: "read" });
        if (tab === "Profiles")
          await page
            .getByRole("button", { name: "Create profile", exact: true })
            .click();
        if (tab === "Tasks")
          await page
            .getByRole("button", { name: "Create task", exact: true })
            .click();
        if (tab === "Profiles" || tab === "Tasks") {
          await layout(page, { viewport, theme, tab, mode: "form" });
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        }
        if (viewport.width === 390 || viewport.width === 1440)
          await page
            .getByRole("dialog", { name: "Document work", exact: true })
            .screenshot({
              path: `${output}/${viewport.width}-${theme}-${tab.toLowerCase()}.png`,
            });
      }
      // Exercise browser-native decoding/resize/re-encoding, rather than mock canvas APIs.
      await page.getByRole("tab", { name: "Profiles", exact: true }).click();
      await page
        .getByRole("button", { name: "Create profile", exact: true })
        .click();
      await page
        .getByLabel("Profile name", { exact: true })
        .fill("Raster avatar");
      const data = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 900;
        canvas.height = 500;
        const context = canvas.getContext("2d");
        context.fillStyle = "#2563eb";
        context.fillRect(0, 0, 900, 500);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      const rejectedSources = await page.evaluate(async (data) => {
        const { normalizeProfileAvatar } =
          await import("/src/collaboration/ui/document/avatar-upload.ts");
        const decode = window.createImageBitmap;
        let calls = 0;
        window.createImageBitmap = (...args) => {
          calls++;
          return decode(...args);
        };
        const results = [];
        try {
          for (const [width, height] of [
            [16385, 1],
            [8000, 4001],
          ]) {
            const bytes = Uint8Array.from(atob(data), (value) =>
              value.charCodeAt(0),
            );
            const header = new DataView(bytes.buffer);
            header.setUint32(16, width);
            header.setUint32(20, height);
            try {
              await normalizeProfileAvatar(
                new File([bytes], "oversized.png", { type: "image/png" }),
              );
              results.push(false);
            } catch {
              results.push(true);
            }
          }
          return { results, calls };
        } finally {
          window.createImageBitmap = decode;
        }
      }, data);
      assert.deepEqual(rejectedSources, { results: [true, true], calls: 0 });
      await page.getByLabel("Avatar image", { exact: true }).setInputFiles({
        name: "large-local.png",
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      });
      await page
        .getByRole("button", { name: "Remove avatar", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .locator(".document-profile-heading > strong")
        .filter({ hasText: "Raster avatar" })
        .waitFor();
      const avatar = await page.evaluate(
        () =>
          window.collaborationDocumentUiTest
            .graph()
            .diagram.collaboration.profiles.find(
              (profile) => profile.name === "Raster avatar",
            ).avatarDataUrl,
      );
      const dimensions = await page.evaluate(async (avatar) => {
        const image = await createImageBitmap(
          await (await fetch(avatar)).blob(),
        );
        const result = { width: image.width, height: image.height };
        image.close();
        return result;
      }, avatar);
      assert.ok(dimensions.width <= 256 && dimensions.height <= 256);
      assert.ok(
        Buffer.from(avatar.split(",")[1], "base64").length <= 64 * 1024,
      );
      assert.match(avatar, /^data:image\/(png|webp);base64,/);
      await page.evaluate(() =>
        window.collaborationDocumentUiTest.role("viewer"),
      );
      for (const tab of ["Profiles", "Comments", "Tasks", "Activity"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await layout(page, { viewport, theme, tab, mode: "viewer" });
        assert.equal(
          await page
            .locator(
              '.document-workspace input,.document-workspace textarea,.document-workspace button:not([role="tab"])',
            )
            .count(),
          0,
          "Viewer retains write controls",
        );
      }
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/verified.json`,
    JSON.stringify({ verified, errors }, null, 2),
  );
  console.log(
    `Verified ${verified.length} document UI/accessibility layouts, avatar bounds before decoding and native normalization; screenshots: ${output}`,
  );
} finally {
  await browser?.close();
  await vite.close();
}
