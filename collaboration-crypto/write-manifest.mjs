import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "../frontend/node_modules/prettier/index.mjs";
const canonical = new URL(
  "../frontend/src/collaboration/generated/",
  import.meta.url,
);
const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(canonical);
const mode = process.argv[3] || "release";
if (!["release", "development"].includes(mode))
  throw new Error("Invalid build mode.");
const hashes = {};
// Keep generated bindings compliant with the repository formatting check. This
// is deterministic and part of the hashed, reproducible output.
const glue = resolve(output, "mls.js");
await writeFile(
  glue,
  await prettier.format(await readFile(glue, "utf8"), {
    ...(await prettier.resolveConfig(
      fileURLToPath(new URL("mls.js", canonical)),
    )),
    parser: "babel",
  }),
);
for (const name of ["mls.js", "mls_bg.wasm"]) {
  const bytes = await readFile(resolve(output, name));
  hashes[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const manifest = {
  protocol: "MLS 1.0 / RFC 9420",
  openmls: "0.9.1",
  rust: "1.91.0",
  wasmBindgen: "0.2.129",
  builder: {
    canonicalRelease: mode === "release",
    host:
      mode === "release"
        ? "x86_64-unknown-linux-gnu"
        : `${process.platform}/${process.arch}`,
  },
  ciphersuite: "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519",
  independentlyReviewedAdapter: false,
  hashes,
};
await writeFile(
  resolve(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Generated ${mode} collaboration crypto in ${output}`);
