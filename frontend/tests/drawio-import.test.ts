import { deflateSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { parseDrawio } from '../src/imports/diagram/drawio';
import { diagramImportLimits } from '../src/imports/diagram/types';
import { validateGraph } from '../src/model/validation';

const model = (cells: string) =>
  `<mxGraphModel grid="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const vertex = (id: string, value = id, options = '') =>
  `<mxCell id="${id}" value="${value}" vertex="1" parent="1" ${options}><mxGeometry x="100" y="120" width="160" height="70" as="geometry"/></mxCell>`;
const edge = (id: string, options = '') =>
  `<mxCell id="${id}" source="a" target="b" edge="1" parent="1" ${options}><mxGeometry relative="1" as="geometry"/></mxCell>`;
const mxfile = (xml: string, name = 'Overview') =>
  `<mxfile><diagram id="p1" name="${name}">${xml}</diagram></mxfile>`;
function compress(xml: string): string {
  const bytes = deflateSync(new TextEncoder().encode(encodeURIComponent(xml)));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

describe('draw.io diagram import', () => {
  it('imports a bare native model with editable geometry and stable source IDs', () => {
    const xml = model(
      vertex('a', 'Customer', 'style="fillColor=#dae8fc;"') +
        vertex('b', 'Decision', 'style="rhombus;"') +
        edge('e1', 'value="reviews"'),
    );
    const first = parseDrawio(xml, 'workflow.drawio');
    const again = parseDrawio(xml, 'workflow.drawio');
    const graph = first.pages[0].graph;
    expect(first.format).toBe('drawio');
    expect(first.pages[0]).toMatchObject({ id: 'page-1', name: 'workflow', warnings: [] });
    expect(graph.diagram.type).toBe('freeform');
    expect(graph.nodes[0]).toMatchObject({
      title: 'Customer',
      x: 100,
      y: 120,
      width: 160,
      height: 70,
      color: '#dae8fc',
      externalId: 'drawio:page-1:a',
    });
    expect(graph.nodes[1].nodeType).toBe('decision');
    expect(graph.edges[0]).toMatchObject({
      sourceNodeId: graph.nodes[0].id,
      targetNodeId: graph.nodes[1].id,
      label: 'reviews',
      direction: 'forward',
      style: 'solid',
    });
    expect(again.pages[0].graph.nodes.map((node) => node.externalId)).toEqual(
      graph.nodes.map((node) => node.externalId),
    );
    expect(again.pages[0].graph.diagram.id).not.toBe(graph.diagram.id);
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('reads compressed, uncompressed and escaped XML pages in one file', () => {
    const xml = model(vertex('a', 'Hej räksmörgås &amp; 日本語'));
    const escaped = xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const result = parseDrawio(
      `<mxfile><diagram id="plain" name="Plain">${xml}</diagram><diagram id="compressed" name="Compressed">${compress(xml)}</diagram><diagram id="escaped" name="Escaped">${escaped}</diagram></mxfile>`,
      'multipage.drawio',
    );
    expect(result.pages.map((page) => page.name)).toEqual(['Plain', 'Compressed', 'Escaped']);
    expect(result.pages.map((page) => page.graph.nodes[0].title)).toEqual([
      'Hej räksmörgås & 日本語',
      'Hej räksmörgås & 日本語',
      'Hej räksmörgås & 日本語',
    ]);
    expect(new Set(result.pages.map((page) => page.graph.nodes[0].externalId)).size).toBe(3);
    for (const page of result.pages) expect(() => validateGraph(page.graph)).not.toThrow();
  });

  it('converts nested group coordinates to absolute native positions', () => {
    const xml = model(
      `<mxCell id="outer" value="Outer" style="swimlane;" vertex="1" parent="1"><mxGeometry x="200" y="300" width="700" height="400"/></mxCell><mxCell id="inner" value="Inner" style="group;" vertex="1" parent="outer"><mxGeometry x="30" y="40" width="400" height="250"/></mxCell><mxCell id="a" value="Database" style="shape=cylinder3;" vertex="1" parent="inner"><mxGeometry x="50" y="60" width="160" height="70"/></mxCell>`,
    );
    const graph = parseDrawio(mxfile(xml), 'groups.drawio').pages[0].graph;
    const [outer, inner, node] = graph.nodes;
    expect(outer).toMatchObject({ nodeType: 'group', x: 200, y: 300 });
    expect(inner).toMatchObject({ nodeType: 'group', parentId: outer.id, x: 230, y: 340 });
    expect(node).toMatchObject({ nodeType: 'database', parentId: inner.id, x: 280, y: 400 });
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('supports relative vertex coordinates and pixel offsets', () => {
    const xml = model(
      `<mxCell id="group" style="group;" vertex="1" parent="1"><mxGeometry x="100" y="200" width="400" height="300"/></mxCell><mxCell id="a" value="Port" vertex="1" parent="group"><mxGeometry x="0.5" y="1" width="80" height="40" relative="1"><mxPoint x="-40" y="-20" as="offset"/></mxGeometry></mxCell>`,
    );
    expect(parseDrawio(mxfile(xml), 'ports.drawio').pages[0].graph.nodes[1]).toMatchObject({
      x: 260,
      y: 480,
      width: 80,
      height: 40,
    });
  });

  it('unwraps UserObject labels, preserves safe links and attaches edge labels to connectors', () => {
    const xml = model(
      `<UserObject id="a" label="Customer &amp; team" link="https://example.com/customer"><mxCell vertex="1" parent="1"><mxGeometry width="160" height="70"/></mxCell></UserObject>` +
        vertex('b') +
        edge('e1', 'value="main"') +
        `<mxCell id="edge-label" value="extra" vertex="1" parent="e1"><mxGeometry relative="1"/></mxCell>`,
    );
    const graph = parseDrawio(mxfile(xml), 'objects.drawio').pages[0].graph;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({
      title: 'Customer & team',
      url: 'https://example.com/customer',
      externalId: 'drawio:p1:a',
    });
    expect(graph.edges[0].label).toBe('main · extra');
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it.each([
    ['startArrow=none;endArrow=none;', 'none'],
    ['startArrow=classic;endArrow=none;', 'backward'],
    ['startArrow=none;endArrow=classic;', 'forward'],
    ['startArrow=classic;endArrow=classic;', 'both'],
    ['', 'forward'],
  ])('maps arrow markers %s to %s', (style, direction) => {
    const graph = parseDrawio(
      model(vertex('a') + vertex('b') + edge('e1', `style="${style}"`)),
      'arrows.drawio',
    ).pages[0].graph;
    expect(graph.edges[0].direction).toBe(direction);
  });

  it('preserves dashed/dotted semantics and safe connector appearance metadata', () => {
    const graph = parseDrawio(
      model(
        vertex('a') +
          vertex('b') +
          edge('dash', 'style="dashed=1;strokeColor=#112233;strokeWidth=3;"') +
          edge('dot', 'style="dashed=1;dashPattern=1 3;strokeColor=red;"'),
      ),
      'styles.drawio',
    ).pages[0].graph;
    expect(graph.edges[0]).toMatchObject({
      style: 'dashed',
      metadata: {
        diagramImport: {
          format: 'drawio',
          sourceId: 'dash',
          strokeColor: '#112233',
          strokeWidth: 3,
        },
      },
    });
    expect(graph.edges[1].style).toBe('dotted');
    expect(graph.edges[1].metadata.diagramImport).toMatchObject({
      strokeColor: expect.any(String),
    });
  });

  it('never fabricates endpoint nodes for unattached or missing connectors', () => {
    const xml = model(
      vertex('a') +
        `<mxCell id="missing" source="a" target="absent" edge="1" parent="1"><mxGeometry relative="1"/></mxCell><mxCell id="loose" edge="1" parent="1"><mxGeometry relative="1"><mxPoint x="1" y="2" as="sourcePoint"/><mxPoint x="3" y="4" as="targetPoint"/></mxGeometry></mxCell>`,
    );
    const page = parseDrawio(xml, 'dangling.drawio').pages[0];
    expect(page.graph.nodes).toHaveLength(1);
    expect(page.graph.edges).toHaveLength(0);
    expect(page.warnings).toContain(
      'Connectors with missing or unattached endpoints were omitted.',
    );
  });

  it('does not interpret HTML, scripts, image URLs or unsafe links as executable content', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const xml = model(
        vertex(
          'a',
          '&lt;b onclick=&quot;alert(1)&quot;&gt;Hello&lt;/b&gt;&lt;br&gt;World&lt;script&gt;alert(2)&lt;/script&gt;',
          'style="html=1;shape=image;image=https://evil.test/tracker;fillColor=url(javascript:evil);" link="javascript:alert(3)"',
        ),
      );
      const page = parseDrawio(xml, 'safe.drawio').pages[0];
      expect(page.graph.nodes[0].title).toBe('Hello\nWorld');
      expect(page.graph.nodes[0].url).toBeUndefined();
      expect(page.graph.nodes[0].color).toBeUndefined();
      expect(JSON.stringify(page.graph)).not.toContain('evil.test');
      expect(JSON.stringify(page.graph)).not.toContain('onclick');
      expect(fetch).not.toHaveBeenCalled();
      expect(page.warnings).toEqual(
        expect.arrayContaining([
          'Rich text labels were converted to plain text.',
          'Images were imported as labeled nodes; image contents were not imported.',
          'Unsupported or unsafe links were omitted.',
        ]),
      );
      expect(() => validateGraph(page.graph)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('warns when unsupported shape geometry is simplified', () => {
    const xml = model(
      vertex('a', 'Custom', 'style="shape=mxgraph.aws4.ec2;rotation=30;flipH=1;"') +
        vertex('b') +
        `<mxCell id="e" source="a" target="b" edge="1"><mxGeometry relative="1"><Array as="points"><mxPoint x="300" y="400"/></Array></mxGeometry></mxCell>`,
    );
    const page = parseDrawio(xml, 'custom.drawio').pages[0];
    expect(page.graph.nodes[0].nodeType).toBe('generic');
    expect(page.warnings).toEqual(
      expect.arrayContaining([
        'Custom shapes were mapped to editable Visual Nerve nodes.',
        'Rotated shapes were imported without rotation.',
        'Flipped shapes were imported without mirroring.',
        'Manual connector routes were replaced by Visual Nerve routing.',
      ]),
    );
  });

  it('reports that hidden source layers and objects become visible native objects', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0" visible="0"/>' +
      vertex('a', 'Hidden layer object') +
      vertex('b', 'Hidden object', 'visible="0"') +
      edge('e1', 'visible="0"') +
      '</root></mxGraphModel>';
    const page = parseDrawio(xml, 'hidden.drawio').pages[0];
    expect(page.graph.nodes.map((node) => node.title)).toEqual([
      'Hidden layer object',
      'Hidden object',
    ]);
    expect(page.graph.edges).toHaveLength(1);
    expect(
      page.warnings.filter(
        (warning) => warning === 'Hidden source layers/objects are imported as visible objects.',
      ),
    ).toHaveLength(1);
    expect(() => validateGraph(page.graph)).not.toThrow();
  });

  it('normalizes undersized or invalid geometry while returning a valid graph', () => {
    const xml = model(
      `<mxCell id="a" value="Small" vertex="1" parent="1"><mxGeometry x="NaN" y="Infinity" width="0" height="2"/></mxCell>`,
    );
    const page = parseDrawio(xml, 'geometry.drawio').pages[0];
    expect(page.graph.nodes[0]).toMatchObject({ x: 0, y: 0, width: 40, height: 30 });
    expect(page.warnings).toHaveLength(2);
    expect(() => validateGraph(page.graph)).not.toThrow();
  });

  it.each([
    ['<html><body>wrong file</body></html>', /mxfile or mxGraphModel/],
    ['<mxfile/>', /no diagram pages/],
    ['<mxGraphModel/>', /no graph root/],
    [
      mxfile(
        '<mxGraphModel><root><mxCell id="a" vertex="1"/><mxCell id="a" vertex="1"/></root></mxGraphModel>',
      ),
      /Duplicate draw.io cell/,
    ],
    [mxfile('<mxGraphModel><root><mxCell vertex="1"/></root></mxGraphModel>'), /no source ID/],
    ['<mxfile><diagram id="p"/><diagram id="p"/></mxfile>', /Base64/],
    ['<mxfile><diagram id="p">bad!</diagram></mxfile>', /Base64/],
    ['<mxfile><diagram id="p">AAAA</diagram></mxfile>', /DEFLATE|encoded XML|XML/],
  ])('rejects invalid draw.io input', (xml, expected) => {
    expect(() => parseDrawio(xml, 'invalid.drawio')).toThrow(expected);
  });

  it('rejects duplicate page IDs before importing ambiguous pages', () => {
    const xml = model(vertex('a'));
    expect(() =>
      parseDrawio(
        `<mxfile><diagram id="same">${xml}</diagram><diagram id="same">${xml}</diagram></mxfile>`,
        'duplicate.drawio',
      ),
    ).toThrow(/duplicate page IDs/);
  });

  it('rejects group cycles', () => {
    const xml = model(
      `<mxCell id="a" vertex="1" parent="b"><mxGeometry width="100" height="80"/></mxCell><mxCell id="b" vertex="1" parent="a"><mxGeometry width="100" height="80"/></mxCell>`,
    );
    expect(() => parseDrawio(xml, 'cycle.drawio')).toThrow(/cyclic groups/);
  });

  it('bounds group depth even when parents were already resolved', () => {
    const cells = Array.from(
      { length: diagramImportLimits.xmlDepth + 2 },
      (_, index) =>
        `<mxCell id="group-${index}" style="group;" vertex="1" parent="${index ? `group-${index - 1}` : '1'}"><mxGeometry width="100" height="80"/></mxCell>`,
    ).join('');
    expect(() => parseDrawio(model(cells), 'deep.drawio')).toThrow(/group nesting exceeds/);
  });

  it('rejects ambiguous cells marked as both a shape and connector', () => {
    expect(() =>
      parseDrawio(model('<mxCell id="a" vertex="1" edge="1"/>'), 'ambiguous.drawio'),
    ).toThrow(/both a shape and a connector/);
  });

  it.each([
    '<!DOCTYPE mxGraphModel [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><mxGraphModel><root/></mxGraphModel>',
    '<mxGraphModel><root><mxCell id="a" value="&unknown;" vertex="1"/></root></mxGraphModel>',
    '<mxGraphModel><root></mxGraphModel>',
  ])('rejects unsafe or malformed XML before graph construction', (xml) => {
    expect(() => parseDrawio(xml, 'unsafe.drawio')).toThrow();
  });

  it('rejects files with too many pages', () => {
    const xml = model('');
    const pages = Array.from(
      { length: diagramImportLimits.pages + 1 },
      (_, index) => `<diagram id="${index}">${xml}</diagram>`,
    ).join('');
    expect(() => parseDrawio(`<mxfile>${pages}</mxfile>`, 'pages.drawio')).toThrow(
      /page import limit/,
    );
  });

  it('enforces the total object budget before constructing the next page graph', () => {
    const cells = Array.from({ length: 10_001 }, (_, index) => vertex(`node-${index}`)).join('');
    const xml = model(cells);
    expect(() =>
      parseDrawio(
        `<mxfile><diagram id="first">${xml}</diagram><diagram id="second">${xml}</diagram></mxfile>`,
        'many-nodes.drawio',
      ),
    ).toThrow(/20,000 nodes and 40,000 connections in total/);
  });

  it('enforces the total connector budget across pages', () => {
    const cells =
      vertex('a') +
      vertex('b') +
      Array.from({ length: 20_001 }, (_, index) => edge(`edge-${index}`)).join('');
    const xml = model(cells);
    expect(() =>
      parseDrawio(
        `<mxfile><diagram id="first">${xml}</diagram><diagram id="second">${xml}</diagram></mxfile>`,
        'many-edges.drawio',
      ),
    ).toThrow(/20,000 nodes and 40,000 connections in total/);
  });

  it('can parse without DOMParser in a worker-compatible environment', () => {
    vi.stubGlobal('DOMParser', undefined);
    try {
      expect(parseDrawio(model(vertex('a')), 'worker.drawio').pages[0].graph.nodes).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps literal markup when HTML labels are disabled', () => {
    const graph = parseDrawio(
      model(
        vertex('a', 'Use &lt;title&gt; here', 'style="html=0;"') +
          vertex('b') +
          edge('e1', 'value="x &lt; y &gt; z" style="html=0;"'),
      ),
      'literal.drawio',
    ).pages[0].graph;
    expect(graph.nodes[0].title).toBe('Use <title> here');
    expect(graph.edges[0].label).toBe('x < y > z');
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('shortens long labels and page names to valid native limits', () => {
    const page = parseDrawio(
      mxfile(model(vertex('a', 'x'.repeat(1100))), 'n'.repeat(600)),
      'long.drawio',
    ).pages[0];
    expect(page.name).toHaveLength(500);
    expect(page.graph.nodes[0].title).toHaveLength(1000);
    expect(page.warnings).toEqual(
      expect.arrayContaining([
        'Labels longer than 1,000 characters were shortened.',
        'Labels longer than 500 characters were shortened.',
      ]),
    );
    expect(() => validateGraph(page.graph)).not.toThrow();
  });

  it('stops a compressed page before exceeding the expanded output budget', () => {
    const original = diagramImportLimits.expandedBytes;
    Object.assign(diagramImportLimits, { expandedBytes: 4096 });
    try {
      const xml = model(vertex('a', 'x'.repeat(20_000)));
      expect(() => parseDrawio(mxfile(compress(xml)), 'bomb.drawio')).toThrow(
        /expanded draw.io file exceeds/,
      );
    } finally {
      Object.assign(diagramImportLimits, { expandedBytes: original });
    }
  });

  it('applies the expanded budget cumulatively across compressed pages', () => {
    const xml = model(vertex('a', 'x'.repeat(800)));
    const compressed = compress(xml);
    const input = `<mxfile><diagram id="first">${compressed}</diagram><diagram id="second">${compressed}</diagram></mxfile>`;
    const original = diagramImportLimits.expandedBytes;
    Object.assign(diagramImportLimits, {
      expandedBytes: new TextEncoder().encode(input).length + encodeURIComponent(xml).length + 100,
    });
    try {
      expect(() => parseDrawio(input, 'cumulative.drawio')).toThrow(
        /expanded draw.io file exceeds/,
      );
    } finally {
      Object.assign(diagramImportLimits, { expandedBytes: original });
    }
  });
});
