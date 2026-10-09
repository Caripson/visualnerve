import { strToU8, zipSync } from 'fflate';
import {
  ExchangeExportError,
  exchangeLimits,
  type ExchangeNode,
  type ExchangeProgress,
  type ExchangeResult,
  type ExchangeScene,
} from './exchange-types';
import { exchangeXML, ExchangeXmlWriter } from './exchange-xml';
import {
  VisioShapeWriter,
  visioCell,
  visioInches,
  type VisioPageGeometry,
} from './exchange-visio-shapes';

const core = 'http://schemas.microsoft.com/office/visio/2012/main';
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const visioRelationships = 'http://schemas.microsoft.com/visio/2010/relationships';
const declaration = '<?xml version="1.0" encoding="utf-8"?>';
const xml = (name: string, content: string) =>
  `${declaration}<${name} xmlns="${core}" xmlns:r="${officeRelationships}" xml:space="preserve">${content}</${name}>`;
const rels = (values: Array<[string, string, string]>) =>
  `${declaration}<Relationships xmlns="${packageRelationships}">${values.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;

/** OPC and native ShapeSheet serialization; Microsoft Visio acceptance remains preview. */
export function serializeVisio(scene: ExchangeScene, progress?: ExchangeProgress): ExchangeResult {
  const geometry = pageGeometry(scene);
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  if (byId.size !== scene.nodes.length)
    throw new ExchangeExportError('invalid_scene', 'Diagram node IDs must be unique.');
  const ids = new Map(scene.nodes.map((node, index) => [node.id, index + 1]));
  const children = new Map<string, ExchangeNode[]>();
  const roots: ExchangeNode[] = [];
  for (const node of scene.nodes) {
    if (node.parentId) {
      if (!byId.has(node.parentId))
        throw new ExchangeExportError(
          'invalid_scene',
          'A diagram group references a missing parent.',
        );
      const group = children.get(node.parentId) ?? [];
      group.push(node);
      children.set(node.parentId, group);
    } else roots.push(node);
  }
  const writer = new ExchangeXmlWriter();
  writer.write(
    `${declaration}<PageContents xmlns="${core}" xmlns:r="${officeRelationships}" xml:space="preserve"><Shapes>`,
  );
  const shapes = new VisioShapeWriter(writer, ids, geometry);
  const stack: Array<{ node: ExchangeNode; finish: boolean; nested?: boolean }> = roots
    .slice()
    .reverse()
    .map((node) => ({ node, finish: false }));
  let written = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.finish) {
      if (entry.nested) writer.write('</Shapes>');
      shapes.finishNode(entry.node);
      continue;
    }
    const nested = children.get(entry.node.id);
    shapes.node(
      entry.node,
      entry.node.parentId ? byId.get(entry.node.parentId) : undefined,
      entry.node.kind === 'group' || !!nested?.length,
    );
    stack.push({ node: entry.node, finish: true, nested: !!nested?.length });
    if (nested?.length) {
      writer.write('<Shapes>');
      for (let index = nested.length - 1; index >= 0; index--)
        stack.push({ node: nested[index], finish: false });
    }
    written++;
    if (written % 250 === 0 || written === scene.nodes.length)
      progress?.(30 + Math.round((35 * written) / Math.max(1, scene.nodes.length)), 'nodes');
  }
  if (written !== scene.nodes.length)
    throw new ExchangeExportError('invalid_scene', 'Cannot export cyclic node groups.');
  for (let index = 0; index < scene.edges.length; index++) {
    const edge = scene.edges[index],
      source = byId.get(edge.source),
      target = byId.get(edge.target);
    if (!source || !target)
      throw new ExchangeExportError(
        'invalid_scene',
        'A diagram connection references a missing node.',
      );
    shapes.edge(edge, source, target, scene.nodes.length + index + 1);
    if (index % 250 === 0 || index === scene.edges.length - 1)
      progress?.(65 + Math.round((20 * (index + 1)) / Math.max(1, scene.edges.length)), 'edges');
  }
  writer.write('</Shapes>');
  if (scene.edges.length) {
    writer.write('<Connects>');
    scene.edges.forEach((edge, index) =>
      writer.write(shapes.connect(edge, scene.nodes.length + index + 1)),
    );
    writer.write('</Connects>');
  }
  writer.write('</PageContents>');
  progress?.(90, 'packaging');
  const parts: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(packageParts(scene.name, geometry)).map(([path, value]) => [
      path,
      strToU8(value),
    ]),
  );
  parts['visio/pages/page1.xml'] = writer.bytes();
  const sourceBytes = Object.values(parts).reduce((sum, value) => sum + value.byteLength, 0);
  if (sourceBytes > exchangeLimits.bytes)
    throw new ExchangeExportError('output_too_large', 'The Visio export exceeds 64 MiB.');
  const bytes = zipSync(parts, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
  if (bytes.byteLength > exchangeLimits.bytes)
    throw new ExchangeExportError('output_too_large', 'The Visio export exceeds 64 MiB.');
  progress?.(100, 'packaging');
  return {
    format: 'vsdx',
    mimeType: 'application/vnd.ms-visio.drawing',
    bytes,
    nodeCount: scene.nodes.length,
    edgeCount: scene.edges.length,
    warnings: [
      ...scene.warnings,
      {
        code: 'VISIO_COMPATIBILITY_PREVIEW',
        message:
          'Visio export is a compatibility preview. Native shapes, text, groups and attached connectors are included; Microsoft Visio open, edit and save compatibility has not yet been verified.',
      },
    ],
  };
}

function pageGeometry(scene: ExchangeScene): VisioPageGeometry {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const node of scene.nodes) {
    if (
      ![node.x, node.y, node.width, node.height].every(Number.isFinite) ||
      node.width <= 0 ||
      node.height <= 0 ||
      [node.x, node.y, node.width, node.height].some(
        (value) => Math.abs(value) > exchangeLimits.dimension,
      )
    )
      throw new ExchangeExportError(
        'invalid_geometry',
        'Diagram node geometry must be finite and within the export limits.',
      );
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  if (!scene.nodes.length) return { x: 0, y: 0, width: 768, height: 576 };
  const geometry = {
    x: left - 40,
    y: top - 40,
    width: Math.max(96, right - left + 80),
    height: Math.max(96, bottom - top + 80),
  };
  if (geometry.width > exchangeLimits.dimension || geometry.height > exchangeLimits.dimension)
    throw new ExchangeExportError(
      'invalid_geometry',
      'The Visio page exceeds the export dimension limit.',
    );
  return geometry;
}

function packageParts(name: string, page: VisioPageGeometry): Record<string, string> {
  const cell = visioCell;
  return {
    '[Content_Types].xml': `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`,
    '_rels/.rels': rels([
      ['rDocument', `${visioRelationships}/document`, 'visio/document.xml'],
      ['rCore', `${packageRelationships}/metadata/core-properties`, 'docProps/core.xml'],
      ['rApp', `${officeRelationships}/extended-properties`, 'docProps/app.xml'],
      ['rCustom', `${officeRelationships}/custom-properties`, 'docProps/custom.xml'],
    ]),
    'docProps/core.xml': `${declaration}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${exchangeXML(name)}</dc:title><dc:creator>Visual Nerve</dc:creator></cp:coreProperties>`,
    'docProps/app.xml': `${declaration}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Visual Nerve</Application></Properties>`,
    'docProps/custom.xml': `${declaration}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="RecalcDocument"><vt:bool>true</vt:bool></property></Properties>`,
    'visio/document.xml': xml(
      'VisioDocument',
      `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"><GlueSettings>9</GlueSettings><SnapSettings>0</SnapSettings><ProtectShapes>0</ProtectShapes></DocumentSettings><Colors><ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#ffffff"/></Colors><FaceNames><FaceName NameU="Arial"/></FaceNames><StyleSheets><StyleSheet ID="0" NameU="Visual Nerve" Name="Visual Nerve">${cell('EnableLineProps', 1)}${cell('EnableFillProps', 1)}${cell('EnableTextProps', 1)}${cell('LineColor', '#334155')}${cell('LinePattern', 1)}${cell('LineWeight', visioInches(1.25))}${cell('FillForegnd', '#ffffff')}${cell('FillBkgnd', '#ffffff')}${cell('FillPattern', 1)}${cell('BeginArrow', 0)}${cell('EndArrow', 0)}${cell('ShdwPattern', 0)}${cell('HideText', 0)}${cell('VerticalAlign', 1)}<Section N="Character"><Row IX="0">${cell('Font', 'Arial')}${cell('Color', '#1f2937')}${cell('Size', 12 / 72)}${cell('Style', 0)}</Row></Section><Section N="Paragraph"><Row IX="0">${cell('HorzAlign', 1)}${cell('SpLine', -1.2)}</Row></Section></StyleSheet></StyleSheets><DocumentSheet NameU="TheDoc" LineStyle="0" FillStyle="0" TextStyle="0"/>`,
    ),
    'visio/_rels/document.xml.rels': rels([
      ['rPages', `${visioRelationships}/pages`, 'pages/pages.xml'],
    ]),
    'visio/pages/pages.xml': xml(
      'Pages',
      `<Page ID="0" Name="${exchangeXML(name)}" NameU="${exchangeXML(name)}"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cell('PageWidth', visioInches(page.width))}${cell('PageHeight', visioInches(page.height))}${cell('PageScale', 1)}${cell('DrawingScale', 1)}${cell('DrawingSizeType', 0)}${cell('DrawingScaleType', 0)}${cell('DrawingResizeType', 0)}</PageSheet><Rel r:id="rPage1"/></Page>`,
    ),
    'visio/pages/_rels/pages.xml.rels': rels([
      ['rPage1', `${visioRelationships}/page`, 'page1.xml'],
    ]),
  };
}
