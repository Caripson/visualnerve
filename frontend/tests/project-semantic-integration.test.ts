import { expect, it } from 'vitest';
import { parseCode } from '../src/code/analyzer';
import { attachProjectAnalysis } from '../src/code/project/analysis';
import { getCodeAnalysis, getProjectDirectory } from '../src/code/schema';
import { diagramSourceEvidence } from '../src/questions/source';
import { overviewGrouping } from '../src/overview/grouping';
import { projectCanonicalOverview } from '../src/overview/projection';
import { defaultOverview, setOverviewConfig } from '../src/overview/types';
import { applicationSpecification } from '../src/export/build-specification';
import { buildLovablePrompt } from '../src/export/lovable';
import { newNode } from '../src/model/types';

function projectGraph() {
  return attachProjectAnalysis(
    parseCode({
      mode: 'folders',
      files: [
        { path: 'README.md', content: '[Guide](docs/guide.md)' },
        { path: 'docs/guide.md', content: '# Guide\n[Main](../src/main.ts)' },
        {
          path: 'src/main.ts',
          content: 'import { helper } from "./tools/helper";\nfunction run() { helper(); }',
        },
        { path: 'src/tools/helper.ts', content: 'export function helper() {}' },
      ],
    }),
    {
      name: 'project.zip',
      expandedBytes: 1000,
      ignored: {
        total: 1,
        reasons: {
          dependency: 1,
          build: 0,
          vcs: 0,
          private: 0,
          binary: 0,
          generated: 0,
          unsupported: 0,
          directory: 0,
        },
      },
    },
  ).graph;
}

it('exposes validated directory context and scan provenance through source evidence without arbitrary metadata', async () => {
  const graph = projectGraph();
  const folder = graph.nodes.find((node) => getProjectDirectory(node)?.path === 'src')!;
  folder.metadata.privateImportedPayload = 'MUST_NOT_EXPORT';
  graph.diagram.metadata.privateImportedPayload = 'MUST_NOT_EXPORT';
  const before = JSON.stringify(graph);
  const evidence = await diagramSourceEvidence(graph, new URLSearchParams({ nodeId: folder.id }));
  expect(evidence).toMatchObject({
    nodeId: folder.id,
    projectDirectory: { version: 1, path: 'src', fileCount: 2, languages: ['typescript'] },
    codeAnalysis: {
      mode: 'folders',
      directoryCount: 4,
      project: { name: 'project.zip', ignoredEntries: 1 },
    },
  });
  expect(evidence.codeAnalysis).toEqual(getCodeAnalysis(graph));
  expect(evidence.code).toBeUndefined();
  expect(JSON.stringify(evidence)).not.toContain('MUST_NOT_EXPORT');
  expect(JSON.stringify(graph)).toBe(before);
});

it('retains existing file evidence and exposes the same project analysis for code-file views', async () => {
  const graph = parseCode({ files: [{ path: 'app.py', content: 'def run(): pass' }] }).graph;
  const file = graph.nodes.find(
    (node) =>
      node.metadata.codeObject && (node.metadata.codeObject as { kind: string }).kind === 'file',
  )!;
  const evidence = await diagramSourceEvidence(graph, new URLSearchParams({ nodeId: file.id }));
  expect(evidence.code).toMatchObject({ language: 'python', kind: 'file', path: 'app.py' });
  expect(evidence.projectDirectory).toBeUndefined();
  expect(evidence.codeAnalysis).toEqual(getCodeAnalysis(graph));
});

it('ignores malformed folder source metadata rather than exposing arbitrary imported values as evidence', async () => {
  const graph = projectGraph();
  const folder = graph.nodes[0];
  folder.metadata.projectDirectory = {
    version: 1,
    path: '.',
    fileCount: 4,
    languages: ['typescript'],
    rawSource: 'MUST_NOT_EXPORT',
  };
  const evidence = await diagramSourceEvidence(graph, new URLSearchParams({ nodeId: folder.id }));
  expect(evidence.projectDirectory).toBeUndefined();
  expect(evidence.codeAnalysis).toBeUndefined();
  expect(JSON.stringify(evidence)).not.toContain('MUST_NOT_EXPORT');
});

it('groups folder overviews by real source paths independent of edited card titles and layout', () => {
  const graph = projectGraph();
  const folder = graph.nodes.find((node) => getProjectDirectory(node)?.path === 'src/tools')!;
  const expected = [
    { key: 'project-folders', label: 'Project folders', reason: 'source' },
    { key: 'folder:src', label: 'src', reason: 'source' },
    { key: 'folder:src/tools', label: 'tools', reason: 'source' },
  ];
  expect(overviewGrouping(graph, 'source')(folder)).toEqual(expected);
  expect(
    overviewGrouping(graph, 'auto')({ ...folder, title: 'Utilities', x: 10000, y: -4000 }),
  ).toEqual(expected);
  const before = JSON.stringify(graph);
  const enabled = setOverviewConfig(graph, {
    ...defaultOverview(),
    enabled: true,
    grouping: 'source',
  });
  const overview = projectCanonicalOverview(enabled, { zoom: 0.1 });
  expect(overview.groups.every((group) => group.reason === 'source')).toBe(true);
  expect(Object.keys(overview.nodeMap)).toHaveLength(graph.nodes.length);
  expect(overview.counts.originalNodes).toBe(graph.nodes.length);
  expect(JSON.stringify(graph)).toBe(before);
});

it('bounds deeply nested source grouping and clearly identifies the root as a directory', () => {
  const graph = projectGraph();
  const root = graph.nodes.find((node) => getProjectDirectory(node)?.path === '.')!;
  expect(overviewGrouping(graph, 'source')(root).map((part) => part.label)).toEqual([
    'Project folders',
    'Project root',
  ]);
  const nested = {
    ...root,
    metadata: {
      projectDirectory: {
        version: 1,
        path: 'a/b/c/d/e/f/g/h',
        fileCount: 1,
        languages: ['typescript'],
      },
    },
  };
  expect(overviewGrouping(graph, 'source')(nested).map((part) => part.key)).toEqual([
    'project-folders',
    'folder:a',
    'folder:a/b',
    'folder:a/b/c',
    'folder:a/b/c/d',
  ]);
});

it('keeps a folder description as static project context instead of inventing app acceptance criteria', () => {
  const graph = projectGraph();
  const folder = graph.nodes.find((node) => getProjectDirectory(node)?.path === 'src')!;
  folder.description = 'Architectural documentation for the internal source directory.';
  const manual = newNode(graph.diagram.id, {
    title: 'Notify customer',
    description: 'Send a confirmation after completion.',
  });
  graph.nodes.push(manual);
  const specification = applicationSpecification(graph, { scope: 'diagram' });
  expect(specification.sections.acceptanceCriteria).not.toContain(folder.description);
  expect(specification.sections.acceptanceCriteria).toContain(manual.description);
  const prompt = buildLovablePrompt(graph, '', { scope: 'diagram' });
  expect(prompt.text).toContain(folder.description);
  expect(prompt.text).toContain('projectDirectory');
  expect(prompt.text).toContain('bounded static outline');
});
