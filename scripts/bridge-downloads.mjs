import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export const BRIDGE_INSTALLER_FILE = "visual-nerve-bridge-setup.sh";
export const BRIDGE_RELEASE_FILE = "bridge-release.json";
export const BRIDGE_SOURCE_ROOT = "visual-nerve-bridge/";
export const BRIDGE_SOURCE_LIMIT = 8 * 1024 * 1024;
export const bridgeDigest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const bridgeSourcePath = (path) =>
  [
    "LICENSE",
    "NOTICE",
    "scripts/build-bridge.sh",
    "backend/go.mod",
    "backend/go.sum",
    "backend/internal/model/notation_catalog.json",
  ].includes(path) ||
  (/^backend\/(?:cmd|internal)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.go$/.test(
    path,
  ) &&
    !path.endsWith("_test.go"));
export const bridgeDownloadPath = (path) =>
  [
    BRIDGE_INSTALLER_FILE,
    `${BRIDGE_INSTALLER_FILE}.sha256`,
    BRIDGE_RELEASE_FILE,
  ].some((file) => path === `downloads/${file}`) ||
  /^downloads\/visual-nerve-bridge-source-[a-f0-9]{64}\.zip(?:\.sha256)?$/.test(
    path,
  );

function requireValue(condition, reason) {
  if (!condition) throw new Error(`Invalid bridge downloads: ${reason}`);
}
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function regularFile(directory, path) {
  const file = resolve(directory, path);
  const stat = lstatSync(file);
  requireValue(
    stat.isFile() && !stat.isSymbolicLink(),
    `not a regular file: ${path}`,
  );
  requireValue(
    stat.size <= BRIDGE_SOURCE_LIMIT,
    `file exceeds the publication limit: ${path}`,
  );
  return readFileSync(file);
}

// Inspect the bounded ZIP as data. No archive entry is written to disk or executed.
export function inspectBridgeSource(bytes) {
  requireValue(
    bytes.length >= 22 && bytes.length <= BRIDGE_SOURCE_LIMIT,
    "invalid archive size",
  );
  const end = bytes.length - 22;
  requireValue(
    bytes.readUInt32LE(end) === 0x06054b50 &&
      bytes.readUInt16LE(end + 20) === 0,
    "ZIP trailer or comment",
  );
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    offset = bytes.readUInt32LE(end + 16);
  requireValue(
    count > 0 &&
      count <= 1000 &&
      bytes.readUInt16LE(end + 8) === count &&
      bytes.readUInt32LE(end + 4) === 0 &&
      offset + size === end,
    "ZIP directory",
  );
  const records = [];
  const names = new Set();
  let cursor = offset,
    expanded = 0,
    nextLocal = 0;
  for (let index = 0; index < count; index++) {
    requireValue(
      cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50,
      "ZIP directory entry",
    );
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20),
      length = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38),
      local = bytes.readUInt32LE(cursor + 42);
    requireValue(
      cursor + 46 + nameLength + extra + comment <= end &&
        extra === 0 &&
        comment === 0,
      "ZIP name bounds or unapproved metadata",
    );
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    const path = name.slice(BRIDGE_SOURCE_ROOT.length);
    requireValue(
      name.startsWith(BRIDGE_SOURCE_ROOT) &&
        bridgeSourcePath(path) &&
        !names.has(name),
      `unapproved archive path: ${name}`,
    );
    requireValue(
      (flags & ~0x800) === 0 &&
        [0, 8].includes(method) &&
        ((attributes >>> 16) & 0o170000) === 0o100000,
      `unsupported ZIP entry: ${name}`,
    );
    requireValue(
      local === nextLocal &&
        local + 30 <= offset &&
        bytes.readUInt32LE(local) === 0x04034b50,
      "ZIP local entry",
    );
    const localNameLength = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtra;
    requireValue(
      localExtra === 0 &&
        start + compressed <= offset &&
        bytes
          .subarray(local + 30, local + 30 + localNameLength)
          .toString("utf8") === name &&
        bytes.readUInt16LE(local + 6) === flags &&
        bytes.readUInt16LE(local + 8) === method &&
        bytes.readUInt32LE(local + 14) === bytes.readUInt32LE(cursor + 16) &&
        bytes.readUInt32LE(local + 18) === compressed &&
        bytes.readUInt32LE(local + 22) === length,
      "ZIP local metadata differs",
    );
    expanded += length;
    requireValue(
      expanded <= BRIDGE_SOURCE_LIMIT && length > 0,
      "expanded archive limit",
    );
    const payload = bytes.subarray(start, start + compressed);
    const content =
      method === 0
        ? payload
        : inflateRawSync(payload, { maxOutputLength: length });
    requireValue(content.length === length, "expanded ZIP entry size");
    names.add(name);
    records.push({ path, bytes: length, sha256: bridgeDigest(content) });
    nextLocal = start + compressed;
    cursor += 46 + nameLength + extra + comment;
  }
  requireValue(
    cursor === end && nextLocal === offset,
    "unexpected ZIP directory data",
  );
  for (const path of [
    "LICENSE",
    "NOTICE",
    "scripts/build-bridge.sh",
    "backend/go.mod",
    "backend/go.sum",
    "backend/cmd/visual-nerve/main.go",
    "backend/cmd/openapi/main.go",
    "backend/internal/model/notation_catalog.json",
  ])
    requireValue(
      names.has(`${BRIDGE_SOURCE_ROOT}${path}`),
      `missing source: ${path}`,
    );
  return records.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

export function auditBridgeDownloads(directory) {
  const downloads = resolve(directory, "downloads");
  if (!existsSync(downloads)) return null;
  requireValue(
    lstatSync(downloads).isDirectory() &&
      !lstatSync(downloads).isSymbolicLink(),
    "downloads directory",
  );
  const manifest = JSON.parse(
    regularFile(downloads, BRIDGE_RELEASE_FILE).toString("utf8"),
  );
  requireValue(
    exactKeys(manifest, [
      "format",
      "schemaVersion",
      "bridgeVersion",
      "revision",
      "sourceDirty",
      "goVersion",
      "goMinimumVersion",
      "source",
      "installer",
      "files",
    ]),
    "manifest fields",
  );
  requireValue(
    manifest.format === "visual-nerve-bridge-release" &&
      manifest.schemaVersion === 1,
    "manifest format",
  );
  requireValue(
    [
      manifest.bridgeVersion,
      manifest.goVersion,
      manifest.goMinimumVersion,
      manifest.revision,
    ].every((value) => typeof value === "string") &&
      /^\d+\.\d+\.\d+$/.test(manifest.bridgeVersion) &&
      /^\d+\.\d+\.\d+$/.test(manifest.goVersion) &&
      /^\d+\.\d+\.\d+$/.test(manifest.goMinimumVersion),
    "version metadata",
  );
  requireValue(
    /^[a-f0-9]{40}$/.test(manifest.revision) &&
      typeof manifest.sourceDirty === "boolean",
    "revision metadata",
  );
  const expected = [BRIDGE_RELEASE_FILE];
  for (const [type, record] of [
    ["source", manifest.source],
    ["installer", manifest.installer],
  ]) {
    requireValue(
      exactKeys(record, ["file", "url", "sha256", "bytes"]),
      `${type} fields`,
    );
    requireValue(
      record && /^[a-f0-9]{64}$/.test(record.sha256),
      `${type} hash`,
    );
    requireValue(
      record.file ===
        (type === "source"
          ? `visual-nerve-bridge-source-${record.sha256}.zip`
          : BRIDGE_INSTALLER_FILE),
      `${type} filename`,
    );
    const url = new URL(record.url);
    requireValue(
      url.protocol === "https:" &&
        /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === `/downloads/${record.file}`,
      `${type} HTTPS URL`,
    );
    const content = regularFile(downloads, record.file);
    requireValue(
      content.length === record.bytes &&
        bridgeDigest(content) === record.sha256,
      `${type} checksum mismatch`,
    );
    requireValue(
      regularFile(downloads, `${record.file}.sha256`).toString("utf8") ===
        `${record.sha256}  ${record.file}\n`,
      `${type} checksum sidecar`,
    );
    if (type === "source")
      requireValue(
        JSON.stringify(inspectBridgeSource(content)) ===
          JSON.stringify(manifest.files),
        "source inventory mismatch",
      );
    else
      requireValue(
        content.toString("utf8").startsWith("#!/") &&
          !/__VN_[A-Z_]+__/.test(content.toString("utf8")) &&
          content.includes(manifest.source.sha256) &&
          content.includes(manifest.source.url),
        "installer pins",
      );
    expected.push(record.file, `${record.file}.sha256`);
  }
  requireValue(
    JSON.stringify(readdirSync(downloads).sort()) ===
      JSON.stringify(expected.sort()),
    "unexpected or missing download files",
  );
  return manifest;
}
