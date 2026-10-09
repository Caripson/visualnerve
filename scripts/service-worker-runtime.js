// Static assets only. Workspace storage and encryption keys are never read here.
const cacheName = __CACHE_NAME__;
const assets = __ASSETS__;
const lazyAssets = __LAZY_ASSETS__;
const retiredAppPaths = __RETIRED_APP_PATHS__;
const assetLock = "visual-nerve-app-assets-v1";
const controlCache = "visual-nerve-cache-control-v1";
const controlURL = "https://visualnerve.invalid/cache-control-v1";
const pending = new Set();
const controllers = new Set();
let revision = 0;
let pausedUntil = 0;
const cancelled = () =>
  new DOMException("App asset download cancelled.", "AbortError");
async function state() {
  const response = await (await caches.open(controlCache)).match(controlURL);
  if (!response)
    return { generation: "initial", clearing: false, expiresAt: 0 };
  const value = await response.json();
  if (
    !value ||
    typeof value.generation !== "string" ||
    !value.generation ||
    typeof value.clearing !== "boolean" ||
    !Number.isFinite(value.expiresAt)
  )
    throw new Error("App cache coordination metadata is invalid.");
  return value;
}
function track(task) {
  pending.add(task);
  void task.finally(() => pending.delete(task)).catch(() => undefined);
  return task;
}
async function drain(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) return;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    // A tee cancellation can await its other consumer; never await that here.
    void reader.cancel().catch(() => undefined);
  }
}
function download(operation) {
  const controller = new AbortController();
  controllers.add(controller);
  const expectedRevision = revision;
  const run = async () => {
    controller.signal.throwIfAborted();
    const initial = await state();
    const check = async () => {
      controller.signal.throwIfAborted();
      const current = await state();
      if (
        expectedRevision !== revision ||
        pausedUntil > Date.now() ||
        current.generation !== initial.generation ||
        (current.clearing && current.expiresAt > Date.now())
      )
        throw cancelled();
    };
    await check();
    await operation(controller.signal, check);
    await check();
  };
  return track(
    (typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(
          assetLock,
          { mode: "shared", signal: controller.signal },
          run,
        )
      : run()
    ).finally(() => controllers.delete(controller)),
  );
}
/** Bound network and complete body/cache writes, including during cancellation. */
class StaticAssetPrecache {
  constructor(cache, signal, check) {
    this.cache = cache;
    this.signal = signal;
    this.check = check;
    this.next = 0;
    this.failed = false;
  }
  async worker() {
    try {
      while (this.next < assets.length) {
        this.signal.throwIfAborted();
        const path = assets[this.next++];
        await this.check();
        // Clear/failure may run after the awaited generation check resolves.
        this.signal.throwIfAborted();
        const response = await fetch(path, { signal: this.signal });
        if (!response.ok) throw new Error(`Offline asset failed: ${path}`);
        await this.check();
        this.signal.throwIfAborted();
        await this.cache.put(path, response);
      }
    } catch (error) {
      if (!this.failed) {
        this.failed = true;
        this.failure = error;
        for (const controller of controllers) controller.abort(cancelled());
      }
      throw error;
    }
  }
  async run() {
    const workers = Array.from({ length: Math.min(6, assets.length) }, () =>
      this.worker(),
    );
    // Native cache.put cannot be cancelled. Settle every started worker before
    // install fails or Clear acknowledges that no late write can repopulate it.
    await Promise.allSettled(workers);
    if (this.failed) throw this.failure;
  }
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    download(async (signal, check) => {
      const cache = await caches.open(cacheName);
      await new StaticAssetPrecache(cache, signal, check).run();
      // A retired entry must stop being served by an older worker after this
      // complete public-asset installation. No private records are removed.
      if (retiredAppPaths) await self.skipWaiting();
    }),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (
    event.data?.type !== "app-cache-clear" ||
    typeof event.data.begin !== "boolean" ||
    !event.ports[0]
  )
    return;
  const begin = event.data.begin;
  if (begin) {
    revision++;
    pausedUntil = Date.now() + 30_000;
    for (const controller of controllers) controller.abort(cancelled());
  } else pausedUntil = 0;
  event.waitUntil(
    Promise.allSettled([...pending]).then(() =>
      event.ports[0].postMessage({ type: "app-cache-ready", begin }),
    ),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/v1/")
  )
    return;
  if (retiredAppPaths && /^\/app(?:\/|$)/.test(url.pathname)) {
    event.respondWith(
      Promise.resolve(
        retiredAppPaths === "site"
          ? Response.redirect("https://app.visualnerve.com/", 308)
          : new Response("Page not found. Open the workspace at /.", {
              status: 404,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              },
            }),
      ),
    );
    return;
  }
  const path =
    url.pathname === "/app" || url.pathname === "/app/index.html"
      ? "/app/"
      : url.pathname === "/index.html"
        ? "/"
        : url.pathname;
  if (!assets.includes(path) && !lazyAssets.includes(path)) return;
  let deliver;
  let reject;
  const response = new Promise((resolve, fail) => {
    deliver = resolve;
    reject = fail;
  });
  const task = download(async (signal, check) => {
    const cache = await caches.open(cacheName);
    const stored = await cache.match(path);
    await check();
    if (stored) {
      deliver(stored);
      return;
    }
    const result = await fetch(event.request, { signal });
    await check();
    // The browser can consume the original as soon as respondWith resolves.
    // Retain the cache/drain branch before delivery and any further await.
    const retained = result.clone();
    deliver(result);
    if (result.ok && lazyAssets.includes(path)) {
      await check();
      await cache.put(path, retained);
    } else await drain(retained, signal);
  });
  event.respondWith(response);
  event.waitUntil(task.catch(reject));
});
