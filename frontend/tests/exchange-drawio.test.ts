import { describe, expect, it, vi } from 'vitest';
import { serializeDrawio } from '../src/export/exchange-drawio';
import {
  ExchangeExportError,
  type ExchangeEdge,
  type ExchangeNode,
  type ExchangeScene,
} from '../src/export/exchange-types';
import { exchangeXML, ExchangeXmlWriter } from '../src/export/exchange-xml';
import { parseDrawio } from '../src/imports/diagram/drawio';
import { attr, children, first, parseXml, type XmlNode } from '../src/imports/diagram/xml';
import { validateGraph } from '../src/model/validation';

const node = (id: string, changes: Partial<ExchangeNode> = {}): ExchangeNode => ({
  id,
  kind: 'process',
  title: id,
  detailLines: [],
  x: 100,
  y: 200,
  width: 160,
  height: 80,
  fill: '#aabbcc',
  stroke: '#112233',
  textColor: '#445566',
  ...changes,
});
const edge = (id: string, changes: Partial<ExchangeEdge> = {}): ExchangeEdge => ({
  id,
  source: 'a',
  target: 'b',
  label: 'reviews',
  direction: 'forward',
  style: 'solid',
  stroke: '#123456',
  ...changes,
});
const scene = (nodes: ExchangeNode[], edges: ExchangeEdge[] = []): ExchangeScene => ({
  name: 'Example diagram',
  nodes,
  edges,
  warnings: [],
});
const xml = (value: ExchangeScene) => new TextDecoder().decode(serializeDrawio(value).bytes);
const cells = (value: string) => {
  const document = parseXml(value);
  return children(first(first(first(document, 'diagram')!, 'mxGraphModel')!, 'root')!, 'mxCell');
};
const byId = (entries: XmlNode[], id: string) => entries.find((entry) => attr(entry, 'id') === id)!;
const style = (cell: XmlNode) =>
  Object.fromEntries(
    (attr(cell, 'style') ?? '')
      .split(';')
      .filter(Boolean)
      .map((part) => part.split('=')),
  );

describe('editable draw.io export', () => {
  it('writes one deterministic uncompressed page with native editable objects', () => {
    const value = scene([node('a'), node('b')], [edge('e')]);
    const result = serializeDrawio(value);
    const output = new TextDecoder().decode(result.bytes);
    const document = parseXml(output);
    expect(result).toMatchObject({
      format: 'drawio',
      mimeType: 'application/vnd.jgraph.mxfile',
      nodeCount: 2,
      edgeCount: 1,
      warnings: [],
    });
    expect(result.bytes).toEqual(serializeDrawio(value).bytes);
    expect(document.name).toBe('mxfile');
    expect(attr(document, 'compressed')).toBe('false');
    expect(children(document, 'diagram')).toHaveLength(1);
    expect(attr(first(document, 'diagram')!, 'name')).toBe(value.name);
    expect(cells(output).map((cell) => attr(cell, 'id'))).toEqual(['0', '1', 'n1', 'n2', 'e1']);
    const imported = parseDrawio(output, 'example.drawio').pages[0];
    expect(imported.name).toBe(value.name);
    expect(
      imported.graph.nodes.map(({ title, x, y, width, height, color }) => ({
        title,
        x,
        y,
        width,
        height,
        color,
      })),
    ).toEqual([
      { title: 'a', x: 100, y: 200, width: 160, height: 80, color: '#aabbcc' },
      { title: 'b', x: 100, y: 200, width: 160, height: 80, color: '#aabbcc' },
    ]);
    expect(imported.graph.edges[0]).toMatchObject({
      label: 'reviews',
      direction: 'forward',
      style: 'solid',
      metadata: { diagramImport: { strokeColor: '#123456' } },
    });
    expect(() => validateGraph(imported.graph)).not.toThrow();
  });

  it('retains Unicode and all content as literal editable multiline text', () => {
    const value = scene(
      [
        node('a', {
          title: 'Hej räksmörgås & 日本語 🧠 <b>title</b> "quote"',
          description: 'First line\nSecond line',
          detailLines: [
            'Owner: A & B',
            'SQL: x < y > z',
            '<script src="https://bad.test">literal</script>',
          ],
        }),
        node('b'),
      ],
      [edge('e', { label: 'Literal <img src="https://bad.test"> & 🧠\nsecond line' })],
    );
    value.name = 'Unicode & "name" 日本語';
    const output = xml(value);
    const entries = cells(output);
    expect(attr(byId(entries, 'n1'), 'value')).toBe(
      [value.nodes[0].title, value.nodes[0].description, ...value.nodes[0].detailLines].join('\n'),
    );
    expect(attr(byId(entries, 'e1'), 'value')).toBe(value.edges[0].label);
    expect(style(byId(entries, 'n1')).html).toBe('0');
    expect(style(byId(entries, 'e1')).html).toBe('0');
    expect(output).toContain('&#10;');
    expect(output).not.toMatch(/<(?:script|img|iframe|svg)\b/);
    for (const entry of entries) {
      expect(Object.keys(entry.attributes)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(?:link|href|image|src|data|metadata)$/)]),
      );
      expect(attr(entry, 'style') ?? '').not.toMatch(/(?:^|;)(?:image|link|shape=image)=/);
    }
    const graph = parseDrawio(output, 'unicode.drawio').pages[0].graph;
    expect(graph.nodes[0].title).toBe(attr(byId(entries, 'n1'), 'value'));
    expect(graph.edges[0].label).toBe(value.edges[0].label);
    expect(graph.nodes[0].metadata.diagramImport).toMatchObject({
      strokeColor: '#112233',
      fontColor: '#445566',
    });
  });

  it('writes nested groups with relative coordinates and connectors in their common ancestor', () => {
    const value = scene(
      [
        node('child', { title: 'Child', x: 153, y: 253, parentId: 'inner' }),
        node('inner', {
          kind: 'group',
          title: 'Inner',
          x: 130,
          y: 240,
          parentId: 'outer',
          width: 300,
          height: 200,
        }),
        node('outer', { kind: 'group', title: 'Outer', x: 100, y: 200, width: 600, height: 400 }),
        node('top', { title: 'Top', x: 800, y: 240 }),
        node('sibling', { title: 'Sibling', x: 180, y: 290, parentId: 'outer' }),
      ],
      [
        edge('inside', { source: 'child', target: 'sibling' }),
        edge('outside', { source: 'child', target: 'top' }),
        edge('self', { source: 'child', target: 'child' }),
      ],
    );
    const output = xml(value);
    const entries = cells(output);
    expect(entries.indexOf(byId(entries, 'n3'))).toBeLessThan(entries.indexOf(byId(entries, 'n2')));
    expect(entries.indexOf(byId(entries, 'n2'))).toBeLessThan(entries.indexOf(byId(entries, 'n1')));
    expect(attr(byId(entries, 'n1'), 'parent')).toBe('n2');
    expect(first(byId(entries, 'n1'), 'mxGeometry')!.attributes).toMatchObject({
      x: '23',
      y: '13',
    });
    expect(first(byId(entries, 'n2'), 'mxGeometry')!.attributes).toMatchObject({
      x: '30',
      y: '40',
    });
    expect(attr(byId(entries, 'e1'), 'parent')).toBe('n3');
    expect(attr(byId(entries, 'e2'), 'parent')).toBe('1');
    expect(attr(byId(entries, 'e3'), 'parent')).toBe('n2');
    const graph = parseDrawio(output, 'nested.drawio').pages[0].graph;
    const outer = graph.nodes.find((node) => node.title === 'Outer')!;
    const inner = graph.nodes.find((node) => node.title === 'Inner')!;
    const child = graph.nodes.find((node) => node.title === 'Child')!;
    expect(inner).toMatchObject({ nodeType: 'group', parentId: outer.id, x: 130, y: 240 });
    expect(child).toMatchObject({ parentId: inner.id, x: 153, y: 253 });
    expect(graph.edges[0].sourceNodeId).toBe(child.id);
    expect(graph.edges[0].targetNodeId).toBe(
      graph.nodes.find((node) => node.title === 'Sibling')!.id,
    );
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it.each(['none', 'forward', 'backward', 'both'] as const)(
    'keeps %s arrow semantics and glued native endpoints',
    (direction) => {
      const output = xml(scene([node('a'), node('b')], [edge('e', { direction })]));
      const connector = byId(cells(output), 'e1');
      expect(connector.attributes).toMatchObject({
        source: 'n1',
        target: 'n2',
        edge: '1',
        parent: '1',
      });
      expect(first(connector, 'mxGeometry')!.attributes).toEqual({ relative: '1', as: 'geometry' });
      expect(parseDrawio(output, 'arrows.drawio').pages[0].graph.edges[0].direction).toBe(
        direction,
      );
    },
  );

  it('finds connector parents across unequal-depth branches without recursive traversal', () => {
    const groups = Array.from({ length: 2_000 }, (_, index) =>
      node(`g${index}`, {
        kind: 'group',
        x: index,
        y: index,
        parentId: index ? `g${index - 1}` : undefined,
      }),
    );
    const entries = cells(
      xml(
        scene(
          [...groups, node('a', { parentId: 'g1999' }), node('b', { parentId: 'g100' })],
          [edge('e')],
        ),
      ),
    );
    expect(attr(byId(entries, 'e1'), 'parent')).toBe('n101');
    expect(first(byId(entries, 'n2000'), 'mxGeometry')!.attributes).toMatchObject({
      x: '1',
      y: '1',
    });
  });

  it.each(['solid', 'dashed', 'dotted'] as const)('keeps %s connector patterns', (pattern) => {
    const graph = parseDrawio(
      xml(scene([node('a'), node('b')], [edge('e', { style: pattern })])),
      'patterns.drawio',
    ).pages[0].graph;
    expect(graph.edges[0].style).toBe(pattern);
  });

  it('uses native geometric primitives and reports standard-shape simplifications', () => {
    const kinds = [
      'process',
      'generic',
      'start',
      'decision',
      'database',
      'document',
      'note',
      'input',
      'group',
      'team',
    ] as const;
    const value = scene(kinds.map((kind) => node(kind, { kind })));
    value.warnings = [{ code: 'prior', message: 'A projection warning.' }];
    const result = serializeDrawio(value);
    const entries = cells(new TextDecoder().decode(result.bytes));
    expect(
      entries.filter((entry) => attr(entry, 'vertex') === '1').map((entry) => style(entry).shape),
    ).toEqual([
      'rectangle',
      'rectangle',
      'ellipse',
      'rhombus',
      'cylinder3',
      'document',
      'note',
      'parallelogram',
      'rectangle',
      'rectangle',
    ]);
    expect(style(byId(entries, 'n2')).rounded).toBe('1');
    expect(style(byId(entries, 'n9'))).toMatchObject({ group: '1', container: '1' });
    const imported = parseDrawio(new TextDecoder().decode(result.bytes), 'shapes.drawio').pages[0]
      .graph;
    expect(imported.nodes.map((node) => node.nodeType)).toEqual([
      'process',
      'process',
      'start',
      'decision',
      'database',
      'document',
      'note',
      'input',
      'group',
      'process',
    ]);
    expect(result.warnings).toEqual([
      value.warnings[0],
      { code: 'drawio_shape_simplified', message: expect.any(String) },
    ]);
    expect(value.warnings).toHaveLength(1);
  });

  it('reports monotonic progress through the write and packaging phases', () => {
    const progress = vi.fn();
    serializeDrawio(scene([node('a'), node('b')], [edge('e')]), progress);
    const percentages = progress.mock.calls.map(([percentage]) => percentage);
    expect(percentages).toEqual([...percentages].sort((a, b) => a - b));
    expect(progress.mock.calls.at(-1)).toEqual([100, 'packaging']);
    expect(new Set(progress.mock.calls.map(([, phase]) => phase))).toEqual(
      new Set(['nodes', 'edges', 'packaging']),
    );
  });

  it.each([
    scene([node('a'), node('a')]),
    scene([node('a', { parentId: 'missing' })]),
    scene([node('a'), node('b', { parentId: 'a' })]),
    scene([
      node('a', { kind: 'group', parentId: 'b' }),
      node('b', { kind: 'group', parentId: 'a' }),
    ]),
    scene([node('a')], [edge('e')]),
    scene([node('a', { x: Infinity })]),
    scene([node('a', { width: 0 })]),
    scene([node('a', { fill: '#fff;shape=image;image=https://bad.test' })]),
  ])('rejects invalid scenes before returning ambiguous or unsafe objects', (value) => {
    expect(() => serializeDrawio(value)).toThrow(ExchangeExportError);
  });
});

describe('exchange XML safety and byte budget', () => {
  it('escapes markup and preserves XML whitespace without corrupting Unicode', () => {
    const source = '&<>"\'\t\n\r日本語🧠';
    const encoded = exchangeXML(source);
    expect(attr(parseXml(`<label value="${encoded}"/>`), 'value')).toBe(source);
    expect(encoded).toBe('&amp;&lt;&gt;&quot;&apos;&#9;&#10;&#13;日本語🧠');
  });

  it.each(['\u0000', '\u000b', '\ud800', '\udfff', '\ufffe', '\uffff'])(
    'rejects XML 1.0 forbidden characters',
    (invalid) => expect(() => exchangeXML(`Text${invalid}`)).toThrow(ExchangeExportError),
  );

  it('bounds the actual UTF-8 byte count before retaining an overflowing chunk', () => {
    const writer = new ExchangeXmlWriter(8);
    writer.write('日本');
    writer.write('ab');
    expect(new TextDecoder().decode(writer.bytes())).toBe('日本ab');
    expect(() => writer.write('c')).toThrow(ExchangeExportError);
    expect(writer.bytes().byteLength).toBe(8);
    const emoji = new ExchangeXmlWriter(3);
    expect(() => emoji.write('🧠')).toThrow(ExchangeExportError);
    expect(emoji.bytes().byteLength).toBe(0);
  });
});
