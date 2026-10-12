import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instantiate, templates } from '../src/templates/templates';
import { notationTemplates } from '../src/notation/templates';
import { validateGraph } from '../src/model/validation';
import { blankGraph, type Graph, type Diagram, type GraphNode } from '../src/model/types';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { notationCollections } from '../src/notation/registry';
import { notationGeometry } from '../src/notation/geometry';
import { assertMcpAccess } from '../src/integration/access';
import { SvgModelRenderer } from '../src/export/svg-model-renderer';
import { MessageFormatter } from '../src/i18n/message-formatter';
import en from '../src/i18n/catalogs/en';

describe('Notation creation and native exchange', () => {
  it.each(notationTemplates.map((template) => [template.key]))(
    'creates a fresh valid editable %s example',
    (key) => {
      const graph = instantiate(key, 'Editable example'),
        other = instantiate(key, 'Another example');
      validateGraph(graph);
      expect(graph.diagram.notation?.schemaVersion).toBe(1);
      expect(templates.find((template) => template.key === key)?.nodes).toBe(graph.nodes.length);
      expect(graph.nodes.some((node) => !!node.notation)).toBe(true);
      expect(graph.nodes.every((node) => other.nodes.every((copy) => copy.id !== node.id))).toBe(
        true,
      );
      validateGraph(JSON.parse(JSON.stringify(graph)));
      const duplicate = instantiate('blank', 'Duplicate', graph);
      validateGraph(duplicate);
      for (const node of duplicate.nodes)
        for (const id of [node.notation?.attachmentId, node.notation?.relatedNodeId].filter(
          Boolean,
        ))
          expect(duplicate.nodes.some((candidate) => candidate.id === id)).toBe(true);
    },
  );
  it('copies attachments with their hosts and remaps references without changing the original', () => {
    const graph = instantiate('bpmn-process', 'Boundary event');
    const boundary = graph.nodes.find((node) => node.notation?.symbol === 'boundary-event')!;
    const clipboard = copySelection(graph, [boundary.id]);
    expect(clipboard.nodes.some((node) => node.id === boundary.notation?.attachmentId)).toBe(true);
    const pasted = pasteSelection(clipboard, blankGraph('Target'));
    const result = { ...blankGraph('Paste'), ...pasted };
    result.nodes.forEach((node) => (node.diagramId = result.diagram.id));
    result.edges.forEach((edge) => (edge.diagramId = result.diagram.id));
    validateGraph(result);
    const copied = pasted.nodes.find((node) => node.notation?.symbol === 'boundary-event')!;
    expect(copied.notation?.attachmentId).not.toBe(boundary.notation?.attachmentId);
    expect(pasted.nodes.some((node) => node.id === copied.notation?.attachmentId)).toBe(true);
  });
  it.each(notationTemplates.map((template) => [template.key]))(
    'exports %s with its actual vector outlines, sections and connector decorations',
    (key) => {
      const graph = instantiate(key, 'Native SVG');
      const visible = graph.nodes.find(
        (node) => node.notation && notationGeometry(node.notation).titleStyle !== 'hidden',
      )!;
      visible.title = 'Safe <label> & text';
      const result = new SvgModelRenderer({
        measure: (text, size) => text.length * size * 0.55,
      }).render(
        {
          graph,
          locale: 'en',
          viewportSize: { width: 1000, height: 700 },
          options: {},
          theme: {
            background: '#ffffff',
            node: '#ffffff',
            surface: '#ffffff',
            text: '#182c25',
            muted: '#56675d',
            border: '#e2e5df',
            doneBackground: '#dcfce7',
            doneText: '#075b2c',
            doneBorder: '#16803d',
          },
        },
        new MessageFormatter('en', en),
      );
      const document = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
      expect(document.querySelector('parsererror')).toBeNull();
      expect(document.querySelectorAll('[data-notation-outline]')).toHaveLength(
        graph.nodes.filter((node) => node.notation).length,
      );
      expect(document.querySelector('foreignObject,image,script')).toBeNull();
      expect(document.querySelector('title')?.textContent).toBe('Native SVG');
      expect(result.svg).not.toMatch(/NaN|Infinity/);
      expect(
        [...document.querySelectorAll('text')]
          .map((node) => node.textContent)
          .join('')
          .replace(/\s+/g, ''),
      ).toContain('Safe<label>&text');
      expect(document.querySelector(`[data-node-id="${visible.id}"] title`)?.textContent).toBe(
        'Safe <label> & text',
      );
    },
  );
});

describe('One authoritative UI/API notation model', () => {
  let database: WorkspaceDatabase, repository: Repository;
  beforeEach(async () => {
    database = new WorkspaceDatabase(`notation-api-${crypto.randomUUID()}`);
    await database.initialize();
    repository = new Repository(database);
  });
  afterEach(async () => {
    await database.delete();
  });
  it('discovers public collections and returns independent metadata copies', async () => {
    const catalogs = await repository.request<typeof notationCollections>('/notation/collections');
    expect(catalogs).toEqual(notationCollections);
    expect(catalogs).toHaveLength(5);
    const detail = await repository.request<{
      schemaVersion: number;
      symbols: unknown[];
      connectors: unknown[];
    }>('/notation/collections/uml');
    expect(detail.schemaVersion).toBe(1);
    expect(detail.symbols.length).toBeGreaterThan(30);
    expect(detail.connectors.length).toBeGreaterThan(15);
    await expect(repository.request('/notation/collections/unknown')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      repository.request('/notation/collections/uml/symbols', 'POST'),
    ).rejects.toMatchObject({ status: 405 });
  });
  it('creates through documented template keys and preserves semantic edits after reopening', async () => {
    const diagram = await repository.request<Diagram>('/diagrams', 'POST', {
      name: 'Assembly contract',
      template: 'uml-class',
    });
    const graph = await repository.getGraph(diagram.id);
    expect(graph.diagram.notation).toMatchObject({ collection: 'uml', diagramKind: 'class' });
    const node = graph.nodes.find((node) => node.notation?.symbol === 'class')!;
    const edited = await repository.request<GraphNode>(`/nodes/${node.id}`, 'PATCH', {
      version: node.version,
      notation: {
        ...node.notation,
        compartments: [{ id: 'operations', title: 'Operations', lines: ['+ run(): Result'] }],
      },
    });
    expect(
      (await repository.getGraph(diagram.id)).nodes.find((node) => node.id === edited.id)?.notation,
    ).toEqual(edited.notation);
    const preserved = await repository.request<GraphNode>(`/nodes/${edited.id}`, 'PATCH', {
      version: edited.version,
      x: 420,
    });
    expect(preserved.notation).toEqual(edited.notation);
    await expect(
      repository.request(`/nodes/${edited.id}`, 'PATCH', {
        version: preserved.version,
        notation: { collection: 'uml', symbol: 'nonexistent' },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      (await repository.getGraph(diagram.id)).nodes.find((node) => node.id === edited.id)?.notation,
    ).toEqual(edited.notation);
    const report = await repository.request<{
      diagramId: string;
      baseVersion: number;
      issues: unknown[];
    }>(`/diagrams/${diagram.id}/notation/validate`, 'POST', {});
    expect(report.diagramId).toBe(diagram.id);
    expect(Array.isArray(report.issues)).toBe(true);
    expect(() =>
      assertMcpAccess('read', `/diagrams/${diagram.id}/notation/validate`, 'POST'),
    ).not.toThrow();
    expect(() => assertMcpAccess('read', `/nodes/${node.id}`, 'PATCH')).toThrow();
    expect(() => assertMcpAccess('off', '/notation/collections', 'GET')).toThrow();
  });
  it('native reimport remaps internal references and preserves profile/sections', async () => {
    const original = await repository.saveGraph(instantiate('uml-sequence', 'Native sequence'), 0);
    const imported = await repository.importGraph(JSON.parse(JSON.stringify(original)) as Graph);
    expect(imported.diagram.id).not.toBe(original.diagram.id);
    expect(imported.diagram.notation).toEqual(original.diagram.notation);
    validateGraph(imported);
    for (const node of imported.nodes)
      if (node.notation?.relatedNodeId)
        expect(
          imported.nodes.some((candidate) => candidate.id === node.notation?.relatedNodeId),
        ).toBe(true);
  });
});
