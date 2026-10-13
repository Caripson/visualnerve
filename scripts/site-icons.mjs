import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE_ICON_FILES = Object.freeze([
  "favicon.ico",
  "favicon-96x96.png",
  "apple-touch-icon.png",
]);
export const SITE_ICON_PATHS = Object.freeze(
  SITE_ICON_FILES.map((path) => `/${path}`),
);
const iconSizes = [16, 32, 48, 256];
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sourceKey = "VisualNerveSourceSHA256";

export function siteIconLinks() {
  return '<link rel="icon" href="/site/mark.svg" type="image/svg+xml" sizes="any"><link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96"><link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16 32x32 48x48 256x256"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">';
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    header = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc(Buffer.concat([name, bytes])));
  return Buffer.concat([header, name, bytes, checksum]);
}
function png(bytes) {
  if (!bytes.subarray(0, 8).equals(signature))
    throw new Error("Icon must contain a PNG image.");
  let offset = 8,
    width,
    height,
    source;
  const types = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated icon PNG.");
    const type = bytes.toString("ascii", offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    if (
      crc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new Error("Icon PNG checksum does not match.");
    types.push(type);
    if (type === "IHDR") {
      if (length !== 13 || types.length !== 1)
        throw new Error("Invalid icon PNG header.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6)
        throw new Error("Icons must use 8-bit RGBA PNG.");
    }
    if (type === "tEXt" && data.toString().startsWith(`${sourceKey}\0`))
      source = data.toString().slice(sourceKey.length + 1);
    offset = end;
    if (type === "IEND") break;
  }
  if (
    !width ||
    width !== height ||
    offset !== bytes.length ||
    types.at(-1) !== "IEND" ||
    !types.includes("IDAT")
  )
    throw new Error("Invalid square icon PNG.");
  return { width, height, source };
}
function withSource(bytes, source) {
  png(bytes);
  // Preserve the browser's original pixels and add provenance before the IEND chunk.
  return Buffer.concat([
    bytes.subarray(0, bytes.length - 12),
    chunk("tEXt", Buffer.from(`${sourceKey}\0${source}`)),
    bytes.subarray(bytes.length - 12),
  ]);
}
export function buildIconContainer(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((bytes, index) => {
    const { width, height } = png(bytes),
      record = 6 + index * 16;
    if (width > 256) throw new Error("ICO image exceeds 256 pixels.");
    header[record] = width === 256 ? 0 : width;
    header[record + 1] = height === 256 ? 0 : height;
    header.writeUInt16LE(1, record + 4);
    header.writeUInt16LE(32, record + 6);
    header.writeUInt32LE(bytes.length, record + 8);
    header.writeUInt32LE(offset, record + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...frames]);
}
export function validateSiteIcons(directory) {
  const source = createHash("sha256")
    .update(readFileSync(resolve(directory, "site/mark.svg")))
    .digest("hex");
  const ico = readFileSync(resolve(directory, "favicon.ico"));
  if (
    ico.length < 70 ||
    ico.readUInt16LE(0) !== 0 ||
    ico.readUInt16LE(2) !== 1 ||
    ico.readUInt16LE(4) !== iconSizes.length
  )
    throw new Error("Invalid favicon ICO directory.");
  let next = 6 + iconSizes.length * 16;
  const frames = iconSizes.map((size, index) => {
    const record = 6 + index * 16,
      length = ico.readUInt32LE(record + 8),
      offset = ico.readUInt32LE(record + 12);
    if (
      (ico[record] || 256) !== size ||
      (ico[record + 1] || 256) !== size ||
      ico.readUInt16LE(record + 4) !== 1 ||
      ico.readUInt16LE(record + 6) !== 32 ||
      offset !== next ||
      offset + length > ico.length
    )
      throw new Error("Invalid favicon ICO image entry.");
    const info = png(ico.subarray(offset, offset + length));
    if (info.width !== size || info.source !== source)
      throw new Error("Favicon image does not match its source mark.");
    next = offset + length;
    return size;
  });
  if (next !== ico.length) throw new Error("Unexpected favicon ICO bytes.");
  for (const [name, size] of [
    ["favicon-96x96.png", 96],
    ["apple-touch-icon.png", 180],
  ]) {
    const info = png(readFileSync(resolve(directory, name)));
    if (info.width !== size || info.source !== source)
      throw new Error(`${name} does not match its source mark.`);
  }
  return { source, frames, pngSize: 96, appleSize: 180 };
}
export async function generateSiteIcons(directory, executablePath) {
  const svg = readFileSync(resolve(directory, "site/mark.svg"), "utf8"),
    source = createHash("sha256").update(svg).digest("hex");
  const { chromium } =
    await import("../frontend/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    const images = await page.evaluate(
      async ({ svg, sizes }) => {
        const mark = new Image();
        mark.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await mark.decode();
        return sizes.map(({ size, tile }) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const context = canvas.getContext("2d");
          if (tile) {
            context.fillStyle = "#202522";
            context.fillRect(0, 0, size, size);
          }
          context.drawImage(mark, 0, 0, size, size);
          return canvas.toDataURL("image/png").split(",")[1];
        });
      },
      {
        svg,
        sizes: [
          ...iconSizes.map((size) => ({ size })),
          { size: 96 },
          { size: 180, tile: true },
        ],
      },
    );
    const buffers = images.map((image) =>
      withSource(Buffer.from(image, "base64"), source),
    );
    writeFileSync(
      resolve(directory, "favicon.ico"),
      buildIconContainer(buffers.slice(0, 4)),
    );
    writeFileSync(resolve(directory, "favicon-96x96.png"), buffers[4]);
    writeFileSync(resolve(directory, "apple-touch-icon.png"), buffers[5]);
    return validateSiteIcons(directory);
  } finally {
    await browser.close();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url))),
    directory = resolve(root, process.argv[3] ?? "hugo/static");
  if (process.argv[2] === "--generate")
    await generateSiteIcons(directory, process.argv[4]);
  else if (process.argv[2] !== "--check")
    throw new Error(
      "Usage: node scripts/site-icons.mjs --check|--generate [hugo/static [Chrome executable]]",
    );
  validateSiteIcons(directory);
  console.log(
    `Site icons checked: ${SITE_ICON_FILES.join(", ")}; source mark preserved.`,
  );
}
