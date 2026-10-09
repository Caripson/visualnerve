import { describe, expect, it } from 'vitest';
import { APP_LOCALES, type AppLocale } from '../src/i18n';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { MessageFormatter } from '../src/i18n/message-formatter';
import { canvasNodeAriaLabel } from '../src/canvas/aria-labels';
import { projectGraph, type NodeData, type RenderCache } from '../src/canvas/projection';
import { blankGraph, emptyFilters, newEdge, newNode, type GraphNode } from '../src/model/types';

const catalogs = new LocaleCatalogLoader();
async function formatter(locale: AppLocale) {
  return new MessageFormatter(locale, await catalogs.load(locale));
}

function document() {
  const graph = blankGraph('Authored document — untouched', 'flowchart');
  graph.diagram.settings.viewport = { x: 43, y: -92, zoom: 0.7 };
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Invoice Å — 請求書 {title}',
      nodeType: 'process',
      x: 50,
      y: 70,
    }),
    newNode(graph.diagram.id, {
      title: 'My shared counter',
      nodeType: 'process',
      x: 350,
      y: 70,
      metadata: { simulationProjected: true },
    }),
    newNode(graph.diagram.id, {
      title: 'My subprocess group',
      nodeType: 'group',
      x: 650,
      y: 70,
      metadata: { simulationProcessId: 'authored-process-id', simulationProjected: true },
    }),
  ];
  graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id)];
  return graph;
}

describe('localized ephemeral canvas node accessibility', () => {
  it.each(APP_LOCALES.map(({ id }) => id))(
    'localizes guidance in %s while preserving authored titles and unknown kinds',
    async (locale) => {
      const { t } = await formatter(locale);
      const graph = document();
      const original = structuredClone(graph);
      const [ordinary, shared, processGroup] = graph.nodes;
      expect(canvasNodeAriaLabel(t, ordinary)).toBe(
        t('editor.canvas.accessibility.objectLabel', {
          title: ordinary.title,
          kind: t('editor.nodes.typeLabel.process'),
        }),
      );
      expect(canvasNodeAriaLabel(t, shared)).toBe(
        t('editor.canvas.accessibility.sharedProcessLabel', {
          title: shared.title,
          kind: t('editor.nodes.typeLabel.process'),
        }),
      );
      expect(canvasNodeAriaLabel(t, processGroup)).toBe(
        t('editor.canvas.accessibility.processGroupLabel', { title: processGroup.title }),
      );
      for (const node of graph.nodes) expect(canvasNodeAriaLabel(t, node)).toContain(node.title);
      for (const unknown of ['Authored domain kind', 'constructor', '__proto__'])
        expect(canvasNodeAriaLabel(t, { ...ordinary, nodeType: unknown })).toBe(
          t('editor.canvas.accessibility.objectLabel', { title: ordinary.title, kind: unknown }),
        );
      expect(graph).toEqual(original);
    },
  );

  it('invalidates only cached canvas labels after a locale change, reusing model data and geometry', async () => {
    const graph = document();
    const original = structuredClone(graph);
    const nodes = graph.nodes;
    const edges = graph.edges;
    const viewport = graph.diagram.settings.viewport;
    const data = new Map<string, NodeData>();
    const cache: RenderCache = { nodes: new Map(), edges: new Map() };
    const project = (label: (node: GraphNode) => string) =>
      projectGraph(
        graph,
        [],
        [],
        [],
        emptyFilters,
        false,
        undefined,
        data,
        cache,
        undefined,
        undefined,
        label,
      );
    const english = await formatter('en');
    const englishLabel = (node: GraphNode) => canvasNodeAriaLabel(english.t, node);
    const before = project(englishLabel);
    const same = project(englishLabel);
    before.nodes.forEach((node, index) => expect(same.nodes[index]).toBe(node));
    const french = await formatter('fr');
    const frenchLabel = (node: GraphNode) => canvasNodeAriaLabel(french.t, node);
    const changed = project(frenchLabel);
    changed.nodes.forEach((node, index) => {
      expect(node.ariaLabel).toBe(frenchLabel(graph.nodes[index]));
      expect(node.ariaLabel).not.toBe(before.nodes[index].ariaLabel);
      expect(node).not.toBe(before.nodes[index]);
      expect(node.data).toBe(before.nodes[index].data);
      expect(node.data.node).toBe(graph.nodes[index]);
      expect(node.position).toEqual(before.nodes[index].position);
      expect(node.measured).toEqual(before.nodes[index].measured);
      expect(node.width).toBe(before.nodes[index].width);
      expect(node.height).toBe(before.nodes[index].height);
      expect(node.id).toBe(before.nodes[index].id);
    });
    expect(changed.edges[0]).toBe(before.edges[0]);
    const equivalent = project((node) => frenchLabel(node));
    changed.nodes.forEach((node, index) => expect(equivalent.nodes[index]).toBe(node));
    expect(graph.nodes).toBe(nodes);
    expect(graph.edges).toBe(edges);
    expect(graph.diagram.settings.viewport).toBe(viewport);
    expect(graph).toEqual(original);
  });

  it('preserves exact default projection and export guidance when no display callback is supplied', () => {
    const graph = document();
    const expected = [
      `${graph.nodes[0].title}, process`,
      `${graph.nodes[1].title}, process. Open shared process properties`,
      `${graph.nodes[2].title}, process group. Open to inspect subprocesses`,
    ];
    expect(projectGraph(graph, []).nodes.map((node) => node.ariaLabel)).toEqual(expected);
    expect(
      projectGraph(graph, [], [], [], emptyFilters, true).nodes.map((node) => node.ariaLabel),
    ).toEqual(expected);
  });
});
