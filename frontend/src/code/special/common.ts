import { codeLimits, type CodeDependency, type CodeObjectKind, type ExtractedCode } from '../types';

/** Family analyzers keep identifiers and locations only, never original source. */
export class Extraction {
  result: ExtractedCode = { symbols: [], dependencies: [], warnings: [] };
  private dependencyKeys = new Set<string>();
  private symbolKeys = new Set<string>();
  private starts: number[] = [0];

  constructor(content: string) {
    for (let i = 0; i < content.length; i++) if (content[i] === '\n') this.starts.push(i + 1);
  }

  line(offset: number): number {
    let low = 0;
    let high = this.starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  }

  symbol(
    name: string,
    kind: Exclude<CodeObjectKind, 'file' | 'external'>,
    offset: number,
    parent?: string,
  ): string | undefined {
    if (this.result.symbols.length >= codeLimits.symbols) {
      throw new Error(`Code analysis exceeds the ${codeLimits.symbols} symbol limit.`);
    }
    const line = this.line(offset);
    const cleanName = name.trim();
    if (cleanName.length > 500) throw new Error('Code identifier exceeds the 500 character limit.');
    if (!cleanName) return;
    const key = `${kind}:${offset}:${cleanName}`;
    if (!this.symbolKeys.has(key)) {
      this.symbolKeys.add(key);
      this.result.symbols.push({ key, name: cleanName, kind, line, ...(parent ? { parent } : {}) });
    }
    return key;
  }

  dependency(dependency: Omit<CodeDependency, 'line'>, offset: number): void {
    const target = dependency.target.trim();
    if (target.length > 500)
      throw new Error('Code dependency name exceeds the 500 character limit.');
    if (!target) return;
    const line = this.line(offset);
    const key = `${dependency.source ?? ''}\0${dependency.kind}\0${target}\0${line}`;
    if (this.dependencyKeys.has(key)) return;
    if (this.result.dependencies.length >= codeLimits.edges)
      throw new Error(`Code analysis exceeds the ${codeLimits.edges} dependency limit.`);
    this.dependencyKeys.add(key);
    this.result.dependencies.push({ ...dependency, target, line });
  }

  warn(message: string): void {
    if (
      !this.result.warnings.includes(message) &&
      this.result.warnings.length < codeLimits.warnings
    )
      this.result.warnings.push(message);
  }
}

/** A raw identifier match is accepted only when its syntax marker survived masking. */
export const visible = (masked: string, start: number, marker: string): boolean =>
  masked.slice(start, start + marker.length) === marker;

export function boundedContent(content: string, _extraction: Extraction): string {
  return content
    .split('\n')
    .map((line) => {
      if (line.length <= codeLimits.lineLength) return line;
      throw new Error(`Code analysis exceeds the ${codeLimits.lineLength} character line limit.`);
    })
    .join('\n');
}
