import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);
const script = fileURLToPath(
  new URL("./notation-contract.mjs", import.meta.url),
);

test("embedded Go notation catalog matches all trusted browser records and contextual rules", async () => {
  await execute(process.execPath, [script, "--check"]);
});

test("generator is deterministic and check rejects stale generated output without replacing it", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "visualnerve-notation-parity-"),
  );
  const output = resolve(directory, "notation.json");
  try {
    await execute(process.execPath, [script, "--output", output]);
    const first = await readFile(output, "utf8");
    const catalog = JSON.parse(first);
    assert.equal(catalog.collections.length, 5);
    assert.equal(
      catalog.bpmnEventContexts.topLevelStart.includes("error"),
      false,
    );
    assert.deepEqual(catalog.umlAttachmentTargets.activation, ["lifeline"]);
    assert.equal(catalog.limits.timingStates, 128);
    assert.deepEqual(catalog.compartmentLimits.hipo["ipo-chart"], {
      default: 3,
      detail: 4,
    });
    assert.deepEqual(catalog.compartmentLimits.bpmn, {
      "choreography-task": 3,
      "sub-choreography": 3,
      "call-choreography": 3,
    });
    assert.ok(
      catalog.symbols.some(
        (symbol) =>
          symbol.collection === "uml" &&
          symbol.id === "timing-lifeline" &&
          symbol.properties.some(
            (property) => property.type === "timing-states",
          ),
      ),
    );
    await execute(process.execPath, [script, "--output", output]);
    assert.equal(await readFile(output, "utf8"), first);
    const stale = first.replace('"schemaVersion": 1', '"schemaVersion": 999');
    await writeFile(output, stale);
    await assert.rejects(
      execute(process.execPath, [script, "--output", output, "--check"]),
      /Embedded notation catalog is stale/,
    );
    assert.equal(await readFile(output, "utf8"), stale);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
