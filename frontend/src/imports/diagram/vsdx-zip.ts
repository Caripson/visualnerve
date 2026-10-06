import { Inflate } from 'fflate';
import { diagramImportLimits } from './types';
import { decodeXmlBytes } from './input';

const fileLimit = diagramImportLimits.fileBytes;
const expandedLimit = diagramImportLimits.expandedBytes;
const entryLimit = diagramImportLimits.entries;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const invalidZip = () => new Error('Invalid or unsupported Visio ZIP package.');

interface Entry {
  name: string;
  offset: number;
  size: number;
  expanded: number;
  crc: number;
  compression: number;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Reads only requested parts. All archive declarations are checked before inflation. */
export class VisioPackage {
  private entries = new Map<string, Entry>();
  private cache = new Map<string, string>();
  private expanded = 0;

  constructor(private bytes: Uint8Array) {
    if (bytes.length > fileLimit) throw new Error('Visio files are limited to 32 MiB.');
    if (bytes.length < 22) throw invalidZip();
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => data.getUint16(offset, true);
    const u32 = (offset: number) => data.getUint32(offset, true);
    let end = bytes.length - 22;
    const minimumEnd = Math.max(0, bytes.length - 65557);
    for (; end >= minimumEnd; end--) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    }
    if (end < minimumEnd) throw invalidZip();
    const count = u16(end + 10);
    const directorySize = u32(end + 12);
    let cursor = u32(end + 16);
    const directoryStart = cursor;
    if (count > entryLimit) throw new Error('Visio packages are limited to 2,048 entries.');
    if (
      u16(end + 4) !== 0 ||
      u16(end + 6) !== 0 ||
      u16(end + 8) !== count ||
      count === 0xffff ||
      cursor === 0xffffffff ||
      directorySize === 0xffffffff ||
      cursor + directorySize !== end
    )
      throw invalidZip();
    let declared = 0;
    const ranges: Array<[number, number]> = [];
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw invalidZip();
      const flags = u16(cursor + 8);
      const compression = u16(cursor + 10);
      const crc = u32(cursor + 16);
      const size = u32(cursor + 20);
      const expanded = u32(cursor + 24);
      const length = u16(cursor + 28);
      const next = cursor + 46 + length + u16(cursor + 30) + u16(cursor + 32);
      const local = u32(cursor + 42);
      if (
        next > end ||
        local + 30 > directoryStart ||
        u16(cursor + 34) !== 0 ||
        flags & 0x41 ||
        ![0, 8].includes(compression) ||
        size === 0xffffffff ||
        expanded === 0xffffffff ||
        local === 0xffffffff
      )
        throw invalidZip();
      let name: string;
      try {
        name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + length));
      } catch {
        throw invalidZip();
      }
      if (
        !name ||
        name.startsWith('/') ||
        /[\\\u0000-\u001f:]/.test(name) ||
        name.split('/').some((part) => part === '..' || part === '.') ||
        this.entries.has(name)
      )
        throw invalidZip();
      declared += expanded;
      if (declared > expandedLimit)
        throw new Error('Expanded Visio packages are limited to 64 MiB.');
      if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== compression)
        throw invalidZip();
      const localNameLength = u16(local + 26);
      const offset = local + 30 + localNameLength + u16(local + 28);
      if (offset + size > directoryStart || localNameLength !== length) throw invalidZip();
      for (let byte = 0; byte < length; byte++)
        if (bytes[local + 30 + byte] !== bytes[cursor + 46 + byte]) throw invalidZip();
      if (
        !(flags & 8) &&
        (u32(local + 14) !== crc || u32(local + 18) !== size || u32(local + 22) !== expanded)
      )
        throw invalidZip();
      if (compression === 0 && size !== expanded) throw invalidZip();
      ranges.push([local, offset + size]);
      this.entries.set(name, { name, offset, size, expanded, crc, compression });
      cursor = next;
    }
    if (cursor !== end) throw invalidZip();
    ranges.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < ranges.length; index++)
      if (ranges[index][0] < ranges[index - 1][1]) throw invalidZip();
  }

  names() {
    return [...this.entries.keys()];
  }
  has(name: string) {
    return this.entries.has(name);
  }

  text(name: string): string {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Visio package is missing ${name}.`);
    const compressed = this.bytes.subarray(entry.offset, entry.offset + entry.size);
    let output: Uint8Array;
    if (entry.compression === 0) output = compressed;
    else {
      const chunks: Uint8Array[] = [];
      let count = 0;
      const inflater = new Inflate((chunk) => {
        count += chunk.length;
        if (count > entry.expanded || this.expanded + count > expandedLimit)
          throw new Error('Visio ZIP data exceeds its declared expanded size.');
        chunks.push(chunk);
      });
      try {
        // Limit each inflation step, including archives that lie about their expanded size.
        for (let offset = 0; offset < compressed.length; offset += 256)
          inflater.push(
            compressed.subarray(offset, offset + 256),
            offset + 256 >= compressed.length,
          );
        if (!compressed.length) inflater.push(compressed, true);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Visio ZIP')) throw error;
        throw invalidZip();
      }
      if (count !== entry.expanded) throw invalidZip();
      output = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
    }
    if (crc32(output) !== entry.crc) throw new Error('Visio ZIP checksum does not match.');
    this.expanded += output.length;
    const text = decodeXmlBytes(output);
    this.cache.set(name, text);
    return text;
  }
}

/** OPC relationship targets can use ../ within the package; they never become URLs. */
export function resolveVisioPart(source: string, target: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    throw invalidZip();
  }
  if (
    !decoded ||
    /[\\\u0000-\u001f?#]/.test(decoded) ||
    decoded.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  )
    throw new Error('Visio relationships must point to parts inside the package.');
  const parts = decoded.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('Visio relationship escapes the package.');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export function relationshipPart(source: string) {
  const slash = source.lastIndexOf('/');
  return `${source.slice(0, slash + 1)}_rels/${source.slice(slash + 1)}.rels`;
}
