import { describe, expect, it } from 'vitest';
import { parseCode } from '../src/code/analyzer';
import { detectCodeLanguage, detectProjectLanguage, supportedCodeFile } from '../src/code/catalog';
import { extractMarkdown } from '../src/code/markdown';
import {
  getCodeAnalysis,
  getCodeObject,
  getCodeRelation,
  getProjectDirectory,
  validateCodeGraph,
} from '../src/code/schema';
import { validateGraph } from '../src/model/validation';
import type { CodeFile } from '../src/code/types';

const files: CodeFile[] = [
  {
    path: 'README.md',
    content: '# Project\n[Guide](docs/getting%20started.md#installation)\n[Code](src/main.ts#L1)',
  },
  {
    path: 'docs/getting started.md',
    content:
      '# Installation\n[Main](../src/main.ts)\n[[Operations#setup]]\n[Missing](missing.md#configuration)',
  },
  {
    path: 'docs/Operations.markdown',
    content: '# Setup\n[Main](../src/main.ts)\n[Broken anchor](getting%20started.md#not-a-section)',
  },
  {
    path: 'src/main.ts',
    content: 'import { helper } from "./lib/helper";\nexport function run() { helper(); }',
  },
  { path: 'src/lib/helper.ts', content: 'export function helper() {}' },
];

describe('Conservative content-aware project identification', () => {
  it.each([
    ['README.md', '# Documentation', 'markdown'],
    ['notes.MARKDOWN', '# Documentation', 'markdown'],
    ['calculate.m', 'function y = run(x)\n y = x;\nend', 'matlab'],
    ['query.m', 'let\n Source = Table.FromRows({})\nin Source', 'powerquery'],
    ['object.m', '#import <Foundation/Foundation.h>\n@implementation App\n@end', 'objective-c'],
    ['object.h', '@interface App : NSObject\n@end', 'objective-c'],
    ['math.h', 'template <typename T> class Math { };', 'cpp'],
    ['atomic.h', '_Atomic int state;', 'c'],
    ['Class.cls', 'Attribute VB_Name = "Class"\nPublic Sub Run()\nEnd Sub', 'vba'],
    ['App.cls', 'public with sharing class App { }', 'apex'],
    ['bin/run', '#!/usr/bin/env -S python3 -u\ndef run(): pass', 'python'],
    ['bin/start', '#!/bin/bash\nsource ./env.sh', 'shell'],
    ['bin/render', '#!/usr/bin/env node\nfunction run() {}', 'javascript'],
  ])(
    'identifies %s from supported extension or distinctive structure',
    (path, content, language) => {
      expect(detectProjectLanguage(path, content)).toBe(language);
    },
  );
  it.each([
    ['ambiguous.h', 'int process(int x);'],
    ['ambiguous.m', 'value = 1;'],
    ['ambiguous.cls', 'class Something'],
    ['unknown', 'function run() {}'],
    ['comment.h', '// class Fake { };\nint process();'],
    ['conflicting.h', 'namespace App { }\n_Atomic int state;'],
  ])('leaves %s unresolved for explicit user language selection', (path, content) => {
    expect(detectProjectLanguage(path, content)).toBeUndefined();
  });
  it('preserves extension-only ambiguity discovery and known source language choices', () => {
    expect(detectCodeLanguage('ambiguous.m')).toBeUndefined();
    expect(supportedCodeFile('ambiguous.m')).toBe(true);
    expect(supportedCodeFile('notes.md')).toBe(true);
    const result = parseCode({
      files: [{ path: 'ambiguous.h', content: 'int run();', language: 'c' }],
    });
    expect(result.languages).toEqual(['c']);
  });
});

describe('Markdown project relationships', () => {
  it('connects relative, reference and wiki links with anchors and encoded paths', () => {
    const result = parseCode({ files, mode: 'files' });
    const targetNames = result.graph.edges
      .filter((edge) => getCodeRelation(edge)?.kind === 'references')
      .map(
        (edge) =>
          getCodeObject(result.graph.nodes.find((node) => node.id === edge.targetNodeId)!)?.name,
      );
    expect(targetNames).toContain('docs/getting started.md');
    expect(targetNames).toContain('docs/Operations.markdown');
    expect(targetNames).toContain('src/main.ts');
    expect(result.unresolvedCount).toBe(2);
    const unresolved = result.graph.nodes.filter((node) => getCodeObject(node)?.external);
    expect(unresolved.map((node) => getCodeObject(node)?.name)).toEqual([
      'missing.md#configuration',
      'getting%20started.md#not-a-section',
    ]);
    expect(result.graph.edges.filter((edge) => edge.style === 'dashed')).toHaveLength(2);
    expect(() => validateGraph(result.graph)).not.toThrow();
  });
  it('extracts used references, escaped balanced destinations and wiki aliases without prose', () => {
    const extracted = extractMarkdown(
      '[Readable prose][guide]\n[guide][]\n[guide]\n[guide]: <docs/read me.md#setup> "Secret title"\n[unused]: unused.md\n[API](api(v2).md)\n[[Operations#setup|Secret label]]\n[private](docs/file.md?token=SECRET_TOKEN#section)',
    );
    expect(extracted.dependencies.map((entry) => entry.target)).toEqual([
      'docs/read me.md#setup',
      'docs/read me.md#setup',
      'docs/read me.md#setup',
      'api(v2).md',
      'Operations#setup',
      'docs/file.md#section',
    ]);
    expect(JSON.stringify(extracted)).not.toContain('Secret');
    expect(JSON.stringify(extracted)).not.toContain('SECRET_TOKEN');
    expect(extracted.dependencies.at(-1)?.line).toBe(8);
  });
  it('ignores images, escaped syntax, external URLs, comments and code blocks/spans', () => {
    const content = [
      '![Image](image.md)',
      '![[Image]]',
      '\\[Escaped](escaped.md)',
      '[External](https://user:SECRET@example.com/private.md)',
      '[Email](mailto:user@example.com)',
      '`[Code](inline.md)`',
      '``[Long code](inline2.md)``',
      '<!-- [Hidden](comment.md)',
      '[Hidden2](comment2.md) -->',
      '~~~md',
      '[Example](fenced.md)',
      '~~~',
      '    [Indented](indented.md)',
      '[Actual](real.md)',
    ].join('\n');
    expect(extractMarkdown(content).dependencies.map((entry) => entry.target)).toEqual(['real.md']);
    const result = parseCode({ files: [{ path: 'README.md', content }] });
    expect(JSON.stringify(result.graph)).not.toContain('SECRET');
    expect(JSON.stringify(result.graph)).not.toContain('[Actual]');
  });
  it('resolves duplicate GitHub-style headings, explicit HTML anchors and same-document fragments', () => {
    const result = parseCode({
      files: [
        {
          path: 'guide.md',
          content:
            '# `API` Guide\n# API Guide\n<a id="custom"></a>\n[First](#api-guide)\n[Second](#api-guide-1)\n[Custom](#custom)\n[Missing](#api-guide-2)',
        },
      ],
    });
    expect(result.unresolvedCount).toBe(1);
    expect(
      result.graph.nodes.filter((node) => getCodeObject(node)?.external).map((node) => node.title),
    ).toEqual(['#api-guide-2']);
    expect(result.graph.edges.some((edge) => edge.sourceNodeId === edge.targetNodeId)).toBe(true);
  });
  it('avoids arbitrary wiki resolution and retains traversal/malformed paths for review', () => {
    const result = parseCode({
      files: [
        { path: 'README.md', content: '[[Setup]]\n[Escape](../outside.md)\n[Malformed](%ZZ.md)' },
        { path: 'a/Setup.md', content: '# Setup' },
        { path: 'b/Setup.md', content: '# Setup' },
      ],
    });
    expect(result.unresolvedCount).toBe(3);
  });
  it('keeps percent-encoded wiki directory paths explicit instead of guessing a basename elsewhere', () => {
    const result = parseCode({
      files: [
        { path: 'README.md', content: '[[missing%2FSetup]]\n[[Setup]]' },
        { path: 'elsewhere/Setup.md', content: '# Setup' },
      ],
    });
    expect(result.unresolvedCount).toBe(1);
    expect(
      result.graph.nodes.filter((node) => getCodeObject(node)?.external).map((node) => node.title),
    ).toEqual(['missing%2FSetup']);
    expect(
      result.graph.edges.filter((edge) => getCodeRelation(edge)?.confidence === 'syntax'),
    ).toHaveLength(1);
  });
  it('distinguishes missing relative documents by resolved location while merging references to the same missing target', () => {
    const result = parseCode({
      files: [
        { path: 'a/main.md', content: '[Missing](missing.md)\n[Root](../missing.md)' },
        { path: 'b/main.md', content: '[Missing](missing.md)\n[Root](../missing.md)' },
        { path: 'a/other.md', content: '[Same local](./missing.md)' },
      ],
    });
    const external = result.graph.nodes.filter((node) => getCodeObject(node)?.external);
    expect(result.unresolvedCount).toBe(5);
    expect(external).toHaveLength(3);
    const primaryA = result.graph.nodes.find((node) => getCodeObject(node)?.name === 'a/main.md')!;
    const primaryB = result.graph.nodes.find((node) => getCodeObject(node)?.name === 'b/main.md')!;
    const otherA = result.graph.nodes.find((node) => getCodeObject(node)?.name === 'a/other.md')!;
    const targets = (id: string) =>
      result.graph.edges
        .filter((edge) => edge.sourceNodeId === id)
        .map((edge) => edge.targetNodeId);
    expect(targets(primaryA.id)[0]).not.toBe(targets(primaryB.id)[0]);
    expect(targets(primaryA.id)[1]).toBe(targets(primaryB.id)[1]);
    expect(targets(primaryA.id)[0]).toBe(targets(otherA.id)[0]);
    expect(getCodeObject(external[0])).toMatchObject({ name: 'missing.md', path: 'a/main.md' });
    expect(result.graph.edges.map((edge) => getCodeRelation(edge)?.evidence?.path)).toEqual([
      'a/main.md',
      'a/main.md',
      'b/main.md',
      'b/main.md',
      'a/other.md',
    ]);
  });
  it('bounds unmatched delimiter scans while still finding a valid nested link', () => {
    const malformed = '['.repeat(19_000) + '[Actual](real.md)';
    expect(extractMarkdown(malformed).dependencies.map((entry) => entry.target)).toEqual([
      'real.md',
    ]);
    expect(
      extractMarkdown('('.repeat(19_000) + '\n[Actual](real.md)').dependencies.map(
        (entry) => entry.target,
      ),
    ).toEqual(['real.md']);
  });
  it('ignores frontmatter and encoded URL credentials while retaining source evidence line numbers', () => {
    const result = parseCode({
      files: [
        {
          path: 'README.md',
          content:
            '\uFEFF---\nnotes: "[Private](hidden.md)"\n---\n[External](https%3A%2F%2Fuser%3ASECRET_TOKEN%40example.com%2Fx.md)\n[Actual](real.md)',
        },
      ],
    });
    expect(result.dependencyCount).toBe(1);
    expect(getCodeRelation(result.graph.edges[0])?.evidence?.line).toBe(5);
    expect(JSON.stringify(result.graph)).not.toContain('SECRET_TOKEN');
    expect(JSON.stringify(result.graph)).not.toContain('hidden.md');
  });
  it('resolves directory index and an unambiguous wiki basename without guessing regular links', () => {
    const result = parseCode({
      files: [
        { path: 'README.md', content: '[Docs](docs/)\n[[Operations]]\n[Not relative](Operations)' },
        { path: 'docs/index.md', content: '# Docs' },
        { path: 'runbooks/Operations.md', content: '# Operations' },
      ],
    });
    expect(result.unresolvedCount).toBe(1);
  });
});

describe('Folder overview and semantic project metadata', () => {
  it('creates actual directory objects with descendant counts and aggregated inter-folder dependencies', () => {
    const result = parseCode({ files, mode: 'folders' });
    expect(result).toMatchObject({
      mode: 'folders',
      fileCount: 5,
      directoryCount: 4,
      languages: ['markdown', 'typescript'],
    });
    const directoryNodes = result.graph.nodes.filter((node) => getProjectDirectory(node));
    expect(directoryNodes).toHaveLength(4);
    expect(directoryNodes.every((node) => !getCodeObject(node))).toBe(true);
    expect(directoryNodes.map((node) => getProjectDirectory(node))).toEqual([
      { version: 1, path: '.', fileCount: 5, languages: ['markdown', 'typescript'] },
      { version: 1, path: 'docs', fileCount: 2, languages: ['markdown'] },
      { version: 1, path: 'src', fileCount: 2, languages: ['typescript'] },
      { version: 1, path: 'src/lib', fileCount: 1, languages: ['typescript'] },
    ]);
    const connection = result.graph.edges.find((edge) => {
      const source = result.graph.nodes.find((node) => node.id === edge.sourceNodeId)!;
      const target = result.graph.nodes.find((node) => node.id === edge.targetNodeId)!;
      return (
        getProjectDirectory(source)?.path === 'docs' &&
        getProjectDirectory(target)?.path === 'src' &&
        getCodeRelation(edge)?.kind === 'references'
      );
    })!;
    expect(getCodeRelation(connection)).toMatchObject({
      occurrences: 2,
      confidence: 'syntax',
      evidence: { path: 'docs/getting started.md', line: 2 },
    });
    expect(connection.label).toBe('references (2)');
    expect(result.unresolvedCount).toBe(2);
    expect(() => validateGraph(result.graph)).not.toThrow();
    expect(getCodeAnalysis(result.graph)?.directoryCount).toBe(4);
  });
  it('keeps same-folder file dependencies in Files while hiding redundant folder self loops', () => {
    const input = {
      files: [
        {
          path: 'src/main.ts',
          content: 'import { helper } from "./helper";\nfunction run() { helper(); }',
        },
        { path: 'src/helper.ts', content: 'export function helper() {}' },
      ],
    };
    const overview = parseCode({ ...input, mode: 'folders' });
    expect(overview.dependencyCount).toBe(2);
    expect(overview.graph.edges.map((edge) => getCodeRelation(edge)?.kind)).toEqual(['contains']);
    expect(parseCode({ ...input, mode: 'files' }).graph.edges).toHaveLength(2);
    expect(
      parseCode({ ...input, mode: 'symbols' }).graph.edges.some(
        (edge) => getCodeRelation(edge)?.kind === 'calls',
      ),
    ).toBe(true);
  });
  it('focuses a folder by a file or declaration and includes immediate connected directories', () => {
    const result = parseCode({ files, mode: 'folders', focus: 'helper' });
    const directoryPaths = result.graph.nodes
      .map((node) => getProjectDirectory(node)?.path)
      .filter(Boolean);
    expect(directoryPaths).toEqual(['src', 'src/lib']);
    expect(() => parseCode({ files, mode: 'folders', focus: 'absent' })).toThrow(/Focus/);
  });
  it('round trips bounded provenance and rejects invalid folder/count/currency-independent metadata', () => {
    const graph = parseCode({ files, mode: 'folders' }).graph;
    const analysis = graph.diagram.metadata.codeAnalysis as Record<string, unknown>;
    analysis.project = {
      version: 1,
      name: 'project.zip',
      expandedBytes: 1000,
      ignoredEntries: 3,
      ignoredReasons: { dependency: 2, directory: 1 },
    };
    expect(() => validateGraph(graph)).not.toThrow();
    expect(getCodeAnalysis(JSON.parse(JSON.stringify(graph)))?.project).toEqual(analysis.project);
    analysis.project = {
      version: 1,
      name: 'project.zip',
      expandedBytes: 1000,
      ignoredEntries: 4,
      ignoredReasons: { dependency: 2, directory: 1 },
    };
    expect(() => validateCodeGraph(graph)).toThrow(/analysis/);
    delete analysis.project;
    const node = graph.nodes.find((item) => getProjectDirectory(item))!;
    node.metadata.projectDirectory = {
      version: 1,
      path: '../outside',
      fileCount: 5,
      languages: ['typescript'],
    };
    expect(() => validateCodeGraph(graph)).toThrow(/directory/);
  });
  it('rejects duplicate directory languages and malformed aggregated relationship counts', () => {
    const graph = parseCode({ files, mode: 'folders' }).graph;
    const node = graph.nodes.find((item) => getProjectDirectory(item))!;
    const directory = getProjectDirectory(node)!;
    node.metadata.projectDirectory = { ...directory, languages: ['markdown', 'markdown'] };
    expect(getProjectDirectory(node)).toBeUndefined();
    node.metadata.projectDirectory = directory;
    const edge = graph.edges.find((item) => getCodeRelation(item)?.occurrences)!;
    edge.metadata.codeRelation = { ...getCodeRelation(edge), occurrences: 0 };
    expect(() => validateCodeGraph(graph)).toThrow(/relationship/);
  });
  it('rejects project provenance counts beyond the ZIP archive entry limit', () => {
    const graph = parseCode({ files, mode: 'folders' }).graph;
    (graph.diagram.metadata.codeAnalysis as Record<string, unknown>).project = {
      version: 1,
      name: 'project.zip',
      expandedBytes: 1000,
      ignoredEntries: 10001,
      ignoredReasons: { unsupported: 10001 },
    };
    expect(getCodeAnalysis(graph)).toBeUndefined();
    expect(() => validateCodeGraph(graph)).toThrow(/analysis/);
  });
  it('bounds deeply nested directory materialization before exceeding the canvas object limit', () => {
    const nested = Array.from({ length: 100 }, (_, index) => ({
      path: `project${index}/${'segment/'.repeat(50)}run.py`,
      content: 'def run(): pass',
    }));
    expect(() => parseCode({ files: nested, mode: 'folders' })).toThrow(/5,000 directories/);
  });
});
