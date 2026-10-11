import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const builderSource = readFileSync(new URL("./build.sh", import.meta.url), "utf8");
const rustEnvironment = [
  "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_BUILD_RUSTFLAGS",
  "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS", "RUSTC",
  "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER",
];

function runBuilder(environment = {}) {
  // This isolated tree never compiles Rust or writes tracked browser assets.
  const root = mkdtempSync(join(tmpdir(), "collaboration-build-guard-"));
  const commands = join(root, "commands");
  mkdirSync(commands);
  mkdirSync(join(root, "collaboration-crypto"));
  writeFileSync(join(root, "collaboration-crypto", "build.sh"), builderSource);
  writeFileSync(join(commands, "uname"), `#!/bin/sh
case "$1" in
  -s) echo Linux;;
  -m) echo x86_64;;
  *) exit 1;;
esac
`, { mode: 0o755 });

  const versionTail = `
// Delayed trailing lines make an early-closing version reader fail reliably.
setTimeout(() => {
  process.stdout.end("remaining metadata\\n".repeat(4096));
}, 25);
process.stdout.on("error", () => process.exit(74));
`;
  writeFileSync(join(commands, "rustc"), `#!/usr/bin/env node
if (process.argv[2] !== "+1.91.0") process.exit(76);
process.stdout.write("rustc 1.91.0\\nhost: " +
  (process.env.GUARD_RUST_HOST ?? "x86_64-unknown-linux-gnu") + "\\n");
if (process.env.GUARD_RUST_FAILURE) process.exit(1);
${versionTail}
`, { mode: 0o755 });
  writeFileSync(join(commands, "cargo"), `#!/usr/bin/env node
if (process.argv[2] !== "+1.91.0") process.exit(76);
if (process.argv.includes("--version")) {
  process.stdout.write("cargo " + (process.env.GUARD_CARGO_VERSION ?? "1.91.0") + " (fixture)\\n");
  ${versionTail}
} else {
  console.error("fixture: compilation reached after version guards");
  process.exit(73);
}
`, { mode: 0o755 });
  writeFileSync(join(commands, "wasm-bindgen"), `#!/usr/bin/env node
console.log("wasm-bindgen " + (process.env.GUARD_BINDGEN_VERSION ?? "0.2.129"));
`, { mode: 0o755 });
  try {
    const env = {
      PATH: `${commands}:${process.env.PATH}`,
      CARGO_HOME: join(root, "registry"),
      ...environment,
    };
    return spawnSync("bash", [join(root, "collaboration-crypto", "build.sh")], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("canonical version guards consume trailing compiler and cargo output", () => {
  const result = runBuilder();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 73, result.stderr);
  assert.match(result.stderr, /fixture: compilation reached after version guards/);
});

test("canonical guard still rejects a different Rust host", () => {
  const result = runBuilder({ GUARD_RUST_HOST: "aarch64-unknown-linux-gnu" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /pinned x86_64-unknown-linux-gnu Rust toolchain/);
  assert.doesNotMatch(result.stderr, /compilation reached/);
});

test("a failing compiler command cannot pass its matching host output", () => {
  const result = runBuilder({ GUARD_RUST_FAILURE: "1" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /pinned x86_64-unknown-linux-gnu Rust toolchain/);
  assert.doesNotMatch(result.stderr, /compilation reached/);
});

test("canonical guard still requires the pinned Cargo version", () => {
  const result = runBuilder({ GUARD_CARGO_VERSION: "1.90.0" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /pinned Rust\/Cargo 1\.91\.0 toolchain/);
  assert.doesNotMatch(result.stderr, /compilation reached/);
});

test("canonical guard still requires the pinned binding generator", () => {
  const result = runBuilder({ GUARD_BINDGEN_VERSION: "0.2.128" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /wasm-bindgen-cli 0\.2\.129/);
  assert.doesNotMatch(result.stderr, /compilation reached/);
});

test("canonical guard still rejects inherited compiler flags and wrappers", () => {
  for (const key of rustEnvironment) {
    const result = runBuilder({ [key]: "fixture-override" });
    assert.equal(result.status, 1, `${key}: ${result.stderr}`);
    assert.match(result.stderr, /do not accept inherited Rust flags or compiler wrappers/);
    assert.doesNotMatch(result.stderr, /compilation reached/);
  }
});
