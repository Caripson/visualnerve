import type { ExchangeEdge, ExchangeNode } from './exchange-types';
import { exchangeXML, ExchangeXmlWriter } from './exchange-xml';

export const visioInches = (pixels: number) => pixels / 96;
const decimal = (value: number) => String(Object.is(value, -0) ? 0 : value);
export function visioCell(name: string, value: string | number, formula?: string) {
  return `<Cell N="${name}" V="${typeof value === 'number' ? decimal(value) : exchangeXML(value)}"${formula ? ` F="${exchangeXML(formula)}"` : ''}/>`;
}
const cell = visioCell;

export interface VisioPageGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Standalone native shapes: no copied stencils, media, or executable resources. */
export class VisioShapeWriter {
  constructor(
    private readonly writer: ExchangeXmlWriter,
    private readonly ids: Map<string, number>,
    private readonly page: VisioPageGeometry,
  ) {}

  node(node: ExchangeNode, parent?: ExchangeNode, group = false) {
    const width = visioInches(node.width),
      height = visioInches(node.height);
    const left = visioInches(node.x - (parent?.x ?? this.page.x));
    const bottom = parent
      ? visioInches(parent.height - (node.y - parent.y) - node.height)
      : visioInches(this.page.height - (node.y - this.page.y) - node.height);
    const id = this.ids.get(node.id)!;
    this.writer.write(
      `<Shape ID="${id}" NameU="${exchangeXML(`VisualNerve.${node.kind}.${id}`)}" Name="${exchangeXML(node.title || node.kind)}" Type="${group ? 'Group' : 'Shape'}" LineStyle="0" FillStyle="0" TextStyle="0">`,
    );
    this.writer.write(
      cell('PinX', left + width / 2) +
        cell('PinY', bottom + height / 2) +
        cell('Width', width) +
        cell('Height', height) +
        cell('LocPinX', width / 2, 'Width*0.5') +
        cell('LocPinY', height / 2, 'Height*0.5') +
        cell('Angle', 0) +
        cell('FlipX', 0) +
        cell('FlipY', 0) +
        cell('FillForegnd', node.fill) +
        cell('FillPattern', group ? 0 : 1) +
        cell('LineColor', node.stroke) +
        cell('LineWeight', visioInches(1.25)) +
        cell('LinePattern', group ? 2 : 1) +
        cell('ShdwPattern', 0) +
        cell('VerticalAlign', group ? 0 : 1) +
        cell('LeftMargin', visioInches(8)) +
        cell('RightMargin', visioInches(8)) +
        cell('TopMargin', visioInches(8)) +
        cell('BottomMargin', visioInches(8)) +
        cell('ObjType', 1) +
        cell('ResizeMode', group ? 2 : 0),
    );
    if (group)
      this.writer.write(
        cell('DisplayMode', 1) + cell('SelectMode', 1) + cell('IsTextEditTarget', 1),
      );
    this.characterSections(node.textColor, group ? 0 : 1, true);
    this.connectionPoints(width, height);
    this.geometry(node, width, height, group);
    this.nodeText(node);
  }

  /** Match native 2012/main documents: group text precedes nested Shapes. */
  finishNode(_node: ExchangeNode) {
    this.writer.write('</Shape>');
  }

  private nodeText(node: ExchangeNode) {
    const details = [node.description, ...node.detailLines].filter(
      (value): value is string => !!value,
    );
    this.writer.write(
      `<Text><cp IX="0"/><pp IX="0"/>${exchangeXML(node.title)}${details.length ? `<cp IX="1"/>${exchangeXML('\n' + details.join('\n'))}` : ''}</Text>`,
    );
  }

  edge(edge: ExchangeEdge, source: ExchangeNode, target: ExchangeNode, id: number) {
    const a = this.endpoint(source, target, edge.source === edge.target ? 'right' : undefined);
    const b = this.endpoint(target, source, edge.source === edge.target ? 'top' : undefined);
    const width = b.x - a.x,
      height = b.y - a.y;
    // Dynamic glue uses target transformation triggers, rather than cached endpoints alone.
    // https://learn.microsoft.com/en-us/office/client-developer/visio/gluetype-cell-glue-info-section
    const begin = '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)';
    const end = '_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)';
    this.writer.write(
      `<Shape ID="${id}" NameU="VisualNerve.Connector.${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`,
    );
    this.writer.write(
      cell('PinX', (a.x + b.x) / 2, 'GUARD((BeginX+EndX)/2)') +
        cell('PinY', (a.y + b.y) / 2, 'GUARD((BeginY+EndY)/2)') +
        cell('Width', width, 'GUARD(EndX-BeginX)') +
        cell('Height', height, 'GUARD(EndY-BeginY)') +
        cell('LocPinX', width / 2, 'GUARD(Width*0.5)') +
        cell('LocPinY', height / 2, 'GUARD(Height*0.5)') +
        cell('Angle', 0, 'GUARD(0DA)') +
        cell('FlipX', 0) +
        cell('FlipY', 0) +
        cell('BeginX', a.x, begin) +
        cell('BeginY', a.y, begin) +
        cell('EndX', b.x, end) +
        cell('EndY', b.y, end) +
        cell('BegTrigger', 2, `_XFTRIGGER(Sheet.${this.ids.get(source.id)}!EventXFMod)`) +
        cell('EndTrigger', 2, `_XFTRIGGER(Sheet.${this.ids.get(target.id)}!EventXFMod)`) +
        cell('WalkPreference', 0) +
        cell('GlueType', 2) +
        cell('ObjType', 2) +
        cell('DynFeedback', 2) +
        cell('ShapeRouteStyle', 1) +
        cell('ConFixedCode', 0) +
        cell('NoAlignBox', 1) +
        cell('LockCalcWH', 1) +
        cell('FillPattern', 0) +
        cell('LineColor', edge.stroke) +
        cell('LineWeight', visioInches(1.6)) +
        cell('LinePattern', edge.style === 'dashed' ? 2 : edge.style === 'dotted' ? 3 : 1) +
        cell('BeginArrow', edge.direction === 'both' || edge.direction === 'backward' ? 13 : 0) +
        cell('EndArrow', edge.direction === 'both' || edge.direction === 'forward' ? 13 : 0) +
        cell('BeginArrowSize', 2) +
        cell('EndArrowSize', 2) +
        cell('TxtPinX', width / 2, 'Width*0.5') +
        cell('TxtPinY', height / 2, 'Height*0.5') +
        cell('TxtWidth', 2, 'MAX(TEXTWIDTH(TheText),1IN)') +
        cell('TxtHeight', 0.3, 'TEXTHEIGHT(TheText,TxtWidth)') +
        cell('TxtLocPinX', 1, 'TxtWidth*0.5') +
        cell('TxtLocPinY', 0.15, 'TxtHeight*0.5') +
        cell('TxtAngle', 0),
    );
    this.characterSections(edge.stroke, 1, false);
    this.writer.write(
      `<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}`,
    );
    this.geometryRow(1, 'MoveTo', 0, 0, '0', '0');
    this.geometryRow(2, 'LineTo', width / 2, 0, 'Width*0.5', '0');
    this.geometryRow(3, 'LineTo', width / 2, height, 'Width*0.5', 'Height');
    this.geometryRow(4, 'LineTo', width, height, 'Width', 'Height');
    this.writer.write(
      `</Section><Text><cp IX="0"/><pp IX="0"/>${exchangeXML(edge.label)}</Text></Shape>`,
    );
  }

  connect(edge: ExchangeEdge, id: number) {
    return `<Connect FromSheet="${id}" FromCell="BeginX" FromPart="9" ToSheet="${this.ids.get(edge.source)}" ToCell="PinX" ToPart="3"/><Connect FromSheet="${id}" FromCell="EndX" FromPart="12" ToSheet="${this.ids.get(edge.target)}" ToCell="PinX" ToPart="3"/>`;
  }

  private endpoint(node: ExchangeNode, other: ExchangeNode, side?: 'right' | 'top') {
    const centerX = node.x + node.width / 2,
      centerY = node.y + node.height / 2;
    const dx = other.x + other.width / 2 - centerX,
      dy = other.y + other.height / 2 - centerY;
    const horizontal =
      side === 'right' || (!side && Math.abs(dx) / node.width >= Math.abs(dy) / node.height);
    const x =
      side === 'top'
        ? centerX
        : horizontal
          ? centerX + ((dx >= 0 || side === 'right' ? 1 : -1) * node.width) / 2
          : centerX;
    const y =
      side === 'top'
        ? node.y
        : horizontal
          ? centerY
          : centerY + ((dy >= 0 ? 1 : -1) * node.height) / 2;
    return {
      x: visioInches(x - this.page.x),
      y: visioInches(this.page.height - (y - this.page.y)),
    };
  }

  private characterSections(color: string, align: number, title: boolean) {
    this.writer.write(
      `<Section N="Character"><Row IX="0">${cell('Font', 'Arial')}${cell('Color', color)}${cell('Size', (title ? 12 : 10) / 72)}${cell('Style', title ? 1 : 0)}</Row>${title ? `<Row IX="1">${cell('Font', 'Arial')}${cell('Color', color)}${cell('Size', 10 / 72)}${cell('Style', 0)}</Row>` : ''}</Section><Section N="Paragraph"><Row IX="0">${cell('HorzAlign', align)}${cell('SpLine', -1.2)}${cell('SpBefore', 0)}${cell('SpAfter', 0)}</Row></Section>`,
    );
  }

  private connectionPoints(width: number, height: number) {
    this.writer.write('<Section N="Connection">');
    for (const [index, x, y, fx, fy] of [
      [0, 0, height / 2, '0', 'Height*0.5'],
      [1, width, height / 2, 'Width', 'Height*0.5'],
      [2, width / 2, height, 'Width*0.5', 'Height'],
      [3, width / 2, 0, 'Width*0.5', '0'],
    ] as const) {
      this.writer.write(
        `<Row IX="${index}">${cell('X', x, fx)}${cell('Y', y, fy)}${cell('DirX', 0)}${cell('DirY', 0)}${cell('Type', 0)}</Row>`,
      );
    }
    this.writer.write('</Section>');
  }

  private geometry(node: ExchangeNode, width: number, height: number, group: boolean) {
    this.writer.write(
      `<Section N="Geometry" IX="0">${cell('NoFill', group ? 1 : 0)}${cell('NoLine', 0)}${cell('NoShow', 0)}`,
    );
    if (!group && (node.kind === 'start' || node.kind === 'end')) {
      this.writer.write(
        `<Row IX="1" T="Ellipse">${cell('X', width / 2, 'Width*0.5')}${cell('Y', height / 2, 'Height*0.5')}${cell('A', width, 'Width')}${cell('B', height / 2, 'Height*0.5')}${cell('C', width / 2, 'Width*0.5')}${cell('D', height, 'Height')}</Row>`,
      );
    } else {
      const points =
        !group && (node.kind === 'decision' || node.kind === 'milestone')
          ? [
              [0.5, 0],
              [1, 0.5],
              [0.5, 1],
              [0, 0.5],
              [0.5, 0],
            ]
          : !group && node.kind === 'document'
            ? [
                [0, 0],
                [1, 0],
                [1, 0.8],
                [0.8, 1],
                [0, 1],
                [0, 0],
              ]
            : [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ];
      points.forEach(([x, y], index) =>
        this.geometryRow(
          index + 1,
          index ? 'LineTo' : 'MoveTo',
          width * x,
          height * y,
          `Width*${x}`,
          `Height*${y}`,
        ),
      );
    }
    this.writer.write('</Section>');
  }

  private geometryRow(index: number, type: string, x: number, y: number, fx: string, fy: string) {
    this.writer.write(
      `<Row IX="${index}" T="${type}">${cell('X', x, fx)}${cell('Y', y, fy)}</Row>`,
    );
  }
}
