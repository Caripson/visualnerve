import { Inflate } from 'fflate';
import { detectProjectLanguage } from '../catalog';
import { checkedProjectSourceFileLimit } from './limits';
import {
  assertImportBytes,
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
} from '../../imports/limits';
import { generatedProjectText, privateProjectText, projectPathReason } from './policy';
import {
  projectArchiveLimits,
  projectIgnoredReasons,
  type ProjectArchiveOptions,
  type ProjectArchiveResult,
  type ProjectIgnoredReason,
} from './types';

const invalid = () => new Error('Invalid or unsupported project ZIP archive.');
const abort = () => new DOMException('Project loading was cancelled.', 'AbortError');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const crcTable = new Uint32Array(256).map((_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
interface ZipEntry {
  name: string;
  offset: number;
  size: number;
  expanded: number;
  crc: number;
  compression: number;
  directory: boolean;
}

/** No filesystem writes: ZIP names remain inert, validated relative identifiers. */
export class ProjectArchive {
  readonly entries: ZipEntry[] = [];
  readonly expandedBytes: number;
  private actualBytes = 0;
  private readonly limit: number;
  private readonly fileLimit: number;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly options: ProjectArchiveOptions = {},
  ) {
    this.limit = checkedImportLimitBytes(options.byteLimit ?? DEFAULT_IMPORT_LIMIT_BYTES);
    this.fileLimit = checkedProjectSourceFileLimit(options.fileLimit);
    this.checkCancelled();
    assertImportBytes(bytes.length, this.limit, 'Project ZIP');
    if (bytes.length < 22) throw invalid();
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => data.getUint16(offset, true);
    const u32 = (offset: number) => data.getUint32(offset, true);
    let end = bytes.length - 22;
    const minimumEnd = Math.max(0, bytes.length - 65_557);
    for (; end >= minimumEnd; end--) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    }
    if (end < minimumEnd) throw invalid();
    const count = u16(end + 10);
    const directorySize = u32(end + 12);
    let cursor = u32(end + 16);
    const directoryStart = cursor;
    if (count > projectArchiveLimits.entries)
      throw new Error(
        'Project ZIP archives are limited to 10,000 entries. Exclude dependencies and build output.',
      );
    if (
      u16(end + 4) !== 0 ||
      u16(end + 6) !== 0 ||
      u16(end + 8) !== count ||
      count === 0xffff ||
      cursor === 0xffffffff ||
      directorySize === 0xffffffff ||
      cursor + directorySize !== end
    )
      throw invalid();
    const names = new Set<string>();
    const ranges: Array<[number, number]> = [];
    let declared = 0;
    this.progress('scan', 0, count);
    for (let index = 0; index < count; index++) {
      this.checkCancelled();
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw invalid();
      const flags = u16(cursor + 8);
      const compression = u16(cursor + 10);
      const crc = u32(cursor + 16);
      const size = u32(cursor + 20);
      const expanded = u32(cursor + 24);
      const length = u16(cursor + 28);
      const extraLength = u16(cursor + 30);
      const next = cursor + 46 + length + extraLength + u16(cursor + 32);
      const local = u32(cursor + 42);
      const mode = (u32(cursor + 38) >>> 16) & 0xf000;
      if (
        next > end ||
        local + 30 > directoryStart ||
        u16(cursor + 6) > 20 ||
        u16(cursor + 34) !== 0 ||
        flags & ~0x080e ||
        ![0, 8].includes(compression) ||
        size === 0xffffffff ||
        expanded === 0xffffffff ||
        local === 0xffffffff ||
        (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)
      )
        throw invalid();
      let name: string;
      try {
        name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + length));
      } catch {
        throw invalid();
      }
      const directory = name.endsWith('/');
      const key = directory ? name.slice(0, -1) : name;
      if (
        !key ||
        key.length > projectArchiveLimits.path ||
        name.startsWith('/') ||
        /[\\\u0000-\u001f\u007f:]/.test(name) ||
        key.split('/').some((part) => !part || part === '..' || part === '.') ||
        names.has(key) ||
        (mode === 0x4000 && !directory) ||
        ((u32(cursor + 38) & 16) !== 0 && !directory) ||
        (directory && expanded !== 0)
      )
        throw invalid();
      names.add(key);
      this.checkExtra(cursor + 46 + length, extraLength, data);
      declared += expanded;
      assertImportBytes(declared, this.limit, 'Expanded project ZIP');
      if (
        u32(local) !== 0x04034b50 ||
        u16(local + 4) > 20 ||
        u16(local + 6) !== flags ||
        u16(local + 8) !== compression
      )
        throw invalid();
      const localNameLength = u16(local + 26);
      const localExtraLength = u16(local + 28);
      const offset = local + 30 + localNameLength + localExtraLength;
      if (offset + size > directoryStart || localNameLength !== length) throw invalid();
      for (let byte = 0; byte < length; byte++)
        if (bytes[local + 30 + byte] !== bytes[cursor + 46 + byte]) throw invalid();
      this.checkExtra(local + 30 + localNameLength, localExtraLength, data);
      let rangeEnd = offset + size;
      if (!(flags & 8)) {
        if (u32(local + 14) !== crc || u32(local + 18) !== size || u32(local + 22) !== expanded)
          throw invalid();
      } else {
        for (const [position, expected] of [
          [14, crc],
          [18, size],
          [22, expanded],
        ])
          if (u32(local + position) !== 0 && u32(local + position) !== expected) throw invalid();
        // Data descriptors are part of the local range, so they cannot overlap another entry.
        let descriptor = rangeEnd;
        if (
          descriptor + 16 <= directoryStart &&
          u32(descriptor) === 0x08074b50 &&
          u32(descriptor + 4) === crc &&
          u32(descriptor + 8) === size &&
          u32(descriptor + 12) === expanded
        )
          descriptor += 4;
        if (
          descriptor + 12 > directoryStart ||
          u32(descriptor) !== crc ||
          u32(descriptor + 4) !== size ||
          u32(descriptor + 8) !== expanded
        )
          throw invalid();
        rangeEnd = descriptor + 12;
      }
      if (compression === 0 && size !== expanded) throw invalid();
      ranges.push([local, rangeEnd]);
      this.entries.push({ name, offset, size, expanded, crc, compression, directory });
      cursor = next;
      this.progress('scan', index + 1, count);
    }
    if (cursor !== end) throw invalid();
    ranges.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < ranges.length; index++)
      if (ranges[index][0] < ranges[index - 1][1]) throw invalid();
    this.expandedBytes = declared;
  }

  private checkExtra(start: number, length: number, view: DataView) {
    const end = start + length;
    if (end > view.byteLength) throw invalid();
    for (let cursor = start; cursor < end; ) {
      if (cursor + 4 > end) throw invalid();
      const kind = view.getUint16(cursor, true);
      const next = cursor + 4 + view.getUint16(cursor + 2, true);
      if (kind === 1 || next > end) throw invalid();
      cursor = next;
    }
  }

  private checkCancelled() {
    if (this.options.signal?.aborted) throw abort();
  }
  private progress(stage: 'scan' | 'read', completed: number, total: number, path?: string) {
    this.options.onProgress?.({ stage, completed, total, ...(path ? { path } : {}) });
    this.checkCancelled();
  }

  /** Verifies every file, retaining output only for prospective source files. */
  private read(entry: ZipEntry, retain: boolean): Uint8Array | undefined {
    this.checkCancelled();
    let count = 0;
    let crc = 0xffffffff;
    const chunks: Uint8Array[] = [];
    const receive = (chunk: Uint8Array) => {
      this.checkCancelled();
      count += chunk.length;
      if (count > entry.expanded || this.actualBytes + count > this.limit)
        throw new Error('Project ZIP data exceeds its declared expanded size.');
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      if (retain) chunks.push(chunk);
    };
    const compressed = this.bytes.subarray(entry.offset, entry.offset + entry.size);
    if (entry.compression === 0) {
      for (let offset = 0; offset < compressed.length; offset += 16_384)
        receive(compressed.subarray(offset, offset + 16_384));
    } else {
      const inflater = new Inflate(receive);
      try {
        // Small compressed chunks bound a dishonest stream before large output allocation.
        for (let offset = 0; offset < compressed.length; offset += 256)
          inflater.push(
            compressed.subarray(offset, offset + 256),
            offset + 256 >= compressed.length,
          );
        if (!compressed.length) inflater.push(compressed, true);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        if (error instanceof Error && error.message.startsWith('Project ZIP')) throw error;
        throw invalid();
      }
    }
    if (count !== entry.expanded) throw invalid();
    if ((crc ^ 0xffffffff) >>> 0 !== entry.crc)
      throw new Error('Project ZIP checksum does not match.');
    this.actualBytes += count;
    if (!retain) return undefined;
    const output = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  load(name = 'Imported project'): ProjectArchiveResult {
    const ignored = {
      total: 0,
      reasons: Object.fromEntries(projectIgnoredReasons.map((reason) => [reason, 0])) as Record<
        ProjectIgnoredReason,
        number
      >,
    };
    const result: ProjectArchiveResult = {
      name,
      files: [],
      ignored,
      expandedBytes: this.expandedBytes,
      fileLimit: this.fileLimit,
    };
    const prefix = this.entries[0]?.name.split('/')[0];
    const stripRoot = Boolean(
      prefix &&
      this.entries.every(
        (entry) =>
          entry.name.startsWith(`${prefix}/`) && (entry.name !== `${prefix}/` || entry.directory),
      ),
    );
    this.progress('read', 0, this.entries.length);
    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index];
      const path = stripRoot ? entry.name.slice(prefix!.length + 1) : entry.name;
      let reason = projectPathReason(entry.name) ?? (path ? projectPathReason(path) : 'directory');
      const bytes = this.read(entry, !reason);
      if (!reason && bytes) {
        let content: string | undefined;
        try {
          content = utf8.decode(bytes);
        } catch {
          reason = 'binary';
        }
        if (content !== undefined) {
          if (privateProjectText(content)) reason = 'private';
          else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) reason = 'binary';
          else if (generatedProjectText(content)) reason = 'generated';
          else {
            const language = detectProjectLanguage(path, content);
            if (!language && !path.split('/').at(-1)?.includes('.')) reason = 'unsupported';
            else {
              if (result.files.length >= this.fileLimit)
                throw new Error(
                  `Project contains more than ${this.fileLimit.toLocaleString('en-US')} analyzable files. Increase the ZIP project source-file limit in Settings or import a smaller archive. Other safety limits still apply.`,
                );
              result.files.push({ path, content, ...(language ? { language } : {}) });
            }
          }
        }
      }
      if (reason) {
        ignored.total++;
        ignored.reasons[reason]++;
      }
      this.progress('read', index + 1, this.entries.length, path || entry.name);
    }
    if (this.actualBytes !== this.expandedBytes) throw invalid();
    if (!result.files.length)
      throw new Error(
        'Project ZIP contains no supported source or Markdown files. Dependencies, generated output, private and binary files are excluded.',
      );
    return result;
  }
}

export function loadProjectArchive(
  bytes: Uint8Array,
  name = 'Imported project',
  options: ProjectArchiveOptions = {},
): ProjectArchiveResult {
  return new ProjectArchive(bytes, options).load(name);
}
