import { describe, expect, it } from 'vitest';
import {
  ibmSymbols,
  ibmSymbolIds,
  getIbmSymbol,
  ibmStencilForms,
} from '../src/flowchart/ibm-symbols';
import { blankGraph, newNode } from '../src/model/types';
import { validateGraph, validateGraphFields } from '../src/model/validation';
import { instantiate, templates } from '../src/templates/templates';
import { SvgModelRenderer } from '../src/export/svg-model-renderer';
import { MessageFormatter } from '../src/i18n/message-formatter';
import en from '../src/i18n/catalogs/en';
import type { SvgWorkerRequest } from '../src/export/svg-job-types';

const svgRequest = (graph: ReturnType<typeof blankGraph>): SvgWorkerRequest => ({
  graph,
  options: {},
  locale: 'en',
  viewportSize: { width: 800, height: 600 },
  theme: {
    background: '#fafaf7',
    node: '#ffffff',
    surface: '#fdfdfb',
    text: '#1f2d28',
    muted: '#56675d',
    border: '#e2e5df',
    doneBackground: '#dcfce7',
    doneText: '#075b2c',
    doneBorder: '#16803d',
  },
});

describe('IBM GX20-8020 flowchart symbols', () => {
  it('covers all 26 physical apertures and all 32 completed sleeve symbols', () => {
    expect(ibmSymbols).toHaveLength(43);
    expect(ibmSymbols.filter((symbol) => symbol.physicalCutout)).toHaveLength(26);
    expect(ibmSymbols.filter((symbol) => symbol.category === 'symbol')).toHaveLength(32);
    expect(ibmSymbols.filter((symbol) => symbol.category === 'outline')).toHaveLength(2);
    expect(ibmSymbols.filter((symbol) => symbol.category === 'arrowhead')).toHaveLength(4);
    expect(new Set(ibmSymbolIds).size).toBe(43);
    expect(ibmSymbols.filter((symbol) => symbol.category === 'legacy')).toHaveLength(5);
    expect(ibmStencilForms.map((form) => form.physicalCutoutSymbolIds.length)).toEqual([
      25, 26, 26,
    ]);
    for (const form of ibmStencilForms) {
      expect(new Set(form.physicalCutoutSymbolIds).size).toBe(form.physicalCutoutSymbolIds.length);
      for (const id of form.physicalCutoutSymbolIds) {
        expect(getIbmSymbol(id)?.revisions).toContain(form.revision);
        expect(getIbmSymbol(id)?.construction).toBe('cutout');
      }
    }
    for (const symbol of ibmSymbols.filter((item) => item.category === 'legacy')) {
      expect(symbol.revisions).toEqual(['GX20-8020']);
      expect(symbol.construction).toBe('cutout');
      expect(symbol.physicalCutout).toBe(false);
    }
    for (const symbol of ibmSymbols) {
      expect(getIbmSymbol(symbol.id)).toBe(symbol);
      expect(symbol.outline.length).toBeGreaterThanOrEqual(3);
      expect(symbol.outlinePath).toMatch(/^M.+ Z$/);
      expect(symbol.detailPaths.length).toBe(symbol.details.length);
      for (const [x, y] of [...symbol.outline, ...symbol.details.flat()]) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
    expect(getIbmSymbol('ibm-sort')!.details).toHaveLength(1);
    expect(getIbmSymbol('ibm-sort-outline')!.details).toHaveLength(0);
    expect(getIbmSymbol('ibm-magnetic-tape')!.details).toHaveLength(1);
    expect(getIbmSymbol('ibm-magnetic-tape-circle')!.details).toHaveLength(0);
  });

  it('retains the original changed meanings and inverted perforated-tape outline', () => {
    expect(getIbmSymbol('ibm-legacy-input-output')!.outlinePath).toBe(
      getIbmSymbol('ibm-manual-operation')!.outlinePath,
    );
    expect(getIbmSymbol('ibm-legacy-predefined-process')!.outlinePath).toBe(
      getIbmSymbol('ibm-preparation')!.outlinePath,
    );
    expect(getIbmSymbol('ibm-clerical-operation')!.outlinePath).toBe(
      getIbmSymbol('ibm-input-output')!.outlinePath,
    );
    const legacyTape = getIbmSymbol('ibm-perforated-tape')!;
    const revisedTape = getIbmSymbol('ibm-punched-tape')!;
    expect(legacyTape.outlinePath).not.toBe(revisedTape.outlinePath);
    expect(legacyTape.outline).toEqual(revisedTape.outline.map(([x, y]) => [x, 1 - y]));
    expect(getIbmSymbol('ibm-program-modification')!.outline).toContainEqual([1, 0.5]);
  });

  it('round-trips every glyph independently of its existing semantic node kind', () => {
    const graph = blankGraph('IBM persistence');
    graph.nodes = ibmSymbols.map((symbol) =>
      newNode(graph.diagram.id, {
        title: symbol.label,
        nodeType: 'team',
        flowchartSymbol: symbol.id,
      }),
    );
    const imported = JSON.parse(JSON.stringify(graph));
    validateGraph(imported);
    expect(imported.nodes.map((node: { flowchartSymbol: string }) => node.flowchartSymbol)).toEqual(
      ibmSymbolIds,
    );
    expect(imported.nodes.every((node: { nodeType: string }) => node.nodeType === 'team')).toBe(
      true,
    );
    delete imported.nodes[0].flowchartSymbol;
    expect(() => validateGraph(imported)).not.toThrow();
  });

  it.each(['process', 'ibm-unknown', '', null, 42, {}, ['ibm-process']])(
    'rejects unsupported persisted glyph %j before rendering',
    (invalid) => {
      const graph = blankGraph('Strict glyph');
      graph.nodes = [newNode(graph.diagram.id)];
      Object.assign(graph.nodes[0], { flowchartSymbol: invalid });
      expect(() => validateGraphFields(graph)).toThrow('Unsupported IBM flowchart symbol');
      expect(() => validateGraph(graph)).toThrow('Unsupported IBM flowchart symbol');
    },
  );

  it('provides a fresh editable specimen inventory and a connected batch example', () => {
    const graph = instantiate('ibm-flowcharting', 'IBM example');
    const second = instantiate('ibm-flowcharting', 'Another IBM example');
    validateGraph(graph);
    expect(graph.diagram.type).toBe('flowchart');
    expect(graph.nodes).toHaveLength(51);
    expect(new Set(graph.nodes.map((node) => node.flowchartSymbol)).size).toBe(43);
    expect(graph.nodes.filter((node) => node.tags.includes('stencil-cutout'))).toHaveLength(26);
    expect(graph.nodes.filter((node) => node.tags.includes('legacy-symbol'))).toHaveLength(5);
    expect(graph.nodes.filter((node) => node.tags.includes('batch-example'))).toHaveLength(8);
    expect(graph.edges).toHaveLength(8);
    expect(graph.diagram.id).not.toBe(second.diagram.id);
    expect(graph.nodes.every((node) => !second.nodes.some((other) => other.id === node.id))).toBe(
      true,
    );
    expect(templates.find((template) => template.key === 'ibm-flowcharting')?.nodes).toBe(51);
    expect(templates.some((template) => template.key === 'parallel-delivery-simulator')).toBe(
      false,
    );
    expect(() => instantiate('parallel-delivery-simulator', 'Removed')).toThrow('Unknown template');
  });

  it('exports the same outline and detail geometry as native vectors with text and status', () => {
    const graph = instantiate('ibm-flowcharting', 'IBM SVG');
    graph.nodes[0].title = 'Editable <IBM> title';
    graph.nodes[0].color = '#37648d';
    graph.nodes[0].status = 'done';
    const request = svgRequest(graph);
    const result = new SvgModelRenderer({
      measure: (text, size) => text.length * size * 0.55,
    }).render(request, new MessageFormatter('en', en));
    const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('[data-ibm-outline]')).toHaveLength(51);
    for (const symbol of ibmSymbols) {
      const outline = doc.querySelector(`[data-ibm-outline="${symbol.id}"]`)!;
      expect(outline.getAttribute('d')).toBe(symbol.outlinePath);
      const details = [
        ...doc.querySelectorAll(`[data-node-id]:has([data-ibm-outline="${symbol.id}"])`),
      ].map((group) =>
        [...group.querySelectorAll('[data-ibm-detail]')].map((path) => path.getAttribute('d')),
      );
      expect(details[0]).toEqual(symbol.detailPaths);
    }
    expect(doc.querySelector('[data-ibm-outline="ibm-process"]')?.getAttribute('stroke')).toBe(
      '#16803d',
    );
    expect(doc.querySelector('[data-status-icon="done"]')).not.toBeNull();
    expect(
      [...doc.querySelectorAll('text')].map((element) => element.textContent).join(' '),
    ).toContain('Editable <IBM> title');
    expect(doc.querySelector('image,foreignObject,script')).toBeNull();
  });
  it('exports a chosen area icon while preserving IBM silhouettes and restoring the default for unknown icons', () => {
    const graph = blankGraph('IBM SVG custom icons', 'flowchart');
    graph.nodes = ['work', '', 'unknown-icon'].map((icon, index) =>
      newNode(graph.diagram.id, {
        title: 'Custom icon example',
        width: 300,
        height: 200,
        flowchartSymbol: 'ibm-predefined-process',
        x: index * 300,
        metadata: { visualNerve: { icon } },
      }),
    );
    const result = new SvgModelRenderer({
      measure: (text, size) => text.length * size * 0.55,
    }).render(svgRequest(graph), new MessageFormatter('en', en));
    const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    for (const node of graph.nodes) {
      const group = doc.querySelector(`[data-node-id="${node.id}"]`)!;
      expect(group.querySelector('[data-ibm-outline]')?.getAttribute('d')).toBe(
        getIbmSymbol('ibm-predefined-process')!.outlinePath,
      );
      expect(group.querySelectorAll('[data-ibm-detail]')).toHaveLength(2);
    }
    const custom = doc.querySelector(`[data-node-id="${graph.nodes[0].id}"]`)!;
    expect(custom.querySelector('[data-area-icon="work"]')).not.toBeNull();
    expect(custom.querySelector('[data-ibm-icon]')).toBeNull();
    for (const node of graph.nodes.slice(1)) {
      const group = doc.querySelector(`[data-node-id="${node.id}"]`)!;
      expect(group.querySelector('[data-ibm-icon]')).not.toBeNull();
      expect(group.querySelector('[data-area-icon]')).toBeNull();
    }
  });
  it('centers readable titles inside each shape and keeps status separate from the icon', () => {
    const graph = instantiate('ibm-flowcharting', 'IBM layout');
    graph.nodes[0].title = 'Review incoming orders and prepare the weekly dispatch schedule';
    graph.nodes[0].status = 'planned';
    const result = new SvgModelRenderer({
      measure: (text, size) => text.length * size * 0.55,
    }).render(svgRequest(graph), new MessageFormatter('en', en));
    const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    for (const node of graph.nodes) {
      const symbol = getIbmSymbol(node.flowchartSymbol)!;
      const group = doc.querySelector(`[data-node-id="${node.id}"]`)!;
      const lines = [...group.querySelectorAll('[data-ibm-title-line]')];
      const center = (symbol.contentBox.x + symbol.contentBox.width / 2) * node.width;
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) {
        expect(line.getAttribute('text-anchor')).toBe('middle');
        expect(line.getAttribute('font-size')).toBe('14');
        expect(Number(line.getAttribute('x'))).toBeCloseTo(center, 6);
        expect(Number(line.getAttribute('y'))).toBeGreaterThan(symbol.contentBox.y * node.height);
        expect(Number(line.getAttribute('y'))).toBeLessThan(
          (symbol.contentBox.y + symbol.contentBox.height) * node.height + 1,
        );
      }
      if (symbol.contentBox.height * node.height <= 72)
        expect(group.querySelector('[data-ibm-icon], [data-area-icon]')).toBeNull();
    }
    const group = doc.querySelector(`[data-node-id="${graph.nodes[0].id}"]`)!;
    const badge = group.querySelector('[data-status-badge]')!;
    expect(Number(badge.getAttribute('x')) + Number(badge.getAttribute('width')) / 2).toBeCloseTo(
      graph.nodes[0].width / 2,
      6,
    );
    expect(Number(badge.getAttribute('y'))).toBeGreaterThan(
      Number(group.querySelector('[data-ibm-title-line="3"]')!.getAttribute('y')),
    );
    expect(group.querySelector('title')?.textContent).toBe(graph.nodes[0].title);
  });
});
