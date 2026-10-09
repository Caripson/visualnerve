import { ExchangeExportError, exchangeLimits } from './exchange-types';

/** Literal XML text/attributes. Character references retain attribute whitespace. */
export function exchangeXML(value: string): string {
  // In Unicode mode a surrogate range matches unpaired code units, not valid pairs.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value))
    throw new ExchangeExportError(
      'invalid_text',
      'Diagram text contains characters that XML 1.0 cannot represent.',
    );
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
    '\t': '&#9;',
    '\n': '&#10;',
    '\r': '&#13;',
  };
  return value.replace(/[&<>"'\t\n\r]/g, (character) => entities[character]);
}

/** Limit generated UTF-8 bytes while writing, before retaining a complete XML file. */
export class ExchangeXmlWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly encoder = new TextEncoder();
  private size = 0;
  constructor(private readonly maxBytes: number = exchangeLimits.bytes) {}

  write(value: string): void {
    if (value.length > this.maxBytes - this.size) this.exceeded();
    const chunk = this.encoder.encode(value);
    if (chunk.byteLength > this.maxBytes - this.size) this.exceeded();
    this.chunks.push(chunk);
    this.size += chunk.byteLength;
  }

  bytes(): Uint8Array {
    const result = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private exceeded(): never {
    throw new ExchangeExportError(
      'output_limit',
      'The editable diagram exceeds the export byte limit. Export a smaller selection.',
    );
  }
}
