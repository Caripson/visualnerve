import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditBridgeDownloads,
  bridgeDigest,
  bridgeSourcePath,
  inspectBridgeSource,
  BRIDGE_INSTALLER_FILE,
  BRIDGE_RELEASE_FILE,
  BRIDGE_SOURCE_ROOT,
} from "./bridge-downloads.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { zipSync } = createRequire(resolve(repository, "frontend/package.json"))(
  "fflate",
);
export const INSTALLER_GO_VERSION = "1.26.9";

function sourceFile(root, path) {
  let current = root;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`Bridge source cannot contain symlinks: ${path}`);
  }
  if (!lstatSync(current).isFile())
    throw new Error(`Bridge source must be a regular file: ${path}`);
  return readFileSync(current);
}

function sourceFiles(root) {
  const paths = [
    "LICENSE",
    "NOTICE",
    "scripts/build-bridge.sh",
    "backend/go.mod",
    "backend/go.sum",
    "backend/internal/model/notation_catalog.json",
  ];
  function visit(path) {
    const stat = lstatSync(resolve(root, path));
    if (stat.isSymbolicLink())
      throw new Error(`Bridge source cannot contain symlinks: ${path}`);
    if (stat.isDirectory())
      for (const name of readdirSync(resolve(root, path)).sort())
        visit(`${path}/${name}`);
    else if (bridgeSourcePath(path)) paths.push(path);
  }
  visit("backend/cmd");
  visit("backend/internal");
  return [...new Set(paths)]
    .sort()
    .map((path) => [path, sourceFile(root, path)]);
}

export function packageBridgeInstaller({
  root = repository,
  outputDirectory,
  siteUrl = "https://visualnerve.caripson.com/",
  revision,
  sourceDirty,
} = {}) {
  root = realpathSync(root);
  const base = new URL(siteUrl);
  if (
    base.protocol !== "https:" ||
    !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error(
      "Bridge downloads require an HTTPS site origin without a path, credentials, query or fragment.",
    );
  const files = sourceFiles(root);
  const bridgeVersion = sourceFile(
    root,
    "backend/internal/server/operations.go",
  )
    .toString("utf8")
    .match(/\bbridgeVersion\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1];
  const goMinimumVersion = sourceFile(root, "backend/go.mod")
    .toString("utf8")
    .match(/^go (\d+\.\d+\.\d+)$/m)?.[1];
  if (!bridgeVersion || !goMinimumVersion)
    throw new Error("Cannot determine bridge and Go versions from source.");
  const minimum = goMinimumVersion.split(".").map(Number);
  const pinned = INSTALLER_GO_VERSION.split(".").map(Number);
  const difference =
    pinned
      .map((part, index) => part - minimum[index])
      .find((part) => part !== 0) ?? 0;
  if (difference < 0)
    throw new Error(
      "The pinned installer Go version is older than backend/go.mod.",
    );
  revision ??= execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  sourceDirty ??=
    execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--untracked-files=normal",
        "--",
        "backend",
        "scripts/build-bridge.sh",
        "scripts/bridge-installer.sh.in",
        "scripts/bridge-installer-helper.go",
        "scripts/package-bridge-installer.mjs",
        "scripts/bridge-downloads.mjs",
        "LICENSE",
        "NOTICE",
      ],
      { cwd: root, encoding: "utf8" },
    ).trim() !== "";
  if (!/^[a-f0-9]{40}$/.test(revision) || typeof sourceDirty !== "boolean")
    throw new Error(
      "Bridge release requires a full revision and explicit dirty-tree state.",
    );
  const archive = zipSync(
    Object.fromEntries(
      files.map(([path, bytes]) => [
        `${BRIDGE_SOURCE_ROOT}${path}`,
        [
          bytes,
          {
            level: 9,
            mtime: new Date(2000, 0, 1),
            os: 3,
            attrs: (0o100000 | (path.endsWith(".sh") ? 0o755 : 0o644)) << 16,
          },
        ],
      ]),
    ),
  );
  const sourceHash = bridgeDigest(archive),
    sourceName = `visual-nerve-bridge-source-${sourceHash}.zip`;
  const sourceUrl = new URL(`downloads/${sourceName}`, base).href;
  const substitutions = {
    __VN_SOURCE_URL__: sourceUrl,
    __VN_SOURCE_SHA256__: sourceHash,
    __VN_BRIDGE_VERSION__: bridgeVersion,
    __VN_BUILD_REVISION__: revision,
    __VN_GO_VERSION__: INSTALLER_GO_VERSION,
    __VN_HELPER_GO_SOURCE__: sourceFile(
      root,
      "scripts/bridge-installer-helper.go",
    ).toString("utf8"),
  };
  let installer = sourceFile(root, "scripts/bridge-installer.sh.in").toString(
    "utf8",
  );
  for (const [token, value] of Object.entries(substitutions)) {
    if (installer.split(token).length !== 2)
      throw new Error(`Installer template must include ${token} exactly once.`);
    installer = installer.replace(token, () => value);
  }
  if (/__VN_[A-Z_]+__/.test(installer))
    throw new Error("Installer contains an unresolved build token.");
  const record = (file, bytes) => ({
    file,
    url: new URL(`downloads/${file}`, base).href,
    sha256: bridgeDigest(bytes),
    bytes: Buffer.byteLength(bytes),
  });
  const manifest = {
    format: "visual-nerve-bridge-release",
    schemaVersion: 1,
    bridgeVersion,
    revision,
    sourceDirty,
    goVersion: INSTALLER_GO_VERSION,
    goMinimumVersion,
    source: record(sourceName, archive),
    installer: record(BRIDGE_INSTALLER_FILE, installer),
    files: inspectBridgeSource(Buffer.from(archive)),
  };
  const output = resolve(outputDirectory ?? resolve(root, "public"));
  mkdirSync(output, { recursive: true });
  if (lstatSync(output).isSymbolicLink())
    throw new Error("Bridge publication output must not be a symlink.");
  const temporary = mkdtempSync(resolve(output, ".bridge-downloads-"));
  try {
    const downloads = resolve(temporary, "downloads");
    mkdirSync(downloads);
    for (const [entry, content] of [
      [manifest.source, archive],
      [manifest.installer, installer],
    ]) {
      writeFileSync(resolve(downloads, entry.file), content, {
        mode: entry === manifest.installer ? 0o755 : 0o644,
      });
      writeFileSync(
        resolve(downloads, `${entry.file}.sha256`),
        `${entry.sha256}  ${entry.file}\n`,
      );
    }
    writeFileSync(
      resolve(downloads, BRIDGE_RELEASE_FILE),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    auditBridgeDownloads(temporary);
    const destination = resolve(output, "downloads");
    auditBridgeDownloads(output);
    rmSync(destination, { recursive: true, force: true });
    renameSync(downloads, destination);
    return manifest;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = packageBridgeInstaller({
    outputDirectory: process.argv[2],
    siteUrl: process.env.SITE_URL,
  });
  console.log(
    `Packaged Visual Nerve bridge ${result.bridgeVersion}: ${result.files.length} source files, ${result.source.bytes} bytes, SHA256 ${result.source.sha256}.`,
  );
}
