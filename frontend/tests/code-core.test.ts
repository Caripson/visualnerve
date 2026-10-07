import { describe, expect, it } from 'vitest';
import { parseCode } from '../src/code/analyzer';
import { validateGraph } from '../src/model/validation';
import { getCodeObject, getCodeRelation } from '../src/code/schema';
import { normalizeCodeInput } from '../src/code/input';
import { codeLimits, type CodeFile } from '../src/code/types';

const fixture: CodeFile[] = [
  {
    path: 'src/main.ts',
    content: 'import { helper } from "./utils";\nexport function run() { helper(); }',
  },
  { path: 'src/utils.ts', content: 'export function helper() { return 1; }' },
];
const relation = (
  result: ReturnType<typeof parseCode>,
  source: string,
  target: string,
  kind: string,
) =>
  result.graph.edges.find(
    (edge) =>
      getCodeObject(result.graph.nodes.find((node) => node.id === edge.sourceNodeId)!)?.name ===
        source &&
      getCodeObject(result.graph.nodes.find((node) => node.id === edge.targetNodeId)!)?.name ===
        target &&
      getCodeRelation(edge)?.kind === kind,
  );

describe('Code graph assembly and bounded local resolution', () => {
  it('resolves a cross-file imported function with real graph connections', () => {
    const result = parseCode({ name: 'Project', files: fixture, mode: 'symbols' });
    expect(result).toMatchObject({
      version: 1,
      fileCount: 2,
      symbolCount: 2,
      dependencyCount: 2,
      unresolvedCount: 0,
    });
    expect(relation(result, 'run', 'helper', 'calls')).toBeDefined();
    expect(relation(result, 'src/main.ts', 'src/utils.ts', 'imports')).toBeDefined();
    expect(() => validateGraph(result.graph)).not.toThrow();
  });
  it('shows a compact file overview with declarations and resolved file dependencies', () => {
    const result = parseCode({ files: fixture });
    expect(result.mode).toBe('files');
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes[0].metadata.codeObject).toMatchObject({ summary: ['run'] });
    expect(result.graph.edges.some((edge) => getCodeRelation(edge)?.kind === 'calls')).toBe(true);
  });
  it('defaults a single source to connected declarations while retaining explicit file overview', () => {
    const files = [
      { path: 'app.js', content: 'function helper() {}\nfunction run() { helper(); }' },
    ];
    const detailed = parseCode({ files });
    expect(detailed.mode).toBe('symbols');
    expect(detailed.graph.nodes).toHaveLength(3);
    expect(relation(detailed, 'run', 'helper', 'calls')).toBeDefined();
    expect(detailed.graph.diagram.metadata.codeAnalysis).toMatchObject({ mode: 'symbols' });
    const overview = parseCode({ files, mode: 'files' });
    expect(overview.mode).toBe('files');
    expect(overview.graph.nodes).toHaveLength(1);
    expect(getCodeObject(overview.graph.nodes[0])?.summary).toEqual(['helper', 'run']);
  });
  it('keeps duplicate method names unresolved without picking an arbitrary target', () => {
    const result = parseCode({
      files: [
        {
          path: 'app.py',
          content:
            'class A:\n def work(self):\n  pass\nclass B:\n def work(self):\n  pass\ndef run():\n work()',
        },
      ],
      mode: 'symbols',
    });
    expect(result.unresolvedCount).toBe(1);
    expect(relation(result, 'run', 'work', 'calls')?.style).toBe('dashed');
    expect(result.graph.nodes.filter((node) => getCodeObject(node)?.external)).toHaveLength(1);
  });
  it('resolves self methods inside their class and retains recursive self-loops', () => {
    const result = parseCode({
      files: [
        {
          path: 'app.py',
          content: 'class A:\n def work(self):\n  self.work()\nclass B:\n def work(self):\n  pass',
        },
      ],
      mode: 'symbols',
    });
    expect(result.unresolvedCount).toBe(0);
    const loop = result.graph.edges.find((edge) => edge.sourceNodeId === edge.targetNodeId);
    expect(getCodeRelation(loop!)?.kind).toBe('calls');
  });
  it('resolves case-insensitive VB calls without changing the shown identifier', () => {
    const result = parseCode({
      files: [{ path: 'App.vb', content: 'Sub Helper()\nEnd Sub\nSub Run()\n HELPER()\nEnd Sub' }],
      mode: 'symbols',
    });
    expect(result.unresolvedCount).toBe(0);
    expect(relation(result, 'Run', 'Helper', 'calls')).toBeDefined();
  });
  it('matches declarations beyond the filecard summary and bounds symbol focus to one hop', () => {
    const content = Array.from({ length: 301 }, (_, index) => `function action${index}() {}`).join(
      '\n',
    );
    const files = [{ path: 'app.js', content }];
    expect(parseCode({ files, mode: 'files', focus: 'action300' }).graph.nodes).toHaveLength(1);
    const result = parseCode({ files, mode: 'symbols', focus: 'action300' });
    expect(result.graph.nodes.map((node) => getCodeObject(node)?.name)).toEqual([
      'app.js',
      'action300',
    ]);
  });
  it('retains identifiers and evidence, discarding source, comments and literal values', () => {
    const result = parseCode({
      files: [
        {
          path: 'app.js',
          content:
            '// SECRET_COMMENT\nfunction helper() {}\nfunction run() { const token="SECRET_TOKEN"; helper(); }',
        },
      ],
      mode: 'symbols',
    });
    const serialized = JSON.stringify(result.graph);
    expect(serialized).not.toContain('SECRET_COMMENT');
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('function helper()');
    expect(result.graph.edges.some((edge) => getCodeRelation(edge)?.evidence?.line === 3)).toBe(
      true,
    );
  });
  it.each([
    '../app.py',
    '/app.py',
    'C:\\app.py',
    'src//app.py',
    'src/./app.py',
    'src/../app.py',
    'app\u0000.py',
  ])('rejects unsafe or ambiguous input path %s', (path) => {
    expect(() => parseCode({ files: [{ path, content: 'def run(): pass' }] })).toThrow(/relative/);
  });
  it('rejects duplicate paths after separator normalization and ambiguous extensions', () => {
    expect(() =>
      parseCode({
        files: [
          { path: 'src\\app.py', content: '' },
          { path: 'src/app.py', content: '' },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() => parseCode({ files: [{ path: 'app.m', content: 'function helper()' }] })).toThrow(
      /Choose/,
    );
    expect(
      parseCode({ files: [{ path: 'app.m', content: 'function helper()', language: 'matlab' }] })
        .symbolCount,
    ).toBe(1);
  });
  it('rejects nonempty options, excess line counts and generated minified lines', () => {
    expect(() => normalizeCodeInput({ files: fixture, name: ' ' })).toThrow();
    expect(() => normalizeCodeInput({ files: fixture, focus: '' })).toThrow();
    expect(() =>
      normalizeCodeInput({ files: [{ path: 'app.py', content: '\n'.repeat(codeLimits.lines) }] }),
    ).toThrow(/100,000 lines/);
    expect(() =>
      normalizeCodeInput({
        files: [{ path: 'app.js', content: 'x'.repeat(codeLimits.lineLength + 1) }],
      }),
    ).toThrow(/20,000/);
  });
  it('analyzes a large syntactic project with bounded indexed resolution', () => {
    const content = Array.from(
      { length: 2000 },
      (_, index) => `function f${index}() { ${index ? `f${index - 1}();` : ''} }`,
    ).join('\n');
    const result = parseCode({ files: [{ path: 'large.js', content }], mode: 'files' });
    expect(result.symbolCount).toBe(2000);
    expect(result.dependencyCount).toBe(1999);
    expect(result.unresolvedCount).toBe(0);
    expect(result.graph.nodes).toHaveLength(1);
  });
});

describe('Explicit imports and package boundaries', () => {
  it.each([
    [
      { path: 'main.py', content: 'from utils import clean as sanitize\ndef run():\n sanitize()' },
      { path: 'utils.py', content: 'def clean():\n pass' },
    ],
    [
      {
        path: 'main.ts',
        content: 'import { helper as prepare } from "./utils";\nfunction run() { prepare(); }',
      },
      { path: 'utils.ts', content: 'export function helper() {}' },
    ],
    [
      {
        path: 'main.ts',
        content: 'import * as tools from "./utils";\nfunction run() { tools.helper(); }',
      },
      { path: 'utils.ts', content: 'export function helper() {}' },
    ],
  ] as CodeFile[][])(
    'binds a syntactic import alias to its actual unique declaration',
    (...files) => {
      const result = parseCode({ files, mode: 'symbols' });
      expect(result.unresolvedCount).toBe(0);
      expect(
        result.graph.edges.some(
          (edge) =>
            getCodeRelation(edge)?.kind === 'calls' &&
            !getCodeObject(result.graph.nodes.find((node) => node.id === edge.targetNodeId)!)
              ?.external,
        ),
      ).toBe(true);
    },
  );
  it('keeps a bare JavaScript package external despite an unrelated same-named file', () => {
    const result = parseCode({
      files: [
        { path: 'app.ts', content: 'import React from "react";\nfunction render() {}' },
        { path: 'src/react.ts', content: 'function unrelated() {}' },
      ],
    });
    expect(result.unresolvedCount).toBe(1);
    const imported = result.graph.edges.find((edge) => getCodeRelation(edge)?.kind === 'imports')!;
    expect(
      getCodeObject(result.graph.nodes.find((node) => node.id === imported.targetNodeId)!)
        ?.external,
    ).toBe(true);
  });
});

it('resolves quoted import paths with spaces and Unicode as structural file identifiers', () => {
  const result = parseCode({
    files: [
      {
        path: 'main.ts',
        content: 'import { helper } from "./kund data/åtgärd";\nfunction run() { helper(); }',
      },
      { path: 'kund data/åtgärd.ts', content: 'export function helper() {}' },
    ],
    mode: 'symbols',
  });
  expect(result.unresolvedCount).toBe(0);
  expect(relation(result, 'run', 'helper', 'calls')).toBeDefined();
  expect(() =>
    normalizeCodeInput({ files: [{ path: ' ', content: '', language: 'python' }] }),
  ).toThrow(/relative/);
});

it('omits URL import literals and credentials even when the import has named aliases', () => {
  const result = parseCode({
    files: [
      {
        path: 'app.ts',
        content:
          'import { helper as prepare } from "https://user:FAKE_SECRET_VALUE@example.com/util.js";\nfunction run() { prepare(); }',
      },
    ],
    mode: 'symbols',
  });
  expect(JSON.stringify(result.graph)).not.toContain('FAKE_SECRET_VALUE');
});

it('rejects an over-limit project across individually permitted files', () => {
  const content = Array.from({ length: 6000 }, (_, index) => `function f${index}() {}`).join('\n');
  expect(() =>
    parseCode({
      files: [
        { path: 'first.js', content },
        { path: 'second.js', content },
      ],
    }),
  ).toThrow(/10,000 declarations/);
});
