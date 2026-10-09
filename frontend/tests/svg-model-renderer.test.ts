import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import { svgIcons } from '../src/export/svg-icons';
import { describe, expect, it } from 'vitest';
import { blankGraph, newNode, newEdge } from '../src/model/types';
import { SvgModelRenderer } from '../src/export/svg-model-renderer';
import { SvgTextLayout, svgPaint, svgIcon } from '../src/export/svg-native';
import { absoluteSVGPositions, svgScene } from '../src/export/svg-scene';
import { projectGraph } from '../src/canvas/projection';
import { MessageFormatter } from '../src/i18n/message-formatter';
import en from '../src/i18n/catalogs/en';
import type { SvgWorkerRequest } from '../src/export/svg-job-types';
import { createSimulationGraph } from '../src/simulation/document';
import { SimulationEngine } from '../src/simulation/engine';
import { parallelModel } from './helpers/parallel-model';
const measure = { measure: (text: string, size: number) => Array.from(text).length * size * 0.55 };
const formatter = new MessageFormatter('en', en);
function fixture(): SvgWorkerRequest {
  const graph = blankGraph('Native <vectors>');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Start <safe>',
      nodeType: 'start',
      color: '#37648d',
      metadata: { visualNerve: { icon: 'work' } },
    }),
    newNode(graph.diagram.id, { title: 'Done & ready', x: 320, status: 'done' }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      label: 'Depends & delivers',
      direction: 'both',
      style: 'dashed',
    }),
  ];
  return {
    graph,
    options: { scope: 'complete' },
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
  };
}
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');
describe('background native SVG model renderer', () => {
  it('emits selectable native text, existing Lucide geometry, arrows, colors and saved positions without DOM or images', () => {
    const input = fixture(),
      before = structuredClone(input.graph),
      events: unknown[] = [];
    const result = new SvgModelRenderer(measure).render(input, formatter, (event) =>
      events.push(event),
    );
    const doc = parse(result.svg);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('[data-node-id]')).toHaveLength(2);
    expect(doc.querySelectorAll('[data-edge-id]')).toHaveLength(1);
    expect(doc.querySelector('[data-node-id]')?.getAttribute('transform')).toBe('translate(0 0)');
    expect(doc.querySelector('path[marker-start][marker-end]')).not.toBeNull();
    expect(doc.querySelector('path[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe(
      '7 4',
    );
    expect(doc.querySelector('[data-status-icon="done"]')).not.toBeNull();
    expect([...doc.querySelectorAll('text')].map((node) => node.textContent).join(' ')).toContain(
      'Start <safe>',
    );
    expect(
      [...doc.querySelectorAll('path')].some((path) =>
        path.getAttribute('d')?.includes('M12 12h.01'),
      ),
    ).toBe(true);
    expect(doc.querySelector('image,foreignObject,script')).toBeNull();
    expect(result.bytes).toBe(new TextEncoder().encode(result.svg).length);
    expect(input.graph).toEqual(before);
    expect(events.length).toBeGreaterThan(3);
  });
  it('keeps every worker icon path synchronized with the installed canvas icon library', () => {
    for (const name of Object.keys(svgIcons)) {
      const exportName = name
        .split('-')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('');
      const Icon = Reflect.get(lucide, exportName) as lucide.LucideIcon;
      expect(Icon, name).toBeDefined();
      const current = parse(renderToStaticMarkup(createElement(Icon, { size: 24 })));
      const vector = parse(
        `<svg xmlns="http://www.w3.org/2000/svg">${svgIcon(name, 0, 0, 24, '#23664d')}</svg>`,
      );
      const geometry = (element: Element) => [
        element.tagName,
        ...[...element.attributes]
          .map((attribute) => [attribute.name, attribute.value])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ];
      expect([...vector.querySelector('g')!.children].map(geometry), name).toEqual(
        [...current.documentElement.children].map(geometry),
      );
    }
  });
  it.each(['planned', 'in-progress', 'blocked'])(
    'preserves captured %s badge colors, matching icons, ink and borders',
    (status) => {
      const input = fixture();
      input.graph.nodes[0].status = status;
      input.theme.statusColors = { [status]: { background: '#172d55', text: '#bfdbfe' } };
      const doc = parse(new SvgModelRenderer(measure).render(input, formatter).svg),
        badge = doc.querySelector(`[data-status-badge="${status}"]`),
        icon = doc.querySelector(`[data-status-icon="${status}"]`);
      expect(badge?.getAttribute('fill')).toBe('#172d55');
      expect(badge?.getAttribute('stroke')).toBe('#bfdbfe');
      expect(icon?.getAttribute('stroke')).toBe('#bfdbfe');
      expect(icon?.nextElementSibling?.getAttribute('fill')).toBe('#bfdbfe');
    },
  );
  it('paints transparent nested groups before connections and ordinary cards, preserving parent order and clip identities', () => {
    const input = fixture(),
      outer = newNode(input.graph.diagram.id, {
        title: 'Outer group',
        nodeType: 'group',
        width: 1000,
        height: 500,
        color: '#37648d',
      }),
      inner = newNode(input.graph.diagram.id, {
        title: 'Inner group',
        nodeType: 'group',
        x: 20,
        y: 60,
        width: 900,
        height: 400,
        parentId: outer.id,
      });
    input.graph.nodes[0].x = 50;
    input.graph.nodes[0].y = 100;
    input.graph.nodes[0].parentId = inner.id;
    input.graph.nodes[1].x = 500;
    input.graph.nodes[1].y = 100;
    input.graph.nodes[1].parentId = inner.id;
    // Imported documents need not store parents before descendants.
    input.graph.nodes = [input.graph.nodes[0], inner, input.graph.nodes[1], outer];
    const doc = parse(new SvgModelRenderer(measure).render(input, formatter).svg),
      order = [...doc.querySelectorAll('svg > g > [data-node-id],svg > g > [data-edge-id]')].map(
        (element) => element.getAttribute('data-node-id') ?? element.getAttribute('data-edge-id'),
      );
    expect(order).toEqual([
      outer.id,
      inner.id,
      input.graph.edges[0].id,
      input.graph.nodes[0].id,
      input.graph.nodes[2].id,
    ]);
    for (const group of [outer, inner]) {
      const card = doc.querySelector(`[data-node-id="${group.id}"]`)!;
      const backgrounds = [...card.children].filter((element) => element.tagName === 'rect');
      expect(backgrounds).toHaveLength(1);
      expect(backgrounds[0].getAttribute('fill-opacity')).toBe('0.03');
      expect(backgrounds[0].getAttribute('stroke-dasharray')).toBe('4 3');
    }
    const clips = [...doc.querySelectorAll('clipPath')].map((element) => element.id);
    expect(new Set(clips).size).toBe(8);
    expect(order).toHaveLength(5);
  });
  it('preserves all 7,000 nodes and 6,999 connections with bounded progress and no React rendering', () => {
    const input = fixture();
    input.graph.nodes = Array.from({ length: 7000 }, (_, index) =>
      newNode(input.graph.diagram.id, {
        title: `Module ${index}`,
        x: (index % 100) * 250,
        y: Math.floor(index / 100) * 150,
      }),
    );
    input.graph.edges = input.graph.nodes
      .slice(1)
      .map((node, index) => newEdge(input.graph.diagram.id, input.graph.nodes[index].id, node.id));
    const progress: number[] = [];
    const result = new SvgModelRenderer(measure).render(input, formatter, (event) => {
      if (event.type === 'progress') progress.push(event.progress);
    });
    expect(result.nodeCount).toBe(7000);
    expect(result.edgeCount).toBe(6999);
    expect((result.svg.match(/data-node-id=/g) ?? []).length).toBe(7000);
    expect((result.svg.match(/data-edge-id=/g) ?? []).length).toBe(6999);
    expect(result.svg).toContain('Module 6999');
    expect(progress.every((value) => value >= 0 && value <= 100)).toBe(true);
    expect(result.svg).not.toContain('foreignObject');
  });
  it('keeps long source evidence as full clipped native text and desc without moving or resizing saved cards', () => {
    const input = fixture();
    const node = input.graph.nodes[0];
    node.nodeType = 'database';
    node.width = 220;
    node.height = 100;
    node.metadata.sqlTable = {
      version: 1,
      name: 'customers',
      qualifiedName: ['crm', 'customers'],
      primaryKey: [],
      uniqueKeys: [],
      columns: Array.from({ length: 30 }, (_, index) => ({
        name: `column_${index}`,
        dataType: 'VARCHAR(100)',
        nullable: true,
        primaryKey: false,
        foreignKey: false,
        unique: false,
      })),
    };
    const result = new SvgModelRenderer(measure).render(input, formatter),
      doc = parse(result.svg),
      card = doc.querySelector('[data-node-id]')!;
    expect(card.getAttribute('transform')).toBe('translate(0 0)');
    expect(card.querySelector('rect[height="99"]')).not.toBeNull();
    expect(card.querySelector('desc')?.textContent).toContain('column_29');
    expect([...card.querySelectorAll('text')].map((text) => text.textContent).join(' ')).toContain(
      'column_29',
    );
    expect(card.querySelector('g[clip-path]')).not.toBeNull();
    expect(input.graph.nodes[0].height).toBe(100);
  });
  it('labels project directories with the same semantic folder kind and native folder icon as the canvas', () => {
    const input = fixture(),
      node = input.graph.nodes[0];
    node.nodeType = 'generic';
    node.metadata = {
      projectDirectory: { version: 1, path: 'src', fileCount: 2, languages: ['typescript'] },
    };
    const doc = parse(new SvgModelRenderer(measure).render(input, formatter).svg),
      card = doc.querySelector(`[data-node-id="${node.id}"]`)!;
    expect(card.querySelector('g[clip-path] > text')?.textContent).toBe(
      formatter.t('editor.nodes.directory.label').toUpperCase(),
    );
    expect(
      [...card.querySelectorAll('text')].map((element) => element.textContent).join(' '),
    ).toContain('src');
    expect(card.querySelector('desc')?.textContent).toContain('TypeScript');
    const icon = card.querySelector('g[clip-path] > g')!;
    expect(icon.children[0].getAttribute('d')).toBe(svgIcons.folder[0][1].d);
  });
  it('includes derived mindmap hierarchy edges, correct branch geometry and status with selected-only scope', () => {
    const input = fixture();
    input.graph.diagram.type = 'mindmap';
    input.graph.nodes[1].parentId = input.graph.nodes[0].id;
    input.graph.edges = [];
    const result = new SvgModelRenderer(measure).render(input, formatter);
    expect(result.edgeCount).toBe(1);
    expect(result.svg).toContain('hierarchy:');
    input.options = { scope: 'selected', nodeIds: [input.graph.nodes[1].id] };
    const selected = new SvgModelRenderer(measure).render(input, formatter);
    expect(selected.nodeCount).toBe(1);
    expect(selected.edgeCount).toBe(0);
    expect(selected.svg).not.toContain(`data-node-id="${input.graph.nodes[0].id}"`);
  });
  it('exports actual fork branch counts and join waiting state without inventing work capacity for control nodes', () => {
    const input = fixture();
    input.graph = createSimulationGraph('Parallel work', parallelModel());
    const model = input.graph.simulation!,
      engine = new SimulationEngine(model, { seed: 42 });
    engine.advance(6);
    input.simulationView = {
      run: {
        id: crypto.randomUUID(),
        diagramId: input.graph.diagram.id,
        status: 'running',
        model,
        options: { durationSeconds: 60, seed: 42 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      state: engine.state(),
    };
    const doc = parse(new SvgModelRenderer(measure).render(input, formatter).svg),
      fork = model.nodes.find((node) => node.type === 'fork')!,
      join = model.nodes.find((node) => node.type === 'join')!;
    const text = (id: string) =>
      [...doc.querySelectorAll(`[data-node-id="${id}"] text`)]
        .map((element) => element.textContent)
        .join(' ')
        .replace(/\s+/g, ' ');
    expect(text(fork.id)).toContain('2 parallel tasks');
    expect(text(join.id)).toContain('Waiting cases: 1 · Ready tasks: 1/2');
    expect(text(fork.id)).not.toContain('Capacity');
    expect(text(join.id)).not.toContain('Capacity');
    expect(text(join.id)).not.toContain('Queue');
  });
  it('permits a small selection from a document above the complete export object limit', () => {
    const input = fixture();
    input.graph.nodes = Array.from({ length: 20_001 }, (_, index) =>
      newNode(input.graph.diagram.id, { title: `Scoped module ${index}`, x: index * 240 }),
    );
    input.graph.edges = [];
    input.options = { scope: 'selected', nodeIds: [input.graph.nodes[20_000].id] };
    const result = new SvgModelRenderer(measure).render(input, formatter);
    expect(result.nodeCount).toBe(1);
    expect(result.svg).toContain('Scoped module 20000');
    input.options = { scope: 'complete' };
    expect(() => new SvgModelRenderer(measure).render(input, formatter)).toThrow('20,000');
  });
  it('renders pen strokes as native paths and dots, including a drawing-only document', () => {
    const input = fixture();
    input.graph.nodes = [];
    input.graph.edges = [];
    input.graph.diagram.settings.drawing = {
      version: 1,
      visible: true,
      strokes: [
        { id: 'dot', color: '#226d72', width: 4, points: [[30, 40]] },
        {
          id: 'stroke',
          color: '#23664d',
          width: 3,
          points: [
            [0, 0],
            [5, 5],
            [10, 5],
          ],
        },
      ],
    };
    const doc = parse(new SvgModelRenderer(measure).render(input, formatter).svg);
    expect(doc.querySelector('circle[data-drawing-stroke-id="dot"]')).not.toBeNull();
    expect(doc.querySelector('path[data-drawing-stroke-id="stroke"]')?.getAttribute('d')).toContain(
      'Q',
    );
  });
  it('preserves visible pen annotations for selected scope while cropping to selected node bounds', () => {
    const input = fixture();
    input.graph.nodes[0].width = 220;
    input.graph.nodes[0].height = 110;
    input.options = { scope: 'selected', nodeIds: [input.graph.nodes[0].id] };
    input.graph.diagram.settings.drawing = {
      version: 1,
      visible: true,
      strokes: [
        { id: 'inside-selection', color: '#23664d', width: 4, points: [[30, 40]] },
        { id: 'outside-selection', color: '#23664d', width: 4, points: [[1000, 1000]] },
      ],
    };
    const scene = svgScene(input),
      result = new SvgModelRenderer(measure).render(input, formatter),
      doc = parse(result.svg);
    expect(scene.strokes).toHaveLength(2);
    expect(scene.bounds).toEqual({ x: 0, y: 0, width: 220, height: 110 });
    expect(doc.querySelector('[data-drawing-stroke-id="inside-selection"]')).not.toBeNull();
    expect(doc.querySelector('[data-drawing-stroke-id="outside-selection"]')).not.toBeNull();
    // The same fixed crop as legacy selected exports, rather than fitting off-selection ink.
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 300 190');
    expect(doc.querySelector('svg > g')?.getAttribute('transform')).toBe(
      'translate(40 40) scale(1)',
    );
  });
  it('rejects invalid geometry and oversized text explicitly rather than silently dropping objects', () => {
    const input = fixture();
    input.graph.nodes[0].x = NaN;
    expect(() => new SvgModelRenderer(measure).render(input, formatter)).toThrow('geometry');
    input.graph.nodes[0].x = 0;
    input.graph.nodes[0].title = 'x'.repeat(5_000_001);
    expect(() => new SvgModelRenderer(measure).render(input, formatter)).toThrow('5,000,000');
  });
  it('preserves Unicode and unbroken names when wrapping and forbids external paint values', () => {
    const layout = new SvgTextLayout(measure),
      source = 'longIdentifier0123456789🙂🙂漢字\nsecond line';
    const wrapped = layout.wrap(source, 25, 10, 400);
    expect(wrapped.join('').replace(/\n/g, '')).toBe(source.replace(/\n/g, ''));
    expect(wrapped.every((line) => !/[\uD800-\uDBFF]$/.test(line))).toBe(true);
    expect(svgPaint('url(https://example.com/image.svg)', '#fff')).toBe('#fff');
  });
  it('wraps long unbroken source tokens with linear measured-character work rather than remeasuring every remaining suffix', () => {
    const costs: number[] = [];
    for (const size of [10_000, 20_000, 40_000]) {
      let measured = 0;
      const layout = new SvgTextLayout({
          measure(text) {
            measured += text.length;
            return text.length;
          },
        }),
        source = 'a'.repeat(size),
        lines = layout.wrap(source, 100, 10, 400);
      expect(lines.join('')).toBe(source);
      expect(lines.every((line) => line.length <= 100)).toBe(true);
      expect(measured).toBeLessThan(size * 24);
      costs.push(measured);
    }
    expect(costs[1] / costs[0]).toBeLessThan(2.1);
    expect(costs[2] / costs[1]).toBeLessThan(2.1);
  });
  it('rejects output-size overflow during lazy line layout before materializing the entire oversized fragment', () => {
    let measured = 0;
    const layout = new SvgTextLayout(
        {
          measure(text) {
            measured += text.length;
            return text.length;
          },
        },
        1024,
      ),
      source = 'a'.repeat(100_000);
    expect(() => layout.layout([{ text: source, size: 10, weight: 400 }], 1)).toThrow('64 MiB');
    expect(measured).toBeLessThan(source.length * 1.01);
  });
  it('resolves 7,000 nested groups iteratively and rejects cycles', () => {
    const input = fixture();
    input.graph.nodes = Array.from({ length: 7000 }, (_, index) =>
      newNode(input.graph.diagram.id, { nodeType: 'group', x: 1, y: 1 }),
    );
    for (let index = 1; index < input.graph.nodes.length; index++)
      input.graph.nodes[index].parentId = input.graph.nodes[index - 1].id;
    const projection = projectGraph(input.graph, input.graph.owners, [], [], undefined, true);
    expect(
      absoluteSVGPositions(
        projection.nodes.map((node) => ({ ...node, position: { x: 1, y: 1 } })),
      ).get(input.graph.nodes[6999].id),
    ).toEqual({
      x: 7000,
      y: 7000,
    });
    input.graph.nodes[0].parentId = input.graph.nodes[6999].id;
    expect(() =>
      absoluteSVGPositions(projectGraph(input.graph, [], [], [], undefined, true).nodes),
    ).toThrow('cyclic');
  });
});
