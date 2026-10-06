import { readFileSync } from "node:fs";
import { join } from "node:path";
export async function runSpeechCases({
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
}) {
  const { page, api } = await setup(context);
  const graph = await diagram(api, 35);
  const player = page.getByRole("region", { name: "Diagram player" });
  await player.waitFor({ state: "visible" });
  if (results.remote.length)
    throw new Error("Automatic model download before explicit action");
  const coldStart = Date.now();
  await player
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".presentation-message")?.textContent?.includes("%"),
  );
  await page.screenshot({ path: output("preload-progress.png") });
  await waitPreload(page, api);
  const coldMs = Date.now() - coldStart;
  console.log(JSON.stringify({ phase: "cold-Alan-ready", coldMs }));
  await page.waitForFunction(() => window.__speech.audio.length >= 3);
  const cold = await page.evaluate(() => window.__speech);
  const loads = cold.progress.filter(
    (v) => v.stage === "download" && v.operation !== "runtime",
  );
  if (!loads.length || !loads.some((v) => v.total === 63201294 + 4888))
    throw new Error("Missing aggregate model/config byte progress");
  if (loads.some((v, i) => i && v.loaded < loads[i - 1].loaded))
    throw new Error("Download percentage moved backwards");
  const global = cold.player.map((v) => v.value);
  if (global.some((v, i) => i && v < global[i - 1]))
    throw new Error(
      "Overall preload moved backwards: " + JSON.stringify(global),
    );
  if (
    !global.includes(0) ||
    global.at(-1) !== 1 ||
    !global.some((v) => v > 0 && v < 1)
  )
    throw new Error("UI percentage not meaningful " + JSON.stringify(global));
  if (
    cold.audio.length !== 3 ||
    cold.audio.some(
      (v) => v.rms < 0.001 || v.rate !== 22050 || v.duration <= 0.2,
    )
  )
    throw new Error("Cold WAVs are silent/invalid");
  await player
    .getByRole("button", { name: "Presentation audio", exact: true })
    .click();
  const warmPlay = Date.now();
  await player
    .getByRole("button", { name: "Play presentation", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".presentation-player")?.dataset.status ===
      "playing",
  );
  const warmPlayMs = Date.now() - warmPlay;
  await sleep(350);
  await player
    .getByRole("button", { name: "Pause presentation", exact: true })
    .click();
  await player
    .getByRole("button", { name: "Play presentation", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__audio.at(-1)?.starts[0]?.offset > 0,
  );
  const resume = await page.evaluate(() => window.__audio.at(-1).starts[0]);
  if (resume.offset <= 0) throw new Error("Pause/resume restarted WAV");
  await player
    .getByRole("button", { name: "Pause presentation", exact: true })
    .click();
  const sweepStart = Date.now();
  for (let index = 3; index < 35; index += 3) {
    await api("/presentation/seek", "POST", { index });
    await api("/presentation/preload", "POST", {});
    await waitPreload(page, api);
  }
  const warmSweepMs = Date.now() - sweepStart;
  console.log(JSON.stringify({ phase: "warm35-step-sweep", warmSweepMs }));
  const after = await page.evaluate(() => window.__speech);
  const modelRequests = results.remote.filter(
    (v) =>
      v.url.includes("/resolve/") && v.url.includes("en_GB-alan-medium.onnx"),
  );
  if (modelRequests.length !== 2)
    throw new Error("Warm requests redownloaded model " + modelRequests.length);
  if (after.terminations !== 0 || after.workers !== 1)
    throw new Error(
      "Normal Pause/seek/preload restarted engine " +
        JSON.stringify({
          workers: after.workers,
          terminations: after.terminations,
        }),
    );
  const init = after.progress.filter((v) => v.operation === "session");
  if (new Set(init.map((v) => v.id)).size !== 1)
    throw new Error("ONNX session did not stay warm");
  const pronunciations = after.progress.filter(
    (v) => v.operation === "phonemizer",
  );
  if (new Set(pronunciations.map((v) => v.id)).size < 2)
    throw new Error("Bounded phonemizer renewal not exercised");
  const unchanged = await api("/diagrams/" + graph.diagram.id);
  if (JSON.stringify(unchanged) !== JSON.stringify(graph))
    throw new Error("Speech/seek changed saved diagram");
  await page.screenshot({ path: output("preload-alan.png") });
  const phaseTimings = {};
  for (const phase of ["download", "session", "runtime", "phonemizer"]) {
    const events = cold.progress.filter((v) =>
      phase === "download"
        ? v.stage === "download" && v.operation !== "runtime"
        : v.operation === phase,
    );
    if (events.length)
      phaseTimings[phase] = {
        first: events[0].wall,
        last: events.at(-1).wall,
        milliseconds: events.at(-1).wall - events[0].wall,
      };
  }
  results.cases.push({
    phaseTimings,
    name: "real HF cold Alan / warm reuse / >32 chunks / Pause resume / monotonic preload",
    coldMs,
    warmPlayMs,
    warmSweepMs,
    wavs: after.audio.length,
    firstWave: cold.audio[0],
    workers: after.workers,
    terminations: after.terminations,
    sessionJobs: new Set(init.map((v) => v.id)).size,
    phonemizerJobs: new Set(pronunciations.map((v) => v.id)).size,
    globalPercent: [...new Set(global)],
  });
  await movieCheck(page, api);
  await player
    .getByRole("button", { name: "Close diagram player", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Local only: storage and privacy",
      exact: true,
    })
    .click();
  await page.getByLabel("Narration voice").selectOption("sv_SE-nst-medium");
  await page.getByRole("button", { name: "Save voice", exact: true }).click();
  const svStart = Date.now();
  await page
    .getByRole("button", { name: "Preview voice", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.voice-settings [role="status"]'),
  );
  await page.screenshot({ path: output("settings-progress.png") });
  await page
    .getByRole("progressbar", { name: "Voice preparation" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: output("settings-progress.png") });
  await page.waitForFunction(
    () =>
      window.__speech.audio.some((wave) => wave.voice === "sv_SE-nst-medium"),
    {},
    { timeout: 120000 },
  );
  const svMs = Date.now() - svStart;
  console.log(JSON.stringify({ phase: "Swedish-ready", svMs }));
  const sv = await page.evaluate(() =>
    window.__speech.audio.find((wave) => wave.voice === "sv_SE-nst-medium"),
  );
  if (sv.rms < 0.001) throw new Error("Swedish WAV silent");
  await page
    .getByRole("button", { name: "Cancel voice preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  results.cases.push({
    name: "real Swedish neural preview",
    ms: svMs,
    wave: sv,
  });
  if (!process.env.PIPER_MODEL_FIXTURES) await exportModelFixtures(page);
  await context.close();
  const broken = await browser.newContext({ ignoreHTTPSErrors: true });
  const test = await setup(broken, { routeModels: true });
  await broken.route("**/editor/speech/piper_phonemize.data", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await diagram(test.api, 1);
  const failureStart = Date.now();
  await test.page
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await test.page.waitForFunction(
    () =>
      document
        .querySelector(".presentation-message")
        ?.textContent?.includes("runtime file could not load (404)"),
    {},
    { timeout: 15000 },
  );
  const failureMs = Date.now() - failureStart;
  if (failureMs > 15000)
    throw new Error("Runtime404 waited for engine watchdog");
  results.cases.push({
    name: "runtime data404 rejects promptly",
    ms: failureMs,
    message: await test.page.locator(".presentation-message").textContent(),
  });
  await broken.unroute("**/editor/speech/piper_phonemize.data");
  await test.page
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await test.page
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await waitPreload(test.page, test.api);
  results.cases.push({
    name: "retry after runtime404",
    wave: await test.page.evaluate(() => window.__speech.audio.at(-1)),
  });
  await broken.close();
  const cancellation = await browser.newContext({ ignoreHTTPSErrors: true });
  let delayed = true;
  await cancellation.route(
    "https://huggingface.co/rhasspy/piper-voices/resolve/**/en_GB-alan-medium.onnx",
    async (route) => {
      if (delayed) await sleep(1500);
      await route
        .fulfill({
          status: 200,
          body: readFileSync(join(fixtures, "en_GB-alan-medium.onnx")),
          headers: {
            "Content-Type": "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
          },
        })
        .catch(() => undefined);
    },
  );
  const cancelled = await setup(cancellation);
  await diagram(cancelled.api, 3);
  await cancelled.page
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await cancelled.page.waitForFunction(() =>
    window.__speech.progress.some((v) => v.stage === "download"),
  );
  await cancelled.page
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await cancelled.page.waitForFunction(() => window.__speech.terminations >= 1);
  const stopped = await cancelled.api("/presentation");
  if (stopped.preload || stopped.buffered || stopped.progress)
    throw new Error("Explicit preload cancellation left stale state");
  delayed = false;
  await cancelled.page
    .getByRole("button", { name: "Preload presentation", exact: true })
    .click();
  await cancelled.page
    .getByRole("button", { name: "Presentation audio", exact: true })
    .click();
  await cancelled.page
    .getByRole("button", { name: "Play presentation", exact: true })
    .click();
  await cancelled.page.waitForFunction(
    () =>
      document.querySelector(".presentation-player")?.dataset.status ===
      "playing",
    {},
    { timeout: 120000 },
  );
  await waitPreload(cancelled.page, cancelled.api);
  await cancelled.page
    .getByRole("button", { name: "Pause presentation", exact: true })
    .click();
  const queued = await cancelled.page.evaluate(() => window.__speech);
  if (queued.audio.length !== 3)
    throw new Error(
      "Foreground/preload dedup produced duplicate or missing audio " +
        queued.audio.length,
    );
  results.cases.push({
    name: "explicit download cancel, retry, foreground during preload",
    workers: queued.workers,
    terminations: queued.terminations,
    wavs: queued.audio.length,
  });
  await cancellation.close();
}
