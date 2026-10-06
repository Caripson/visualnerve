import { describe, expect, it } from 'vitest';
import { parseVsdx } from '../src/imports/diagram/vsdx';
import { VisioPackage } from '../src/imports/diagram/vsdx-zip';
import { validateGraph } from '../src/model/validation';
import { visioPackageParts, visioRels, visioXml, vsdxFixture } from './fixtures/vsdx';

const cell = (name: string, value: string | number) => `<Cell N="${name}" V="${value}"/>`;
function withMaster(parts: Record<string, string>, contents: string, name = 'Process') {
  parts['visio/_rels/document.xml.rels'] = visioRels([
    ['rPages', 'pages', 'pages/pages.xml'],
    ['rMasters', 'masters', 'masters/masters.xml'],
  ]);
  parts['visio/masters/masters.xml'] = visioXml(
    'Masters',
    `<Master ID="99" NameU="${name}"><Rel r:id="rMaster"/></Master>`,
  );
  parts['visio/masters/_rels/masters.xml.rels'] = visioRels([
    ['rMaster', 'master', 'master17.xml'],
  ]);
  parts['visio/masters/master17.xml'] = visioXml('MasterContents', `<Shapes>${contents}</Shapes>`);
  return parts;
}
function zipHeaders(
  bytes: Uint8Array,
  callback: (view: DataView, offset: number, central: boolean) => void,
) {
  const result = bytes.slice();
  const view = new DataView(result.buffer);
  for (let offset = 0; offset + 46 <= result.length; offset++) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50 || signature === 0x02014b50)
      callback(view, offset, signature === 0x02014b50);
  }
  return result;
}
function multiPage(contents: string[]) {
  const parts = visioPackageParts();
  parts['visio/pages/pages.xml'] = visioXml(
    'Pages',
    contents
      .map(
        (_, index) =>
          `<Page ID="${index}"><PageSheet>${cell('PageHeight', 10)}</PageSheet><Rel r:id="r${index}"/></Page>`,
      )
      .join(''),
  );
  parts['visio/pages/_rels/pages.xml.rels'] = visioRels(
    contents.map((_, index) => [`r${index}`, 'page', `page${index}.xml`]),
  );
  contents.forEach((content, index) => {
    parts[`visio/pages/page${index}.xml`] = content;
  });
  return vsdxFixture(parts);
}

describe('Visio .vsdx structural import', () => {
  it('reads OPC page relationships, page names, editable geometry and mixed text', () => {
    const parts = visioPackageParts(
      `<Shapes><Shape ID="8" NameU="Process"><Cell N="PinX" V="2"/><Cell N="PinY" V="3"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Order<cp IX="0"/> &amp; delivery\nSecond line</Text></Shape></Shapes>`,
    );
    const result = parseVsdx(vsdxFixture(parts), 'example.vsdx');
    expect(result.format).toBe('vsdx');
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page).toMatchObject({ id: '7', name: 'Operations' });
    expect(page.graph.diagram.name).toBe('Operations');
    expect(page.graph.nodes[0]).toMatchObject({
      title: 'Order & delivery\nSecond line',
      x: 96,
      y: 624,
      width: 192,
      height: 96,
      externalId: 'vsdx:8',
      nodeType: 'process',
    });
    expect(() => validateGraph(page.graph)).not.toThrow();
  });

  it('keeps separately named pages and follows nonconsecutive relationship targets', () => {
    const parts = visioPackageParts();
    parts['visio/pages/pages.xml'] = visioXml(
      'Pages',
      `<Page ID="7" Name="First"><PageSheet>${cell('PageHeight', 10)}</PageSheet><Rel r:id="rA"/></Page><Page ID="31" Name="Second"><PageSheet>${cell('PageHeight', 12)}</PageSheet><Rel r:id="rB"/></Page>`,
    );
    parts['visio/pages/_rels/pages.xml.rels'] = visioRels([
      ['rA', 'page', 'page42.xml'],
      ['rB', 'page', 'nested/custom.xml'],
    ]);
    parts['visio/pages/nested/custom.xml'] = visioXml(
      'PageContents',
      `<Shapes><Shape ID="1"><Text>Second page node</Text></Shape></Shapes>`,
    );
    const result = parseVsdx(vsdxFixture(parts), 'pages.vsdx');
    expect(result.pages.map((page) => [page.id, page.name, page.graph.nodes[0].title])).toEqual([
      ['7', 'First', 'Hello'],
      ['31', 'Second', 'Second page node'],
    ]);
    expect(new Set(result.pages.map((page) => page.graph.diagram.id)).size).toBe(2);
  });

  it('inherits master cached cells and document styles while keeping local overrides', () => {
    const parts = withMaster(
      visioPackageParts(
        '<Shapes><Shape ID="12" Master="99">' +
          cell('PinX', 4) +
          cell('PinY', 5) +
          cell('FillForegnd', '#112233') +
          '</Shape></Shapes>',
      ),
      `<Shape ID="0" FillStyle="5">${cell('Width', 2)}${cell('Height', 1)}<Text>Inherited label</Text></Shape>`,
    );
    parts['visio/document.xml'] = visioXml(
      'VisioDocument',
      `<StyleSheets><StyleSheet ID="5">${cell('FillForegnd', '#aabbcc')}${cell('LineColor', '#445566')}</StyleSheet></StyleSheets>`,
    );
    const node = parseVsdx(vsdxFixture(parts), 'inherited.vsdx').pages[0].graph.nodes[0];
    expect(node).toMatchObject({
      title: 'Inherited label',
      nodeType: 'process',
      x: 288,
      y: 432,
      width: 192,
      height: 96,
      color: '#112233',
      metadata: { diagramImport: { strokeColor: '#445566' } },
    });
  });

  it('preserves nested group membership in absolute page coordinates', () => {
    const parts = visioPackageParts(
      `<Shapes><Shape ID="1" Type="Group" NameU="Area">${cell('PinX', 4)}${cell('PinY', 5)}${cell('Width', 4)}${cell('Height', 2)}<Shapes><Shape ID="2">${cell('PinX', 1)}${cell('PinY', 0.5)}${cell('Width', 1)}${cell('Height', 0.5)}<Text>Child</Text></Shape></Shapes></Shape></Shapes>`,
    );
    const graph = parseVsdx(vsdxFixture(parts), 'groups.vsdx').pages[0].graph;
    expect(graph.nodes[0]).toMatchObject({
      nodeType: 'group',
      x: 192,
      y: 384,
      width: 384,
      height: 192,
    });
    expect(graph.nodes[1]).toMatchObject({
      parentId: graph.nodes[0].id,
      x: 240,
      y: 504,
      width: 96,
      height: 48,
    });
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('inherits master subshapes and scales their cells when the master group is resized', () => {
    const contents = `<Shape ID="0" Type="Group">${cell('Width', 2)}${cell('Height', 1)}<Shapes><Shape ID="5">${cell('PinX', 0.5)}${cell('PinY', 0.5)}${cell('Width', 0.5)}${cell('Height', 0.5)}<Text>Inherited child</Text></Shape></Shapes></Shape>`;
    const parts = withMaster(
      visioPackageParts(
        `<Shapes><Shape ID="30" Master="99">${cell('PinX', 4)}${cell('PinY', 5)}${cell('Width', 4)}${cell('Height', 2)}</Shape></Shapes>`,
      ),
      contents,
      'Group',
    );
    const graph = parseVsdx(vsdxFixture(parts), 'master-groups.vsdx').pages[0].graph;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1]).toMatchObject({
      title: 'Inherited child',
      externalId: 'vsdx:30:master:5',
      parentId: graph.nodes[0].id,
      x: 240,
      y: 432,
      width: 96,
      height: 96,
    });
  });

  it('maps a page subshape MasterShape to its inherited master child without duplicates', () => {
    const contents = `<Shape ID="0" Type="Group">${cell('Width', 2)}${cell('Height', 1)}<Shapes><Shape ID="5">${cell('PinX', 0.5)}${cell('PinY', 0.5)}${cell('Width', 0.5)}${cell('Height', 0.5)}<Text>Inherited child</Text></Shape></Shapes></Shape>`;
    const parts = withMaster(
      visioPackageParts(
        `<Shapes><Shape ID="30" Master="99">${cell('PinX', 4)}${cell('PinY', 5)}${cell('Width', 4)}${cell('Height', 2)}<Shapes><Shape ID="31" MasterShape="5">${cell('PinX', 2)}<Text>Override</Text></Shape></Shapes></Shape></Shapes>`,
      ),
      contents,
      'Group',
    );
    const graph = parseVsdx(vsdxFixture(parts), 'override.vsdx').pages[0].graph;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1]).toMatchObject({
      title: 'Override',
      externalId: 'vsdx:31',
      x: 336,
      width: 96,
    });
  });

  it('preserves connector endpoints, labels, arrows, color, width and dashed line style', () => {
    const parts = visioPackageParts(
      `<Shapes><Shape ID="1"><Text>Start</Text></Shape><Shape ID="2">${cell('PinX', 6)}<Text>End</Text></Shape><Shape ID="3" OneD="1">${cell('BeginArrow', 1)}${cell('EndArrow', 4)}${cell('LinePattern', 2)}${cell('LineColor', '#aa2233')}${cell('LineWeight', 0.02)}<Text>delivers</Text></Shape></Shapes><Connects><Connect FromSheet="3" FromCell="EndX" ToSheet="2"/><Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/></Connects>`,
    );
    const graph = parseVsdx(vsdxFixture(parts), 'edges.vsdx').pages[0].graph;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      sourceNodeId: graph.nodes[0].id,
      targetNodeId: graph.nodes[1].id,
      label: 'delivers',
      direction: 'both',
      style: 'dashed',
      metadata: { diagramImport: { strokeColor: '#aa2233', strokeWidth: 1.92 } },
    });
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('omits dangling decorative or ambiguous connectors with a useful warning', () => {
    const result = parseVsdx(
      vsdxFixture(
        visioPackageParts(
          `<Shapes><Shape ID="1"><Text>Present</Text></Shape><Shape ID="3" OneD="1"><Text>Missing</Text></Shape></Shapes><Connects><Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="3" FromCell="EndX" ToSheet="100"/></Connects>`,
        ),
      ),
      'dangling.vsdx',
    );
    expect(result.pages[0].graph.edges).toHaveLength(0);
    expect(result.pages[0].warnings.join(' ')).toMatch(/missing.*endpoints/i);
  });

  it('transforms flipped and rotated group coordinates without mirroring labels', () => {
    const result = parseVsdx(
      vsdxFixture(
        visioPackageParts(
          `<Shapes><Shape ID="1" Type="Group">${cell('PinX', 4)}${cell('PinY', 5)}${cell('Width', 4)}${cell('Height', 2)}${cell('FlipX', 1)}${cell('Angle', Math.PI / 2)}<Shapes><Shape ID="2">${cell('PinX', 1)}${cell('PinY', 0.5)}${cell('Width', 1)}${cell('Height', 0.5)}<Text>Readable</Text></Shape></Shapes></Shape></Shapes>`,
        ),
      ),
      'rotated.vsdx',
    );
    const node = result.pages[0].graph.nodes[1];
    expect(node.title).toBe('Readable');
    expect(node.x).toBeCloseTo(408);
    expect(node.y).toBeCloseTo(336);
    expect(node.width).toBeCloseTo(48);
    expect(node.height).toBeCloseTo(96);
    expect(result.pages[0].warnings.join(' ')).toMatch(/rotated.*flipped/i);
  });

  it('uses safe document palette and RGB literal colors', () => {
    const parts = visioPackageParts(
      `<Shapes><Shape ID="1">${cell('FillForegnd', 20)}<Text>Palette</Text></Shape><Shape ID="2">${cell('FillForegnd', 'RGB(1, 2, 255)')}<Text>RGB</Text></Shape></Shapes>`,
    );
    parts['visio/document.xml'] = visioXml(
      'VisioDocument',
      '<Colors><ColorEntry IX="20" RGB="#abcdef"/></Colors>',
    );
    expect(
      parseVsdx(vsdxFixture(parts), 'colors.vsdx').pages[0].graph.nodes.map((node) => node.color),
    ).toEqual(['#abcdef', '#0102ff']);
  });

  it('does not fetch external relationships, evaluate formulas, or import macro/media bytes', () => {
    const parts = visioPackageParts();
    parts['visio/pages/_rels/page42.xml.rels'] =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rExternal" Type="http://schemas.microsoft.com/visio/2010/relationships/image" Target="https://example.com/image.png" TargetMode="External"/></Relationships>';
    parts['visio/vbaProject.bin'] = 'not XML, ignored';
    const result = parseVsdx(vsdxFixture(parts), 'safe.vsdx');
    expect(result.pages[0].graph.nodes).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/not fetched/);
    expect(result.warnings.join(' ')).toMatch(/not imported or executed/);
  });

  it.each([
    ['traversal', () => vsdxFixture({ ...visioPackageParts(), '../outside.xml': 'bad' })],
    [
      'encrypted',
      () =>
        zipHeaders(vsdxFixture(), (view, offset, central) =>
          view.setUint16(
            offset + (central ? 8 : 6),
            view.getUint16(offset + (central ? 8 : 6), true) | 1,
            true,
          ),
        ),
    ],
    [
      'misdeclared expansion',
      () =>
        zipHeaders(vsdxFixture(), (view, offset, central) =>
          view.setUint32(offset + (central ? 24 : 22), 0, true),
        ),
    ],
    [
      'expanded limit',
      () =>
        zipHeaders(vsdxFixture(), (view, offset, central) =>
          view.setUint32(offset + (central ? 24 : 22), 65 * 1024 * 1024, true),
        ),
    ],
    [
      'DTD',
      () =>
        vsdxFixture({
          ...visioPackageParts(),
          'visio/pages/page42.xml':
            '<!DOCTYPE PageContents [<!ENTITY ex SYSTEM "file:///etc/passwd">]><PageContents>&ex;</PageContents>',
        }),
    ],
    [
      'invalid XML',
      () =>
        vsdxFixture({
          ...visioPackageParts(),
          'visio/pages/page42.xml': '<PageContents><Shapes></PageContents>',
        }),
    ],
    [
      'relationship escape',
      () =>
        vsdxFixture({
          ...visioPackageParts(),
          'visio/pages/_rels/pages.xml.rels': visioRels([
            ['rActual', 'page', '../../../outside.xml'],
          ]),
        }),
    ],
  ] as const)('rejects %s before producing any graph', (_name, bytes) => {
    expect(() => parseVsdx(bytes(), 'unsafe.vsdx')).toThrow();
  });

  it('rejects cyclic master references and style references', () => {
    const parts = withMaster(
      visioPackageParts('<Shapes><Shape ID="1" Master="99"/></Shapes>'),
      '<Shape ID="0" Master="99"/>',
    );
    expect(() => parseVsdx(vsdxFixture(parts), 'cycle.vsdx')).toThrow(/cycle/);
    const styles = visioPackageParts('<Shapes><Shape ID="1" FillStyle="1"/></Shapes>');
    styles['visio/document.xml'] = visioXml(
      'VisioDocument',
      '<StyleSheets><StyleSheet ID="1" FillStyle="2"/><StyleSheet ID="2" FillStyle="1"/></StyleSheets>',
    );
    expect(() => parseVsdx(vsdxFixture(styles), 'cycle.vsdx')).toThrow(/cycle/);
  });

  it('rejects a damaged ZIP checksum and oversized source file', () => {
    const bytes = zipHeaders(vsdxFixture(), (view, offset, central) =>
      view.setUint32(offset + (central ? 16 : 14), 0, true),
    );
    expect(() => parseVsdx(bytes, 'bad.vsdx')).toThrow(/checksum/);
    expect(() => parseVsdx(new Uint8Array(1001), 'huge.vsdx', 1000)).toThrow(/exceeds/);
  });

  it('rejects too many ZIP entries, pages, or native nodes with explicit limits', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 2049 }, (_, index) => [`part${index}.xml`, '']),
    );
    expect(() => parseVsdx(vsdxFixture(entries), 'entries.vsdx')).toThrow(/2,048 entries/);
    const pages = visioPackageParts();
    pages['visio/pages/pages.xml'] = visioXml(
      'Pages',
      Array.from({ length: 101 }, (_, index) => `<Page ID="${index}"/>`).join(''),
    );
    expect(() => parseVsdx(vsdxFixture(pages), 'pages.vsdx')).toThrow(/100 pages/);
    const shapes = Array.from({ length: 20001 }, (_, index) => `<Shape ID="${index}"/>`).join('');
    expect(() =>
      parseVsdx(vsdxFixture(visioPackageParts(`<Shapes>${shapes}</Shapes>`)), 'nodes.vsdx'),
    ).toThrow(/20,000 nodes/);
  });

  it('rejects duplicate page shape IDs instead of creating ambiguous relationships', () => {
    const bytes = vsdxFixture(visioPackageParts('<Shapes><Shape ID="1"/><Shape ID="1"/></Shapes>'));
    expect(() => parseVsdx(bytes, 'duplicates.vsdx')).toThrow(/unique/);
  });

  it('enforces the node budget across pages before reading later page contents', () => {
    const page = visioXml(
      'PageContents',
      `<Shapes>${Array.from({ length: 10001 }, (_, index) => `<Shape ID="${index}"/>`).join('')}</Shapes>`,
    );
    const bytes = multiPage([page, page, 'This third page must never be parsed.']);
    expect(() => parseVsdx(bytes, 'many-pages.vsdx')).toThrow(/20,000 nodes in total/);
  });

  it('enforces the connection budget across pages before reading later page contents', () => {
    const page = (count: number) => {
      const ids = Array.from({ length: count }, (_, index) => index + 3);
      return visioXml(
        'PageContents',
        `<Shapes><Shape ID="1"/><Shape ID="2"/>${ids.map((id) => `<Shape ID="${id}" OneD="1"/>`).join('')}</Shapes><Connects>${ids.map((id) => `<Connect FromSheet="${id}" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="${id}" FromCell="EndX" ToSheet="2"/>`).join('')}</Connects>`,
      );
    };
    const bytes = multiPage([page(20000), page(20001), 'This third page must never be parsed.']);
    expect(() => parseVsdx(bytes, 'many-edges.vsdx')).toThrow(/40,000 connections in total/);
  });

  it('requires an EOCD inside the valid ZIP comment range with a matching length', () => {
    const bytes = new Uint8Array(70_000);
    const view = new DataView(bytes.buffer);
    const offset = bytes.length - 65_558;
    view.setUint32(offset, 0x06054b50, true);
    view.setUint32(offset + 16, offset, true);
    expect(() => new VisioPackage(bytes)).toThrow(/ZIP/);
  });
});
