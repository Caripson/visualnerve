export function createDiagramHelpers({ sleep, marker }) {
  async function diagram(
    api,
    count = 3,
    { seconds = 30, longFirst = true } = {},
  ) {
    const diagram = await api("/diagrams", "POST", {
      name: "Neural speech integration",
      type: "process",
    });
    const nodes = Array.from({ length: count }, (_, index) => ({
      externalId: "n" + index,
      title: "Delivery module " + index,
      description:
        index === 0 && longFirst
          ? `${marker}. ` +
            "This module describes a delivery from the factory to the customer. ".repeat(
              8,
            )
          : "The delivery module " + index + " describes a safe workflow.",
      x: 100 + index * 350,
      y: 100,
      width: 260,
      height: 100,
    }));
    await api("/diagrams/" + diagram.id + "/bulk", "POST", {
      nodes,
      edges: [],
    });
    let graph = await api("/diagrams/" + diagram.id);
    await api("/diagrams/" + diagram.id + "/presentation", "PUT", {
      baseVersion: graph.diagram.version,
      presentation: {
        version: 1,
        nodeIds: graph.nodes.map((node) => node.id),
        secondsPerNode: seconds,
        transitionMs: 0,
      },
    });
    graph = await api("/diagrams/" + diagram.id);
    await api("/presentation/open", "POST", { diagramId: diagram.id });
    for (let i = 0; i < 50; i++) {
      const current = await api("/diagrams/" + diagram.id);
      if (current.diagram.settings.viewport) {
        graph = current;
        break;
      }
      await sleep(100);
    }
    await sleep(300);
    return await api("/diagrams/" + diagram.id);
  }
  async function waitPreload(page, api, timeout = 120000) {
    await page.waitForFunction(
      () =>
        document
          .querySelector(".presentation-message")
          ?.textContent?.includes("Preload 100%"),
      {},
      { timeout },
    );
    const state = await api("/presentation");
    if (state.progress !== 1 || state.buffered > 3)
      throw new Error("Preload final state invalid " + JSON.stringify(state));
    return state;
  }
  return { diagram, waitPreload };
}
export async function exportModelFixtures(page) {
  await page.evaluate(async () => {
    const cache = await caches.open("visualnerve-piper-models-v1");
    const keys = await cache.keys();
    for (const name of [
      "en_GB-alan-medium.onnx",
      "en_GB-alan-medium.onnx.json",
    ]) {
      const key = keys.find((key) =>
        new URL(key.url).pathname.endsWith("/" + name),
      );
      if (!key)
        throw new Error("The browser did not persist the Alan model fixture.");
      const response = await cache.match(key);
      const reader = response.body.getReader();
      let first = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Strings avoid Playwright serializing tens of millions of number entries.
        // The explicit cap also bounds transfers when CacheStorage yields a large chunk.
        for (let offset = 0; offset < value.byteLength; offset += 64 * 1024) {
          const part = value.subarray(offset, offset + 64 * 1024);
          let binary = "";
          for (const byte of part) binary += String.fromCharCode(byte);
          await window.__modelChunk(name, btoa(binary), first);
          first = false;
        }
      }
    }
  });
}
