import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export async function checkMovie({
  page,
  api,
  diagram,
  waitPreload,
  root,
  output,
  origin,
  results,
}) {
  const graph = await diagram(api, 2, { seconds: 2, longFirst: false });
  await api("/presentation/preload", "POST", {});
  const prep = page.locator(".presentation-preparation");
  await prep.waitFor({ state: "visible" });
  const spacing = await prep.evaluate((element) => {
    const style = getComputedStyle(element);
    const progress = element.querySelector("progress");
    return {
      display: style.display,
      direction: style.flexDirection,
      gap: style.gap,
      barWidth: progress.getBoundingClientRect().width,
      containerWidth: element.getBoundingClientRect().width,
    };
  });
  if (
    spacing.display !== "flex" ||
    spacing.direction !== "column" ||
    spacing.gap !== "6px" ||
    Math.abs(spacing.barWidth - spacing.containerWidth) > 1
  )
    throw new Error(
      "Preload progress spacing regression: " + JSON.stringify(spacing),
    );
  await page.screenshot({ path: output("final-preload-spacing.png") });
  await waitPreload(page, api);
  await api("/presentation", "PATCH", { audio: true, subtitles: true });
  await page
    .getByRole("button", { name: "Play presentation", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".presentation-player")?.dataset.status ===
      "playing",
  );
  const before = await api("/diagrams/" + graph.diagram.id);
  const downloaded = page.waitForEvent("download", { timeout: 120000 });
  const started = Date.now();
  await api("/presentation/video", "POST", { audio: true, subtitles: true });
  const download = await downloaded;
  const state = await api("/presentation/video");
  if (state.status !== "complete" || state.format !== "mp4")
    throw new Error(
      "The neural movie did not finish as MP4: " + JSON.stringify(state),
    );
  const file = output("alan-neural-movie.mp4");
  await download.saveAs(file);
  const after = await api("/diagrams/" + graph.diagram.id);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Neural movie changed the saved graph.");
  const { build } = await import(
    pathToFileURL(join(root, "frontend/node_modules/esbuild/lib/main.js")).href
  );
  const moduleFile = output("movie-reader.mjs");
  await build({
    stdin: {
      contents:
        "export {Input,BlobSource,ALL_FORMATS,AudioBufferSink,CanvasSink} from 'mediabunny';",
      resolveDir: join(root, "frontend"),
      sourcefile: "movie-reader.mjs",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: moduleFile,
    logLevel: "silent",
  });
  const reader = await page.context().newPage();
  await reader.route("**/piper-movie-reader", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><canvas width="1280" height="720"></canvas><video controls muted></video>',
    }),
  );
  await reader.route("**/piper-movie-reader.mjs", (r) =>
    r.fulfill({ contentType: "text/javascript", path: moduleFile }),
  );
  await reader.route("**/piper-neural-movie.mp4", (r) =>
    r.fulfill({ contentType: "video/mp4", path: file }),
  );
  await reader.goto(origin + "/piper-movie-reader");
  const decoded = await reader.evaluate(async () => {
    const { Input, BlobSource, ALL_FORMATS, AudioBufferSink, CanvasSink } =
      await import("/piper-movie-reader.mjs");
    const blob = await (await fetch("/piper-neural-movie.mp4")).blob();
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
    const video = await input.getPrimaryVideoTrack(),
      audio = await input.getPrimaryAudioTrack();
    if (!audio || !video) throw new Error("Missing neural video/audio track.");
    const duration = await input.computeDuration();
    let energy = 0,
      count = 0,
      peak = 0;
    for await (const sample of new AudioBufferSink(audio).buffers())
      for (const value of sample.buffer.getChannelData(0)) {
        energy += value * value;
        count++;
        peak = Math.max(peak, Math.abs(value));
      }
    const canvas = document.querySelector("canvas"),
      ctx = canvas.getContext("2d");
    const frame = await new CanvasSink(video, {
      width: 1280,
      height: 720,
      fit: "contain",
    }).getCanvas(Math.min(1, duration / 3));
    ctx.drawImage(frame.canvas, 0, 0);
    const result = {
      duration,
      videoCodec: await video.getCodec(),
      audioCodec: await audio.getCodec(),
      rms: Math.sqrt(energy / count),
      peak,
      samples: count,
      frame: canvas.toDataURL("image/png"),
    };
    input.dispose();
    return result;
  });
  if (
    decoded.audioCodec !== "aac" ||
    decoded.videoCodec !== "avc" ||
    decoded.rms < 0.005
  )
    throw new Error(
      "Invalid decoded MP4/AAC narration: " +
        JSON.stringify({ ...decoded, frame: undefined }),
    );
  writeFileSync(
    output("alan-neural-movie-frame.png"),
    Buffer.from(decoded.frame.split(",")[1], "base64"),
  );
  delete decoded.frame;
  await reader.close();
  results.cases.push({
    name: "warm player → real Alan neural MP4/AAC movie",
    ms: Date.now() - started,
    file,
    bytes: readFileSync(file).length,
    unchangedGraph: true,
    spacing,
    decoded,
  });
}
