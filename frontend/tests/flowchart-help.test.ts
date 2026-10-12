import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ibmSymbols } from '../src/flowchart/ibm-symbols';
import { ibmSymbolSize } from '../src/flowchart/template';

const file = (path: string) => readFileSync(resolve(process.cwd(), '..', path), 'utf8');
const geometry = JSON.parse(file('hugo/data/flowchart_symbols.json'));
const guide = file('hugo/content/help/flowchart-symbols.md');

describe('static flowchart symbol-use reference', () => {
  it('covers every catalog choice once and keeps vector geometry/proportions identical to the editor', () => {
    const entries = [...guide.matchAll(/flowchart-symbol id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(entries).size).toBe(43);
    expect(entries).toHaveLength(43);
    expect(new Set(entries)).toEqual(new Set(ibmSymbols.map((symbol) => symbol.id)));
    expect(Object.keys(geometry)).toHaveLength(43);
    for (const symbol of ibmSymbols)
      expect(geometry[symbol.id]).toEqual({
        label: symbol.label,
        category: symbol.category,
        outlinePath: symbol.outlinePath,
        detailPaths: symbol.detailPaths,
        ...ibmSymbolSize(symbol.id),
      });
  });

  it('makes historical/revised and drawn/executable distinctions discoverable in local help search', () => {
    const searchable = `${guide}\n${Object.values(geometry)
      .map((symbol) => (symbol as { label: string }).label)
      .join('\n')}`;
    for (const term of [
      'Magnetic Drum',
      'Predefined Process',
      'Manual Input',
      'Collate',
      'Sort',
      'Core',
      'Offpage Connector',
      '25 apertures',
      '26',
      'original',
      'Process Simulator fork/join',
      'batch-control',
      'symbolLabels',
    ])
      expect(searchable).toContain(term);
    expect(file('hugo/content/help/_index.md')).toContain('/help/flowchart-symbols/');
    expect(file('scripts/audit-static.mjs')).toContain("'flowchart-symbols'");
  });
});
