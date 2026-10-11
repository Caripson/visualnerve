/** Check presence against actual React Flow controls and application CSS. */
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}tmp/collaboration-presence-review`;
await mkdir(output, { recursive: true });
const vite = await createServer({
  root: `${root}frontend`,
  configFile: `${root}frontend/vite.config.ts`,
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
const verified = [];
const errors = [];
const selector =
  ".react-flow__controls,.canvas-tools-panel,.context-toolbar,.spatial-toolbar,.spatial-caption,.spatial-object-list,.presentation-player,.app-update-notice";
async function verify(page, detail) {
  const presence = page.locator(".collaboration-presence");
  await page.waitForFunction(
    () => !!document.querySelector(".collaboration-presence")?.dataset.docked,
  );
  if ((await presence.getAttribute("data-docked")) === "unavailable") {
    assert.equal(
      detail.scenario,
      "layers",
      `Unexpected absence of canvas space: ${JSON.stringify(detail)}`,
    );
    const header = page.getByRole("button", {
      name: "Participants",
      exact: true,
    });
    await header.click();
    assert.equal(
      (await page.evaluate(() => window.collaborationPresenceTest.actions)).at(
        -1,
      ),
      "presence",
    );
    verified.push({ ...detail, headerFallback: true });
    return;
  }
  await presence.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document.querySelector(".collaboration-presence")?.dataset.docked ===
      "true",
  );
  const result = await presence.evaluate((button, selector) => {
    const rect = button.getBoundingClientRect();
    const canvas = document
      .querySelector(".canvas-shell")
      .getBoundingClientRect();
    const controls = [...document.querySelectorAll(selector)]
      .filter((element) => element.getClientRects().length)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          className: element.className,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      });
    const center = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      },
      canvas: {
        left: canvas.left,
        right: canvas.right,
        top: canvas.top,
        bottom: canvas.bottom,
      },
      controls,
      reachable: center === button || button.contains(center),
      avatars: button.querySelectorAll(".collaboration-presence-avatar").length,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  }, selector);
  const message = JSON.stringify({ ...detail, result });
  assert.ok(result.reachable, `Presence click intercepted: ${message}`);
  assert.ok(!result.overflow, `Horizontal overflow: ${message}`);
  assert.equal(result.avatars, 3, `Unbounded avatar population: ${message}`);
  assert.ok(
    result.rect.left >= result.canvas.left + 11 &&
      result.rect.right <= result.canvas.right - 11 &&
      result.rect.top >= result.canvas.top + 11 &&
      result.rect.bottom <= result.canvas.bottom - 11,
    `Presence escapes canvas: ${message}`,
  );
  if (detail.viewport.width <= 900)
    assert.ok(result.rect.height >= 44, `Small touch target: ${message}`);
  for (const control of result.controls) {
    const overlapX =
      Math.min(result.rect.right, control.right) >
      Math.max(result.rect.left, control.left);
    const overlapY =
      Math.min(result.rect.bottom, control.bottom) >
      Math.max(result.rect.top, control.top);
    assert.ok(
      !(overlapX && overlapY),
      `Presence overlaps existing controls: ${message}`,
    );
    if (overlapY)
      assert.ok(
        Math.max(result.rect.left, control.left) -
          Math.min(result.rect.right, control.right) >=
          7,
        `Insufficient horizontal gap: ${message}`,
      );
    if (overlapX)
      assert.ok(
        Math.max(result.rect.top, control.top) -
          Math.min(result.rect.bottom, control.bottom) >=
          7,
        `Insufficient vertical gap: ${message}`,
      );
  }
  await presence.click();
  assert.equal(
    (await page.evaluate(() => window.collaborationPresenceTest.actions)).at(
      -1,
    ),
    "presence",
  );
  if (detail.scenario === "2d") {
    const before = (
      await page.evaluate(() => window.collaborationPresenceTest.actions)
    ).length;
    await presence.focus();
    await presence.press("Enter");
    assert.equal(
      (await page.evaluate(() => window.collaborationPresenceTest.actions))
        .length,
      before + 1,
      "Presence must activate from the keyboard",
    );
    if (detail.viewport.width <= 390) await presence.tap();
  }
  for (const control of await page
    .locator(
      selector
        .split(",")
        .map((part) => `${part} button,${part} summary`)
        .join(","),
    )
    .all()) {
    if (!(await control.isVisible())) continue;
    const clickable = await control.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      if (
        bounds.right <= 0 ||
        bounds.bottom <= 0 ||
        bounds.left >= innerWidth ||
        bounds.top >= innerHeight
      )
        return true;
      const hit = document.elementFromPoint(
        Math.max(0, bounds.left) +
          Math.min(bounds.width, innerWidth - Math.max(0, bounds.left)) / 2,
        Math.max(0, bounds.top) +
          Math.min(bounds.height, innerHeight - Math.max(0, bounds.top)) / 2,
      );
      return !hit?.closest(".collaboration-live-overlay");
    });
    assert.ok(clickable, `Existing click target intercepted: ${message}`);
  }
  verified.push(detail);
}
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const html = await vite.transformIndexHtml(
    "/presence-harness",
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presence layout verification</title></head><body><div id="root"></div><script type="module" src="/tests/browser/collaboration-presence-harness.tsx"></script></body></html>',
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
    { width: 1024, height: 760 },
    { width: 1440, height: 980 },
  ]) {
    const page = await browser.newPage({
      viewport,
      hasTouch: viewport.width <= 390,
      isMobile: viewport.width <= 390,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/presence-harness", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.goto(`${origin}/presence-harness`);
    await page.locator(".collaboration-presence").waitFor({ state: "visible" });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const scenario of [
        "2d",
        "drawer",
        "player",
        "expanded-player",
        "update",
        "3d",
        "layers",
      ]) {
        await page.evaluate(
          (scenario) => window.collaborationPresenceTest.scenario(scenario),
          scenario,
        );
        await page.waitForTimeout(80);
        await verify(page, { viewport, theme, scenario });
        if (scenario === "2d") {
          const node = page.locator(".react-flow__node");
          assert.equal(
            await node.evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            ),
            "rgb(255, 204, 68)",
          );
          await page.locator(".collaboration-peer-pointer").first().waitFor();
          const pointer = await page
            .locator(".collaboration-peer-pointer")
            .first()
            .evaluate((element) => ({
              left: Number.parseFloat(element.style.left),
              top: Number.parseFloat(element.style.top),
              events: getComputedStyle(element).pointerEvents,
            }));
          assert.deepEqual(pointer, { left: 200, top: 160, events: "none" });
          await page.locator(".collaboration-node-presence").first().waitFor();
          await node.click();
          assert.equal(
            await node.evaluate((element) =>
              element.classList.contains("selected"),
            ),
            true,
            "Peer outline intercepted node selection",
          );
          if (viewport.width > 900) {
            await page.locator(".react-flow__controls-zoomin").click();
            await page.waitForTimeout(300);
            const mapped = await page.evaluate(() => {
              const transform = new DOMMatrix(
                getComputedStyle(
                  document.querySelector(".react-flow__viewport"),
                ).transform,
              );
              const cursor = document.querySelector(
                ".collaboration-peer-pointer",
              );
              return {
                left: Number.parseFloat(cursor.style.left),
                top: Number.parseFloat(cursor.style.top),
                expectedLeft: transform.e + 200 * transform.a,
                expectedTop: transform.f + 160 * transform.a,
                zoom: transform.a,
              };
            });
            assert.ok(
              mapped.zoom > 1 &&
                Math.abs(mapped.left - mapped.expectedLeft) < 1 &&
                Math.abs(mapped.top - mapped.expectedTop) < 1,
              `Peer pointer did not follow the diagram viewport: ${JSON.stringify(mapped)}`,
            );
          }
        }
        if (viewport.width === 390 || viewport.width === 1440)
          await page.screenshot({
            path: `${output}/${viewport.width}-${theme}-${scenario}.png`,
          });
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/verified.json`,
    JSON.stringify({ verified, errors }, null, 2),
  );
  console.log(
    `Verified ${verified.length} real browser presence/control layouts; screenshots: ${output}`,
  );
} finally {
  await browser?.close();
  await vite.close();
}
