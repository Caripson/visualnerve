import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageBridgeInstaller } from "./package-bridge-installer.mjs";
import {
  auditBridgeDownloads,
  inspectBridgeSource,
  bridgeDownloadPath,
  BRIDGE_SOURCE_ROOT,
} from "./bridge-downloads.mjs";
import { auditStatic } from "./audit-static.mjs";
import { copiedAsset } from "../deployment/app-surface-audit.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { zipSync, unzipSync } = createRequire(
  resolve(repository, "frontend/package.json"),
)("fflate");
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "visual-nerve-bridge-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, bytes) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), bytes);
  };
  for (const path of [
    "LICENSE",
    "NOTICE",
    "scripts/build-bridge.sh",
    "backend/go.sum",
    "backend/cmd/visual-nerve/main.go",
    "backend/cmd/openapi/main.go",
    "backend/internal/model/notation_catalog.json",
  ])
    put(path, "fixture content\n");
  put("backend/go.mod", "module visualnerve\n\ngo 1.26.0\n");
  put(
    "backend/internal/server/operations.go",
    'package server\nconst bridgeVersion = "0.11.1"\n',
  );
  put(
    "scripts/bridge-installer-helper.go",
    "package main\n// Literal substitution symbols: $& $$ $`\n",
  );
  put(
    "scripts/bridge-installer.sh.in",
    "#!/usr/bin/env bash\nSOURCE='__VN_SOURCE_URL__'\nSHA='__VN_SOURCE_SHA256__'\nVERSION='__VN_BRIDGE_VERSION__'\nREVISION='__VN_BUILD_REVISION__'\nGO='__VN_GO_VERSION__'\ncat <<'HELPER'\n__VN_HELPER_GO_SOURCE__\nHELPER\n",
  );
  const outputDirectory = resolve(root, "public");
  const options = {
    root,
    outputDirectory,
    siteUrl: "https://visualnerve.example/",
    revision: "a".repeat(40),
    sourceDirty: false,
  };
  return {
    root,
    outputDirectory,
    put,
    options,
    package: (extra = {}) => packageBridgeInstaller({ ...options, ...extra }),
  };
}

test("deterministic source ZIP includes only build inputs and embeds literal pinned installer metadata", (t) => {
  const f = fixture(t);
  f.put(".env", "PRIVATE_ENV_SENTINEL");
  f.put("backend/private-backup.json", "PRIVATE_BACKUP_SENTINEL");
  f.put(
    "backend/internal/server/operations_test.go",
    "TEST_NOT_A_RUNTIME_INPUT",
  );
  f.put("frontend/source.ts", "FRONTEND_NOT_REQUIRED");
  const first = f.package(),
    second = f.package();
  assert.deepEqual(second, first);
  assert.equal(first.goVersion, "1.26.9");
  assert.equal(first.goMinimumVersion, "1.26.0");
  assert.equal(first.bridgeVersion, "0.11.1");
  assert.equal(first.sourceDirty, false);
  assert.equal(
    first.source.url,
    `https://visualnerve.example/downloads/${first.source.file}`,
  );
  const archive = readFileSync(
    resolve(f.outputDirectory, "downloads", first.source.file),
  );
  const source = unzipSync(archive);
  assert.deepEqual(
    Object.keys(source).sort(),
    first.files.map((entry) => `${BRIDGE_SOURCE_ROOT}${entry.path}`),
  );
  assert.ok(
    first.files.some(
      (entry) => entry.path === "backend/internal/model/notation_catalog.json",
    ),
  );
  for (const bytes of Object.values(source))
    assert.doesNotMatch(
      Buffer.from(bytes).toString(),
      /PRIVATE_|TEST_NOT|FRONTEND_NOT/,
    );
  const installer = readFileSync(
    resolve(f.outputDirectory, "downloads", first.installer.file),
    "utf8",
  );
  assert.ok(installer.includes(first.source.url));
  assert.ok(installer.includes(first.source.sha256));
  assert.ok(installer.includes("Literal substitution symbols: $& $$ $`"));
  assert.doesNotMatch(installer, /__VN_/);
  assert.equal(readdirSync(resolve(f.outputDirectory, "downloads")).length, 5);
  assert.deepEqual(auditBridgeDownloads(f.outputDirectory), first);
});

test("changing source content changes its immutable filename while revision metadata stays explicit", (t) => {
  const f = fixture(t),
    first = f.package();
  f.put("backend/cmd/visual-nerve/main.go", "changed source\n");
  const second = f.package({ sourceDirty: true });
  assert.notEqual(second.source.file, first.source.file);
  assert.equal(second.revision, first.revision);
  assert.equal(second.sourceDirty, true);
  assert.equal(
    readdirSync(resolve(f.outputDirectory, "downloads")).includes(
      first.source.file,
    ),
    false,
  );
  f.put("backend/go.mod", "module visualnerve\n\ngo 1.27.0\n");
  assert.throws(() => f.package(), /pinned installer Go version is older/);
});

test("source symlinks, missing or duplicated placeholders and insecure metadata fail before publishing", (t) => {
  for (const siteUrl of [
    "http://localhost:1234/",
    "https://example.test/app/",
    "https://user:pass@example.test/",
    "https://example.test/?unsafe=1",
    "https://example.test/#unsafe",
    "https://example.test';touch${IFS}PWNED;'/",
    "https://example'host.test/",
    "https://example%27host.test/",
    "https://example$(whoami).test/",
    "https://example`whoami`.test/",
  ]) {
    const f = fixture(t);
    assert.throws(() => f.package({ siteUrl }), /HTTPS site origin/);
  }
  const f = fixture(t);
  const helper = readFileSync(
    resolve(f.root, "scripts/bridge-installer.sh.in"),
    "utf8",
  );
  f.put(
    "scripts/bridge-installer.sh.in",
    helper.replace("__VN_SOURCE_SHA256__", "missing"),
  );
  assert.throws(() => f.package(), /exactly once/);
  f.put("scripts/bridge-installer.sh.in", helper + "__VN_SOURCE_SHA256__");
  assert.throws(() => f.package(), /exactly once/);
  f.put("scripts/bridge-installer.sh.in", helper);
  symlinkSync(
    resolve(f.root, "LICENSE"),
    resolve(f.root, "backend/internal/secret.go"),
  );
  assert.throws(() => f.package(), /symlinks/);
});

test("public audit rejects corrupted archives, unexpected files, content inventory changes and installer substitution", (t) => {
  for (const corrupt of [
    "archive",
    "extra",
    "inventory",
    "installer",
    "manifest",
  ]) {
    const f = fixture(t),
      manifest = f.package();
    const downloads = resolve(f.outputDirectory, "downloads");
    if (corrupt === "archive")
      f.put(
        `public/downloads/${manifest.source.file}`,
        "not the pinned archive",
      );
    if (corrupt === "extra")
      f.put(
        "public/downloads/private.json",
        '{"format":"visual-nerve-workspace"}',
      );
    if (corrupt === "inventory") {
      manifest.files[0].sha256 = "f".repeat(64);
      f.put("public/downloads/bridge-release.json", JSON.stringify(manifest));
    }
    if (corrupt === "installer")
      f.put(
        "public/downloads/visual-nerve-bridge-setup.sh",
        "#!/bin/sh\necho changed\n",
      );
    if (corrupt === "manifest") {
      manifest.private = "not a release field";
      f.put("public/downloads/bridge-release.json", JSON.stringify(manifest));
    }
    assert.throws(
      () => auditBridgeDownloads(f.outputDirectory),
      /Invalid bridge downloads/,
    );
    assert.ok(readdirSync(downloads).length >= 5);
  }
});

test("the archive inspector rejects traversal, duplicate paths, symlinks and private payload entries", (t) => {
  const f = fixture(t),
    manifest = f.package();
  const original = unzipSync(
    readFileSync(resolve(f.outputDirectory, "downloads", manifest.source.file)),
  );
  for (const path of [
    "../private.go",
    `${BRIDGE_SOURCE_ROOT}backend/../../.env`,
    `${BRIDGE_SOURCE_ROOT}.env`,
    `${BRIDGE_SOURCE_ROOT}backend/private.json`,
  ]) {
    const entries = Object.fromEntries(
      Object.entries(original).map(([name, bytes]) => [
        name,
        [bytes, { os: 3, attrs: 0o100644 << 16 }],
      ]),
    );
    entries[path] = [
      Buffer.from("not public"),
      { os: 3, attrs: 0o100644 << 16 },
    ];
    assert.throws(
      () => inspectBridgeSource(Buffer.from(zipSync(entries))),
      /unapproved archive path/,
    );
  }
  const symlink = Object.fromEntries(
    Object.entries(original).map(([name, bytes]) => [
      name,
      [bytes, { os: 3, attrs: 0o120777 << 16 }],
    ]),
  );
  assert.throws(
    () => inspectBridgeSource(Buffer.from(zipSync(symlink))),
    /unsupported ZIP entry/,
  );
  const archive = readFileSync(
    resolve(f.outputDirectory, "downloads", manifest.source.file),
  );
  const end = archive.length - 22,
    offset = archive.readUInt32LE(end + 16);
  const firstRecord = archive.subarray(
    offset,
    offset + 46 + archive.readUInt16LE(offset + 28),
  );
  const trailer = Buffer.from(archive.subarray(end));
  trailer.writeUInt16LE(trailer.readUInt16LE(8) + 1, 8);
  trailer.writeUInt16LE(trailer.readUInt16LE(10) + 1, 10);
  trailer.writeUInt32LE(trailer.readUInt32LE(12) + firstRecord.length, 12);
  assert.throws(
    () =>
      inspectBridgeSource(
        Buffer.concat([archive.subarray(0, end), firstRecord, trailer]),
      ),
    /unapproved archive path/,
  );
});

test("static delivery accepts only complete verified download sets and the isolated app copies their exact paths", (t) => {
  const f = fixture(t),
    manifest = f.package();
  for (const file of [
    "index.html",
    "error.html",
    "editor/app.js",
    "appearance.js",
    "privacy/index.html",
    "sw.js",
  ])
    f.put(`public/${file}`, "static fixture");
  const files = auditStatic(f.outputDirectory);
  for (const file of files.filter((file) => file.startsWith("downloads/"))) {
    assert.equal(bridgeDownloadPath(file), true);
    assert.equal(copiedAsset(file), true);
  }
  assert.equal(copiedAsset("downloads/private.zip"), false);
  assert.equal(bridgeDownloadPath("downloads/source.zip"), false);
  rmSync(
    resolve(f.outputDirectory, "downloads", `${manifest.source.file}.sha256`),
  );
  assert.throws(() => auditStatic(f.outputDirectory));
});

test("deployment uploads pinned source before its installer with immutable and revalidating metadata", (t) => {
  const f = fixture(t),
    manifest = f.package();
  for (const file of [
    "index.html",
    "error.html",
    "editor/app.js",
    "appearance.js",
    "privacy/index.html",
    "sw.js",
    "licenses/inventory.json",
    "openapi.yaml",
  ])
    f.put(`public/${file}`, file.endsWith(".json") ? "[]" : "fixture");
  mkdirSync(resolve(f.outputDirectory, "editor/assets"), { recursive: true });
  for (const file of [
    "deploy-static.sh",
    "audit-static.mjs",
    "bridge-downloads.mjs",
    "site-icons.mjs",
    "fingerprinted-assets.mjs",
  ])
    copyFileSync(
      resolve(repository, "scripts", file),
      resolve(f.root, "scripts", file),
    );
  const bin = resolve(f.root, "bin"),
    log = resolve(f.root, "aws.jsonl");
  mkdirSync(bin);
  const aws = resolve(bin, "aws");
  writeFileSync(
    aws,
    `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');\n`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      resolve(f.root, "scripts/deploy-static.sh"),
      "test-bucket",
      "test-distribution",
      "--dry-run",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HUGO_PARAMS_ENVIRONMENT: "",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  const archive = calls.findIndex((call) =>
    call[2].endsWith(manifest.source.file),
  );
  const installer = calls.findIndex((call) =>
    call[2].endsWith(manifest.installer.file),
  );
  assert.ok(archive < installer);
  assert.ok(calls[archive].includes("public,max-age=31536000,immutable"));
  assert.ok(calls[archive].includes("application/zip"));
  assert.ok(calls[installer].includes("no-cache"));
  assert.ok(calls[installer].includes("text/plain; charset=utf-8"));
  const dependencies = calls.find((call) => call.includes("editor/assets/*"));
  assert.ok(dependencies.includes("downloads/*"));
  assert.ok(calls.every((call) => call.includes("--dryrun")));
  assert.equal(
    calls.some((call) => call[0] === "cloudfront"),
    false,
  );
});

test(
  "the real published source builds its native bridge and matching API contract without the repository",
  { timeout: 120_000 },
  (t) => {
    const directory = mkdtempSync(
      resolve(tmpdir(), "visual-nerve-source-build-"),
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const manifest = packageBridgeInstaller({
      outputDirectory: resolve(directory, "public"),
      revision: "a".repeat(40),
      sourceDirty: true,
    });
    const zip = readFileSync(
      resolve(directory, "public/downloads", manifest.source.file),
    );
    inspectBridgeSource(zip);
    for (const [path, content] of Object.entries(unzipSync(zip))) {
      const file = resolve(directory, "source", path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const result = spawnSync(
      "bash",
      [
        resolve(
          directory,
          "source/visual-nerve-bridge/scripts/build-bridge.sh",
        ),
        resolve(directory, "build"),
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 110_000,
        env: { ...process.env, GOTOOLCHAIN: "local" },
      },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
    const contract = JSON.parse(
      readFileSync(
        resolve(directory, "build/bridge-docs/openapi.yaml"),
        "utf8",
      ),
    );
    assert.equal(contract.info.version, manifest.bridgeVersion);
    assert.ok(contract.paths["/diagrams"]);
    assert.ok(contract.paths["/health"]);
    assert.ok(
      readFileSync(resolve(directory, "build/visual-nerve")).length > 100_000,
    );
  },
);

test("the generated installer's system Bash bootstrap preserves default arguments and clears ambient cache executables", (t) => {
  const f = fixture(t);
  const release = f.package({ root: repository });
  const home = resolve(f.root, "fresh home");
  const installation = resolve(home, ".local/share/visual-nerve/bridge");
  const go = resolve(installation, `toolchains/go${release.goVersion}/bin/go`);
  const marker = resolve(f.root, "helper-arguments.txt");
  mkdirSync(dirname(go), { recursive: true });
  // Only bootstrap argument handling is exercised here. No network, compiler or bridge is started.
  writeFileSync(
    go,
    `#!/bin/sh
if [ "$1" = version ]; then echo 'go version go${release.goVersion} fixture/fixture'; exit 0; fi
if [ "$1" != build ]; then exit 71; fi
if [ "\u0024{GOCACHEPROG-unset}" != "" ]; then echo 'Ambient cache executable was not cleared' >&2; exit 72; fi
shift
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'INERT_HELPER'
#!/bin/sh
printf '%s\\n' "$@" > "\u0024{VN_TEST_HELPER_MARKER:?}"
INERT_HELPER
chmod 700 "$output"
`,
    { mode: 0o700 },
  );
  const result = spawnSync(
    "/bin/bash",
    [resolve(f.outputDirectory, "downloads", release.installer.file)],
    {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        HOME: home,
        VN_TEST_HELPER_MARKER: marker,
        GOCACHEPROG: "/must-not-execute-an-ambient-cache-helper",
      },
    },
  );
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /unbound variable/);
  assert.match(
    result.stdout,
    /path-checked Go ZIP reader|verified Go ZIP reader/,
  );
  const arguments_ = readFileSync(marker, "utf8").trim().split("\n");
  assert.deepEqual(arguments_.slice(0, 2), ["--install-dir", installation]);
  assert.equal(
    arguments_[arguments_.indexOf("--source-sha256") + 1],
    release.source.sha256,
  );
  assert.equal(arguments_.includes("--origin"), false);
  assert.equal(arguments_.includes("--addr"), false);
  assert.ok(
    readFileSync(resolve(installation, "setup-helper"), "utf8").includes(
      "VN_TEST_HELPER_MARKER",
    ),
  );
});
