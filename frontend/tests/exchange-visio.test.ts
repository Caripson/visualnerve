import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { serializeVisio } from '../src/export/exchange-visio';
import {
  exchangeLimits,
  type ExchangeEdge,
  type ExchangeNode,
  type ExchangeScene,
} from '../src/export/exchange-types';
import { parseVsdx } from '../src/imports/diagram/vsdx';
import { validateGraph } from '../src/model/validation';

const namespace = 'http://schemas.microsoft.com/office/visio/2012/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const node = (id: string, partial: Partial<ExchangeNode> = {}): ExchangeNode => ({
  id,
  kind: 'process',
  title: id,
  detailLines: [],
  x: 0,
  y: 0,
  width: 192,
  height: 96,
  fill: '#f0e0d0',
  stroke: '#123456',
  textColor: '#abcdef',
  ...partial,
});
const edge = (
  id: string,
  source: string,
  target: string,
  partial: Partial<ExchangeEdge> = {},
): ExchangeEdge => ({
  id,
  source,
  target,
  label: 'Connection',
  direction: 'forward',
  style: 'solid',
  stroke: '#789abc',
  ...partial,
});
const scene = (nodes: ExchangeNode[], edges: ExchangeEdge[] = []): ExchangeScene => ({
  name: 'Operations & delivery',
  nodes,
  edges,
  warnings: [],
});
function xml(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  expect(parsed.querySelector('parsererror')).toBeNull();
  return parsed;
}
function packageXml(input: ExchangeScene) {
  const result = serializeVisio(input);
  const parts = Object.fromEntries(
    Object.entries(unzipSync(result.bytes)).map(([path, bytes]) => [path, xml(strFromU8(bytes))]),
  );
  return {
    result,
    parts,
    page: parts['visio/pages/page1.xml'],
    pages: parts['visio/pages/pages.xml'],
  };
}
function children(element: Element, name: string) {
  return Array.from(element.children).filter((child) => child.localName === name);
}
function cells(element: Element) {
  return new Map(children(element, 'Cell').map((cell) => [cell.getAttribute('N')!, cell]));
}
const numberCell = (element: Element, name: string) =>
  Number(cells(element).get(name)?.getAttribute('V'));

describe('native Visio exchange export', () => {
  it('creates an OPC drawing with typed parts, resolvable relationships, fonts and editable styles', () => {
    const { result, parts, page, pages } = packageXml(
      scene([node('first'), node('second', { x: 384 })], [edge('edge', 'first', 'second')]),
    );
    expect(result).toMatchObject({
      format: 'vsdx',
      mimeType: 'application/vnd.ms-visio.drawing',
      nodeCount: 2,
      edgeCount: 1,
    });
    expect(result.bytes.subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(Object.keys(parts).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'docProps/app.xml',
        'docProps/core.xml',
        'docProps/custom.xml',
        'visio/document.xml',
        'visio/_rels/document.xml.rels',
        'visio/pages/pages.xml',
        'visio/pages/_rels/pages.xml.rels',
        'visio/pages/page1.xml',
      ].sort(),
    );
    const types = new Map(
      Array.from(parts['[Content_Types].xml'].getElementsByTagName('Override')).map((entry) => [
        entry.getAttribute('PartName'),
        entry.getAttribute('ContentType'),
      ]),
    );
    expect(types.get('/visio/document.xml')).toBe('application/vnd.ms-visio.drawing.main+xml');
    expect(types.get('/visio/pages/pages.xml')).toBe('application/vnd.ms-visio.pages+xml');
    expect(types.get('/visio/pages/page1.xml')).toBe('application/vnd.ms-visio.page+xml');
    expect(types.get('/docProps/core.xml')).toBe(
      'application/vnd.openxmlformats-package.core-properties+xml',
    );
    expect(types.get('/docProps/custom.xml')).toBe(
      'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    );
    const references = new Set<string>();
    for (const [path, document] of Object.entries(parts)) {
      if (!path.endsWith('.rels')) continue;
      expect(document.documentElement.namespaceURI).toBe(relationshipNamespace);
      const source =
        path === '_rels/.rels' ? '' : path.replace('/_rels/', '/').replace(/\.rels$/, '');
      const ids = new Set<string>();
      for (const relationship of Array.from(document.getElementsByTagName('Relationship'))) {
        const id = relationship.getAttribute('Id')!;
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        expect(relationship.hasAttribute('TargetMode')).toBe(false);
        const resolved = new URL(
          relationship.getAttribute('Target')!,
          `https://package.test/${source}`,
        ).pathname.slice(1);
        expect(parts[resolved]).toBeDefined();
        references.add(resolved);
      }
    }
    expect(references.size).toBe(6);
    expect(page.documentElement.namespaceURI).toBe(namespace);
    expect(
      pages
        .getElementsByTagName('Rel')[0]
        .getAttributeNS(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'id',
        ),
    ).toBe('rPage1');
    expect(
      parts['visio/document.xml'].getElementsByTagName('FaceName')[0].getAttribute('NameU'),
    ).toBe('Arial');
    expect(
      parts['visio/document.xml'].getElementsByTagName('StyleSheet')[0].getAttribute('ID'),
    ).toBe('0');
    expect(
      parts['docProps/custom.xml'].getElementsByTagName('property')[0].getAttribute('name'),
    ).toBe('RecalcDocument');
    expect(parts['docProps/custom.xml'].getElementsByTagName('vt:bool')[0].textContent).toBe(
      'true',
    );
  });

  it('converts negative canvas coordinates and nested group transforms into inches with a bottom origin', () => {
    const input = scene(
      [
        node('grandchild', {
          title: 'Grandchild',
          x: 120,
          y: 20,
          width: 80,
          height: 50,
          parentId: 'nested',
        }),
        node('group', { kind: 'group', title: 'Group', x: -120, y: -80, width: 480, height: 260 }),
        node('child', {
          title: 'Child',
          x: -50,
          y: -20,
          width: 160,
          height: 80,
          parentId: 'group',
        }),
        node('nested', {
          kind: 'group',
          title: 'Nested',
          x: 100,
          y: 0,
          width: 200,
          height: 140,
          parentId: 'group',
        }),
        node('outside', { title: 'Outside', x: 500, y: 50, width: 200, height: 90 }),
      ],
      [edge('cross-group', 'grandchild', 'outside')],
    );
    const { result, page, pages } = packageXml(input);
    const shapes = Array.from(page.getElementsByTagName('Shape'));
    const group = shapes.find((shape) => shape.getAttribute('Name') === 'Group')!;
    const child = shapes.find((shape) => shape.getAttribute('Name') === 'Child')!;
    const nested = shapes.find((shape) => shape.getAttribute('Name') === 'Nested')!;
    expect(numberCell(group, 'PinX')).toBeCloseTo(280 / 96, 8);
    expect(numberCell(group, 'PinY')).toBeCloseTo(170 / 96, 8);
    expect(numberCell(child, 'PinX')).toBeCloseTo(150 / 96, 8);
    expect(numberCell(child, 'PinY')).toBeCloseTo(160 / 96, 8);
    expect(child.parentElement?.parentElement).toBe(group);
    expect(nested.parentElement?.parentElement).toBe(group);
    expect(group.getAttribute('Type')).toBe('Group');
    const pageSheet = pages.getElementsByTagName('PageSheet')[0];
    expect(numberCell(pageSheet, 'PageWidth')).toBeCloseTo(900 / 96, 8);
    expect(numberCell(pageSheet, 'PageHeight')).toBeCloseTo(340 / 96, 8);
    const imported = parseVsdx(result.bytes, 'nested.vsdx').pages[0].graph;
    expect(imported.nodes).toHaveLength(5);
    expect(imported.edges).toHaveLength(1);
    for (const original of input.nodes) {
      const importedNode = imported.nodes.find((entry) => entry.title === original.title)!;
      expect(importedNode.x).toBeCloseTo(original.x + 160, 5);
      expect(importedNode.y).toBeCloseTo(original.y + 120, 5);
      expect(importedNode.width).toBeCloseTo(original.width, 5);
      expect(importedNode.height).toBeCloseTo(original.height, 5);
      if (original.parentId)
        expect(imported.nodes.find((entry) => entry.id === importedNode.parentId)?.title).toBe(
          input.nodes.find((entry) => entry.id === original.parentId)?.title,
        );
    }
    expect(() => validateGraph(imported)).not.toThrow();
  });

  it('writes actual native geometry with resize formulas and matching editable text runs', () => {
    const title = 'Ångström <box> & "quotes" 😊';
    const description = 'First line\nSecond line';
    const { page } = packageXml(
      scene([
        node('rect', { title, description, detailLines: ['Owner: R&D', 'Status: ready'] }),
        node('diamond', { kind: 'decision', x: 250 }),
        node('ellipse', { kind: 'start', x: 500 }),
        node('document', { kind: 'document', x: 750 }),
      ]),
    );
    const shapes = Array.from(page.getElementsByTagName('Shape'));
    for (const shape of shapes) {
      expect(shape.getAttribute('Master')).toBeNull();
      expect(shape.getAttribute('OneD')).toBeNull();
      const geometry = children(shape, 'Section').find(
        (section) => section.getAttribute('N') === 'Geometry',
      )!;
      expect(children(geometry, 'Row').length).toBeGreaterThan(0);
      expect(cells(shape).get('LocPinX')?.getAttribute('F')).toBe('Width*0.5');
      expect(cells(shape).get('LocPinY')?.getAttribute('F')).toBe('Height*0.5');
    }
    expect(
      children(shapes[1], 'Section')
        .find((section) => section.getAttribute('N') === 'Geometry')
        ?.querySelector('Row Cell[N="X"]')
        ?.getAttribute('F'),
    ).toBe('Width*0.5');
    expect(
      children(shapes[2], 'Section')
        .find((section) => section.getAttribute('N') === 'Geometry')
        ?.querySelector('Row')
        ?.getAttribute('T'),
    ).toBe('Ellipse');
    const text = children(shapes[0], 'Text')[0];
    expect(text.textContent).toBe(`${title}\n${description}\nOwner: R&D\nStatus: ready`);
    expect(children(text, 'cp').map((run) => run.getAttribute('IX'))).toEqual(['0', '1']);
    const chars = children(shapes[0], 'Section').find(
      (section) => section.getAttribute('N') === 'Character',
    )!;
    expect(children(chars, 'Row').map((row) => row.getAttribute('IX'))).toEqual(['0', '1']);
    expect(numberCell(children(chars, 'Row')[0], 'Style')).toBe(1);
    expect(numberCell(children(chars, 'Row')[1], 'Style')).toBe(0);
    expect(cells(shapes[0]).get('FillForegnd')?.getAttribute('V')).toBe('#f0e0d0');
    expect(cells(shapes[0]).get('LineColor')?.getAttribute('V')).toBe('#123456');
  });

  it('retains each group title before nested shapes, matching native Visio documents and libvisio reading order', () => {
    const { page } = packageXml(
      scene([
        node('parent', { kind: 'group', title: 'Operations & delivery', width: 600, height: 400 }),
        node('nested', {
          kind: 'group',
          title: 'Ångström 😊',
          parentId: 'parent',
          width: 400,
          height: 200,
        }),
        node('child', { title: 'Child', parentId: 'nested', description: 'First\nSecond' }),
      ]),
    );
    const shapes = Array.from(page.getElementsByTagName('Shape'));
    for (const group of shapes.filter((shape) => shape.getAttribute('Type') === 'Group')) {
      const order = Array.from(group.children).map((child) => child.localName);
      expect(order.indexOf('Text')).toBeLessThan(order.indexOf('Shapes'));
      expect(children(group, 'Text')[0].textContent).toBe(group.getAttribute('Name'));
    }
    expect(children(shapes[2], 'Text')[0].textContent).toBe('Child\nFirst\nSecond');
  });

  it('writes glued dynamic connectors with formula dependencies, native routes, arrows and dash styles', () => {
    const input = scene(
      [node('left'), node('right', { x: 384, y: 192 })],
      [
        edge('forward', 'left', 'right'),
        edge('backward', 'right', 'left', { direction: 'backward', style: 'dashed' }),
        edge('both', 'left', 'right', { direction: 'both', style: 'dotted' }),
        edge('none', 'left', 'right', { direction: 'none' }),
      ],
    );
    const { result, page } = packageXml(input);
    const shapes = Array.from(page.getElementsByTagName('Shape'));
    const ids = shapes.map((shape) => shape.getAttribute('ID')!);
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => /^\d+$/.test(id) && Number(id) > 0)).toBe(true);
    const connectors = shapes.slice(2);
    connectors.forEach((connector, index) => {
      const values = cells(connector);
      const expectedSource = index === 1 ? 2 : 1,
        expectedTarget = index === 1 ? 1 : 2;
      expect(values.get('BeginX')?.getAttribute('F')).toBe(
        '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)',
      );
      expect(values.get('BeginY')?.getAttribute('F')).toBe(values.get('BeginX')?.getAttribute('F'));
      expect(values.get('EndX')?.getAttribute('F')).toBe(
        '_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)',
      );
      expect(values.get('EndY')?.getAttribute('F')).toBe(values.get('EndX')?.getAttribute('F'));
      expect(values.get('BegTrigger')?.getAttribute('F')).toBe(
        `_XFTRIGGER(Sheet.${expectedSource}!EventXFMod)`,
      );
      expect(values.get('EndTrigger')?.getAttribute('F')).toBe(
        `_XFTRIGGER(Sheet.${expectedTarget}!EventXFMod)`,
      );
      expect(numberCell(connector, 'ObjType')).toBe(2);
      expect(numberCell(connector, 'GlueType')).toBe(2);
      expect(numberCell(connector, 'PinX')).toBeCloseTo(
        (numberCell(connector, 'BeginX') + numberCell(connector, 'EndX')) / 2,
        8,
      );
      expect(numberCell(connector, 'Width')).toBeCloseTo(
        numberCell(connector, 'EndX') - numberCell(connector, 'BeginX'),
        8,
      );
      expect(numberCell(connector, 'Height')).toBeCloseTo(
        numberCell(connector, 'EndY') - numberCell(connector, 'BeginY'),
        8,
      );
      const attached = Array.from(page.getElementsByTagName('Connect')).filter(
        (connect) => connect.getAttribute('FromSheet') === connector.getAttribute('ID'),
      );
      expect(
        attached.map((connect) => [
          connect.getAttribute('FromCell'),
          connect.getAttribute('FromPart'),
          connect.getAttribute('ToSheet'),
          connect.getAttribute('ToCell'),
          connect.getAttribute('ToPart'),
        ]),
      ).toEqual([
        ['BeginX', '9', String(expectedSource), 'PinX', '3'],
        ['EndX', '12', String(expectedTarget), 'PinX', '3'],
      ]);
    });
    expect(
      connectors.map((shape) => [
        numberCell(shape, 'BeginArrow') > 0,
        numberCell(shape, 'EndArrow') > 0,
      ]),
    ).toEqual([
      [false, true],
      [true, false],
      [true, true],
      [false, false],
    ]);
    expect(connectors.map((shape) => numberCell(shape, 'LinePattern'))).toEqual([1, 2, 3, 1]);
    const imported = parseVsdx(result.bytes, 'connectors.vsdx').pages[0].graph;
    expect(imported.edges.map((connection) => [connection.direction, connection.style])).toEqual(
      input.edges.map((connection) => [connection.direction, connection.style]),
    );
  });

  it('handles self-connections without an initially invisible route and keeps warnings explicit', () => {
    const input = scene([node('self')], [edge('loop', 'self', 'self')]);
    input.warnings.push({ code: 'SOURCE_SIMPLIFIED', message: 'A source card was simplified.' });
    const { result, page } = packageXml(input);
    const connector = page.getElementsByTagName('Shape')[1];
    expect(numberCell(connector, 'Width')).not.toBe(0);
    expect(numberCell(connector, 'Height')).not.toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'SOURCE_SIMPLIFIED',
      'VISIO_COMPATIBILITY_PREVIEW',
    ]);
    expect(input.warnings).toHaveLength(1);
  });

  it('keeps pale connector accents separate from portable dark label text', () => {
    const { page } = packageXml(
      scene(
        [node('left'), node('right', { x: 384 })],
        [
          edge('pale', 'left', 'right', { stroke: '#B3CBE7', label: 'Readable pale accent' }),
          edge('explicit-ink', 'left', 'right', { stroke: '#FFFFFF', textColor: '#223344' }),
        ],
      ),
    );
    const connectors = Array.from(page.getElementsByTagName('Shape')).slice(2);
    expect(connectors.map((shape) => cells(shape).get('LineColor')?.getAttribute('V'))).toEqual([
      '#B3CBE7',
      '#FFFFFF',
    ]);
    expect(
      connectors.map((shape) =>
        children(shape, 'Section')
          .find((section) => section.getAttribute('N') === 'Character')
          ?.querySelector('Cell[N="Color"]')
          ?.getAttribute('V'),
      ),
    ).toEqual(['#1F2D28', '#223344']);
    expect(children(connectors[0], 'Text')[0].textContent).toBe('Readable pale accent');
  });

  it('exports deliberately selected scene content without arbitrary metadata or external resources', () => {
    const input = scene([node('first', { description: 'Public description' })]);
    Object.assign(input, {
      dataset: [{ secret: 'PRIVATE_DATASET_VALUE' }],
      metadata: { secret: 'PRIVATE_PROVENANCE_VALUE' },
    });
    Object.assign(input.nodes[0], {
      metadata: { secret: 'PRIVATE_NODE_VALUE' },
      notes: 'PRIVATE_NOTES_VALUE',
      url: 'https://private.example/',
    });
    const result = serializeVisio(input);
    const document = Object.values(unzipSync(result.bytes))
      .map((bytes) => strFromU8(bytes))
      .join('');
    expect(document).toContain('Public description');
    expect(document).not.toMatch(/PRIVATE_|private\.example|TargetMode|ForeignData|vba|oleObject/);
  });

  it('rejects dangling endpoints, invalid text, invalid geometry and cyclic hierarchy', () => {
    expect(() =>
      serializeVisio(scene([node('first')], [edge('edge', 'first', 'missing')])),
    ).toThrow(/missing node/);
    expect(() => serializeVisio(scene([node('first', { parentId: 'missing' })]))).toThrow(
      /missing parent/,
    );
    expect(() =>
      serializeVisio(
        scene([node('first', { parentId: 'second' }), node('second', { parentId: 'first' })]),
      ),
    ).toThrow(/cyclic/);
    expect(() => serializeVisio(scene([node('first'), node('first')]))).toThrow(/unique/);
    expect(() => serializeVisio(scene([node('first', { title: 'Invalid\u0001' })]))).toThrow();
    for (const x of [NaN, Infinity, exchangeLimits.dimension + 1])
      expect(() => serializeVisio(scene([node('first', { x })]))).toThrow(/geometry/);
    expect(() => serializeVisio(scene([node('first', { width: 0 })]))).toThrow(/geometry/);
  });

  it('serializes deeply nested groups iteratively and reports packaging completion', () => {
    const count = 1500;
    const nodes = Array.from({ length: count }, (_, index) =>
      node(`node-${index}`, { kind: 'group', parentId: index ? `node-${index - 1}` : undefined }),
    );
    const updates: Array<[number, string]> = [];
    const result = serializeVisio(scene(nodes), (percent, phase) => updates.push([percent, phase]));
    expect(result.nodeCount).toBe(count);
    expect(result.bytes.byteLength).toBeLessThan(exchangeLimits.bytes);
    expect(updates.at(-1)).toEqual([100, 'packaging']);
    expect(
      updates.every(([percent], index) => index === 0 || percent >= updates[index - 1][0]),
    ).toBe(true);
  });
});
