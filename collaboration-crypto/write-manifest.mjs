import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import prettier from "../frontend/node_modules/prettier/index.mjs";
const output = new URL(
  "../frontend/src/collaboration/generated/",
  import.meta.url,
);
const hashes = {};
// Keep generated bindings compliant with the repository formatting check. This
// is deterministic and part of the hashed, reproducible output.
const glue = new URL("mls.js", output);
await writeFile(
  glue,
  await prettier.format(await readFile(glue, "utf8"), {
    ...(await prettier.resolveConfig(fileURLToPath(glue))),
    parser: "babel",
  }),
);
for (const name of ["mls.js", "mls_bg.wasm"]) {
  const bytes = await readFile(new URL(name, output));
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
  ciphersuite: "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519",
  independentlyReviewedAdapter: false,
  hashes,
};
await writeFile(
  new URL("manifest.json", output),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Generated collaboration crypto in ${fileURLToPath(output)}`);
