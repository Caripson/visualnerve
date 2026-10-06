import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function createBrowserProbes({
  fixtures,
  output,
  origin,
  results,
  marker,
  sleep,
  savedVoices,
}) {
  async function setup(context, { routeModels = false } = {}) {
    const page = await context.newPage();
    await page.exposeFunction("__modelChunk", (name, base64, first) => {
      if (
        !["en_GB-alan-medium.onnx", "en_GB-alan-medium.onnx.json"].includes(
          name,
        )
      )
        throw new Error("Unexpected fixture filename.");
      if (first) writeFileSync(output(name), Buffer.alloc(0));
      appendFileSync(output(name), Buffer.from(base64, "base64"));
    });
    await page.exposeFunction("__saveWave", (voice, bytes) => {
      if (savedVoices.has(voice)) return;
      savedVoices.add(voice);
      writeFileSync(output("piper-" + voice + ".wav"), Buffer.from(bytes));
    });
    if (routeModels)
      await context.route(
        "https://huggingface.co/rhasspy/piper-voices/resolve/**",
        async (route) => {
          const path = new URL(route.request().url()).pathname;
          let file;
          if (path.endsWith("en_GB-alan-medium.onnx.json"))
            file = join(fixtures, "en_GB-alan-medium.onnx.json");
          else if (path.endsWith("en_GB-alan-medium.onnx"))
            file = join(fixtures, "en_GB-alan-medium.onnx");

          if (file)
            await route.fulfill({
              status: 200,
              body: readFileSync(file),
              headers: {
                "Content-Type": path.endsWith(".json")
                  ? "application/json"
                  : "application/octet-stream",
                "Access-Control-Allow-Origin": "*",
              },
            });
          else await route.continue();
        },
      );
    page.on("pageerror", (e) => results.errors.push(e.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) {
        results.remote.push({ url: request.url(), method: request.method() });
        if (
          decodeURIComponent(request.url()).includes(marker) ||
          (request.postData() || "").includes(marker)
        )
          results.leaks.push(url.hostname);
      }
    });
    await page.addInitScript(() => {
      window.__speech = {
        requests: [],
        progress: [],
        audio: [],
        ready: [],
        workers: 0,
        terminations: 0,
        player: [],
        assets: [],
        saved: [],
      };
      const OriginalWorker = Worker;
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          window.__speech.workers++;
          this.addEventListener("message", async ({ data }) => {
            if (data.progress)
              window.__speech.progress.push({
                id: data.id,
                ...data.progress,
                wall: performance.now(),
              });
            if (data.ready)
              window.__speech.ready.push({
                id: data.id,
                wall: performance.now(),
                audio: !!data.audio,
              });
            if (data.error)
              window.__speech.progress.push({
                id: data.id,
                error: data.error,
                wall: performance.now(),
              });
            if (data.audio instanceof Blob) {
              const buf = await data.audio.arrayBuffer();
              const header = new DataView(buf);
              const samples = new Int16Array(buf, 44);
              let sum = 0;
              for (const value of samples) sum += (value / 32768) ** 2;
              const voice = window.__speech.requests.find(
                (v) => v.id === data.id,
              )?.voiceId;
              if (voice && !window.__speech.saved.includes(voice)) {
                window.__speech.saved.push(voice);
                await window.__saveWave(voice, Array.from(new Uint8Array(buf)));
              }
              window.__speech.audio.push({
                id: data.id,
                voice,
                size: buf.byteLength,
                rate: header.getUint32(24, true),
                duration: samples.length / header.getUint32(24, true),
                rms: Math.sqrt(sum / samples.length),
                wall: performance.now(),
              });
            }
          });
        }
        postMessage(data, ...args) {
          if (["prepare", "preload"].includes(data.action))
            window.__speech.requests.push({
              id: data.id,
              action: data.action,
              voiceId: data.voiceId,
              characters: data.text?.length,
              wall: performance.now(),
            });
          return super.postMessage(data, ...args);
        }
        terminate() {
          window.__speech.terminations++;
          return super.terminate();
        }
      };
      const AudioContext = window.AudioContext;
      window.__audio = [];
      window.AudioContext = class extends AudioContext {
        createBufferSource() {
          const source = super.createBufferSource();
          const record = { starts: [], stops: [] };
          window.__audio.push(record);
          const start = source.start.bind(source),
            stop = source.stop.bind(source);
          source.start = (...args) => {
            record.starts.push({
              offset: args[1] || 0,
              duration: source.buffer?.duration,
              time: this.currentTime,
            });
            return start(...args);
          };
          source.stop = (...args) => {
            record.stops.push(this.currentTime);
            return stop(...args);
          };
          return source;
        }
      };
      new MutationObserver(() => {
        const message =
          document.querySelector(".presentation-message")?.textContent || "";
        const status = document.querySelector(".presentation-player")?.dataset
          .status;
        const progress = document.querySelector(
          '[aria-label="Preload progress"]',
        );
        if (progress)
          window.__speech.player.push({
            value: Number(progress.value),
            message,
            status,
            wall: performance.now(),
          });
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
    await page.goto(origin + "/");
    await page
      .getByLabel("I accept local storage and offline caching", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "Accept and continue", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Local only: storage and privacy",
        exact: true,
      })
      .click();
    await page.getByLabel("MCP access", { exact: true }).selectOption("write");
    if (
      (await page.getByLabel("Narration voice").inputValue()) !==
      "en_GB-alan-medium"
    )
      throw new Error("Alan default missing");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const api = async (path, method = "GET", data) => {
      const response = await page.request.fetch(origin + "/api/v1" + path, {
        method,
        ...(data === undefined ? {} : { data }),
      });
      if (!response.ok())
        throw new Error(
          method +
            " " +
            path +
            " " +
            response.status() +
            " " +
            (await response.text()).slice(0, 400),
        );
      return response.json();
    };
    for (let i = 0; i < 100; i++) {
      if ((await api("/health")).connected > 0) break;
      await sleep(100);
    }
    return { page, api };
  }
  return { setup };
}
