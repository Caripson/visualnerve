/** Reproduce retained bytes with reordered package lists and filesystem entries. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { retainLicenses } from "./write-licenses.mjs";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "visualnerve-license-order-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function save(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function directoryBytes(directory) {
  const result = {};
  for (const file of (await readdir(directory)).sort()) {
    result[file] = await readFile(join(directory, file));
  }
  return result;
}

test("Cargo notices reproduce byte-for-byte with shuffled metadata and directory entries", async (t) => {
  const temporaryDirectory = await temporary(t);
  const packages = [];
  for (const [name, version] of [
    ["crate_one", "1.9.0"],
    ["crate-one", "1.9.0"],
    ["crate-one", "1.10.0"],
  ]) {
    const source = join(temporaryDirectory, "registry", `${name}-${version}`);
    await save(join(source, "NOTICE"), `Notice ${name} ${version}\r\n`);
    await save(
      join(source, "LICENSE-Z"),
      Buffer.from([0x5a, 0x0a, 0xc3, 0xa5]),
    );
    await save(join(source, "LICENSE-A"), "Original license A\n");
    await save(join(source, "README.md"), "Not a license notice.\n");
    packages.push({
      id: `registry:${name}@${version}`,
      name,
      version,
      source: "registry+https://example.invalid/index",
      manifest_path: join(source, "Cargo.toml"),
      license: "MIT",
      repository: `https://example.invalid/${name}`,
    });
  }
  const unresolved = {
    ...packages[0],
    id: "unused-package",
    name: "unresolved",
    manifest_path: join(temporaryDirectory, "must-not-read", "Cargo.toml"),
  };
  const local = {
    ...packages[0],
    id: "local-adapter",
    name: "local",
    source: null,
    manifest_path: unresolved.manifest_path,
  };
  const metadata = {
    packages: [...packages, unresolved, local],
    resolve: { nodes: [...packages, local].map(({ id }) => ({ id })) },
  };
  const first = join(temporaryDirectory, "first");
  const second = join(temporaryDirectory, "second");
  await retainLicenses(metadata, { directory: first });
  const inventory = await retainLicenses(
    {
      packages: metadata.packages.toReversed(),
      resolve: { nodes: metadata.resolve.nodes.toReversed() },
    },
    {
      directory: second,
      readDirectory: async (directory) =>
        (await readdir(directory)).toReversed(),
    },
  );

  assert.deepEqual(await directoryBytes(first), await directoryBytes(second));
  assert.deepEqual(
    inventory.map(({ name, version }) => `${name}/${version}`),
    ["crate-one/1.10.0", "crate-one/1.9.0", "crate_one/1.9.0"],
  );
  assert.deepEqual(inventory[0].notices, [
    "crate-one-1.10.0-LICENSE-A",
    "crate-one-1.10.0-LICENSE-Z",
    "crate-one-1.10.0-NOTICE",
  ]);
  assert.deepEqual(
    await readFile(join(second, "crate-one-1.10.0-LICENSE-Z")),
    Buffer.from([0x5a, 0x0a, 0xc3, 0xa5]),
  );
});

async function productFixture(root, reverse) {
  await mkdir(join(root, "scripts"), { recursive: true });
  await copyFile(
    join(repository, "scripts/licenses.mjs"),
    join(root, "scripts/licenses.mjs"),
  );
  await save(join(root, "LICENSE"), "Original application license\n");
  await save(join(root, "NOTICE"), "Original application notice\r\n");
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "backend"), { recursive: true });
  const npmPackages = [
    ["node_modules/alpha_one", { version: "1.0.0", license: "MIT" }],
    ["node_modules/alpha-one", { version: "1.0.0", license: "MIT" }],
    [
      "node_modules/outer/node_modules/alpha-one",
      { version: "1.0.0", license: "MIT" },
    ],
    ["node_modules/@scope/zeta", { version: "2.0.0", license: "ISC" }],
  ];
  const frontendLock = {
    packages: Object.fromEntries([
      ["", {}],
      ...(reverse ? npmPackages.toReversed() : npmPackages),
    ]),
  };
  await save(
    join(root, "frontend/package-lock.json"),
    JSON.stringify(frontendLock),
  );
  await save(
    join(root, "frontend/package.json"),
    JSON.stringify({
      dependencies: { "alpha-one": "1.0.0" },
      devDependencies: {},
    }),
  );
  for (const [path] of npmPackages) {
    const name = path.split("node_modules/").at(-1);
    for (const file of reverse
      ? ["NOTICE", "LICENSE-Z", "LICENSE-A"]
      : ["LICENSE-A", "LICENSE-Z", "NOTICE"]) {
      await save(join(root, "frontend", path, file), `${name} ${file}\n`);
    }
  }
  await save(
    join(root, "collaboration-worker/package-lock.json"),
    JSON.stringify({
      packages: {
        "": {},
        "node_modules/relay-tool": {
          version: "1.0.0",
          license: "MIT",
          dev: true,
        },
      },
    }),
  );
  await save(
    join(root, "collaboration-worker/package.json"),
    JSON.stringify({ devDependencies: { "relay-tool": "1.0.0" } }),
  );
  await save(
    join(root, "collaboration-worker/node_modules/relay-tool/LICENSE"),
    "Relay tooling license\n",
  );
  const cargo = ["crate_one", "crate-one"].map((name) => ({
    ecosystem: "Cargo",
    name,
    version: "1.0.0",
    license: "MIT",
    scope: "locked WASM runtime/build dependency",
    repository: `https://example.invalid/${name}`,
    notices: [`${name}-1.0.0-LICENSE`],
  }));
  await save(
    join(root, "collaboration-crypto/licenses/inventory.json"),
    JSON.stringify(reverse ? cargo.toReversed() : cargo),
  );
  for (const dependency of cargo) {
    await save(
      join(root, "collaboration-crypto/licenses", dependency.notices[0]),
      `Pinned Cargo notice ${dependency.name}\n`,
    );
  }
  const goDirectory = join(root, "go-registry");
  await save(join(goDirectory, "NOTICE"), "Go notice\n");
  await save(join(goDirectory, "LICENSE"), "Go license\n");
  const go = join(root, "go-fixture");
  const goModule = {
    Path: "example.invalid/module",
    Version: "v1.0.0",
    Dir: goDirectory,
  };
  await save(
    go,
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(goModule))});\n`,
  );
  await chmod(go, 0o755);

  const preload = join(root, "reverse-filesystem.mjs");
  await save(
    preload,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.readdirSync;
fs.readdirSync = (...args) => original(...args).toReversed();
String.prototype.localeCompare = () => { throw new Error('Locale-sensitive inventory order'); };
syncBuiltinESMExports();\n`,
  );
  await execute(
    process.execPath,
    [
      ...(reverse ? ["--import", preload] : []),
      join(root, "scripts/licenses.mjs"),
      go,
    ],
    { env: { ...process.env, LANG: reverse ? "sv_SE.UTF-8" : "C" } },
  );
}

test("published inventories and original notice bytes reproduce across enumeration and locale changes", async (t) => {
  const temporaryDirectory = await temporary(t);
  const first = join(temporaryDirectory, "first");
  const second = join(temporaryDirectory, "second");
  await productFixture(first, false);
  await productFixture(second, true);
  assert.deepEqual(
    await directoryBytes(join(first, "hugo/static/licenses")),
    await directoryBytes(join(second, "hugo/static/licenses")),
  );
  for (const file of ["docs/third-party-licenses.json", "DEPENDENCIES.md"]) {
    assert.deepEqual(
      await readFile(join(first, file)),
      await readFile(join(second, file)),
    );
  }
  const inventory = JSON.parse(
    await readFile(join(second, "docs/third-party-licenses.json"), "utf8"),
  );
  assert.deepEqual(
    inventory.slice(0, 3).map(({ ecosystem, name }) => `${ecosystem}/${name}`),
    ["Cargo/crate-one", "Cargo/crate_one", "Go/example.invalid/module"],
  );
  const alpha = inventory.find(({ name }) => name === "alpha-one");
  assert.deepEqual(alpha.notices, [
    "licenses/alpha-one-LICENSE-A",
    "licenses/alpha-one-LICENSE-Z",
    "licenses/alpha-one-NOTICE",
  ]);
  assert.deepEqual(
    inventory
      .filter(({ name }) => name === "alpha-one")
      .map(({ scope }) => scope),
    ["direct runtime", "transitive runtime"],
  );
});
