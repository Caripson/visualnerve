/** Portable notation values. Geometry/rendering never owns the saved model. */
export const notationCollectionIds = [
  'hipo',
  'dfd-yourdon',
  'dfd-gane-sarson',
  'uml',
  'bpmn',
] as const;
export type NotationCollectionId = (typeof notationCollectionIds)[number];
export const notationLimits = {
  id: 80,
  label: 300,
  text: 2000,
  compartments: 16,
  linesPerCompartment: 200,
  compartmentText: 100000,
  ports: 32,
  waypoints: 256,
  timingStates: 128,
  coordinate: 1e8,
  multiplicity: 40,
} as const;
export const umlDiagramKinds = [
  'class',
  'object',
  'component',
  'composite-structure',
  'package',
  'deployment',
  'profile',
  'use-case',
  'activity',
  'state-machine',
  'sequence',
  'communication',
  'interaction-overview',
  'timing',
] as const;
export type UmlDiagramKind = (typeof umlDiagramKinds)[number];
export type HipoDiagramKind = 'vtoc' | 'overview-ipo' | 'detail-ipo';
export type DfdDiagramKind = 'context' | 'data-flow';
export type BpmnDiagramKind = 'process' | 'collaboration' | 'choreography' | 'conversation';
export type NotationDiagramKind =
  | HipoDiagramKind
  | DfdDiagramKind
  | UmlDiagramKind
  | BpmnDiagramKind;
export type NotationProfile = {
  schemaVersion: 1;
} & (
  | { collection: 'hipo'; diagramKind: HipoDiagramKind }
  | { collection: 'dfd-yourdon' | 'dfd-gane-sarson'; diagramKind: DfdDiagramKind }
  | { collection: 'uml'; diagramKind: UmlDiagramKind }
  | { collection: 'bpmn'; diagramKind: BpmnDiagramKind }
);
export type NotationPoint = readonly [number, number];
export type NotationSide = 'left' | 'right' | 'top' | 'bottom';
export interface NotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface NotationCompartment {
  id: string;
  title?: string;
  lines: string[];
}
export interface NotationPort {
  id: string;
  side: NotationSide;
  /** Fraction along the named side, default .5. */
  offset?: number;
  direction?: 'in' | 'out' | 'both';
  label?: string;
}
export interface HipoProperties {
  moduleNumber?: string;
  detail?: 'overview' | 'detail';
}
export interface DfdProperties {
  number?: string;
  level?: number;
  duplicate?: boolean;
}
export interface UmlProperties {
  stereotype?: string;
  classifier?: string;
  abstract?: boolean;
  static?: boolean;
  visibility?: 'public' | 'private' | 'protected' | 'package';
  operator?:
    | 'alt'
    | 'opt'
    | 'loop'
    | 'break'
    | 'par'
    | 'strict'
    | 'seq'
    | 'critical'
    | 'neg'
    | 'assert'
    | 'ignore'
    | 'consider';
  guard?: string;
  orientation?: 'horizontal' | 'vertical';
  timeStart?: number;
  timeEnd?: number;
  timingStates?: { time: number; state: string }[];
}
export const bpmnEventDefinitions = [
  'none',
  'message',
  'timer',
  'error',
  'escalation',
  'cancel',
  'compensation',
  'conditional',
  'link',
  'signal',
  'terminate',
  'multiple',
  'parallel-multiple',
] as const;
export type BpmnEventDefinition = (typeof bpmnEventDefinitions)[number];
export interface BpmnProperties {
  eventDefinition?: BpmnEventDefinition;
  eventSubProcess?: boolean;
  nonInterrupting?: boolean;
  taskType?:
    | 'none'
    | 'service'
    | 'send'
    | 'receive'
    | 'user'
    | 'manual'
    | 'business-rule'
    | 'script';
  loop?: 'none' | 'standard' | 'parallel-multi-instance' | 'sequential-multi-instance';
  collapsed?: boolean;
  compensation?: boolean;
  adHoc?: boolean;
  isCollection?: boolean;
  instantiating?: boolean;
  parallel?: boolean;
  participant?: 'initiating' | 'non-initiating';
}
interface NodeNotationBase {
  symbol: string;
  compartments?: NotationCompartment[];
  ports?: NotationPort[];
  /** Native node references, remapped with clipboard/templates/imports. */
  attachmentId?: string;
  relatedNodeId?: string;
}
export type NodeNotation = NodeNotationBase &
  (
    | { collection: 'hipo'; diagramKind?: HipoDiagramKind; properties?: HipoProperties }
    | {
        collection: 'dfd-yourdon' | 'dfd-gane-sarson';
        diagramKind?: DfdDiagramKind;
        properties?: DfdProperties;
      }
    | { collection: 'uml'; diagramKind?: UmlDiagramKind; properties?: UmlProperties }
    | { collection: 'bpmn'; diagramKind?: BpmnDiagramKind; properties?: BpmnProperties }
  );
export interface UmlEdgeProperties {
  guard?: string;
  trigger?: string;
  effect?: string;
  messageNumber?: string;
  stereotype?: string;
}
export interface BpmnEdgeProperties {
  condition?: string;
  default?: boolean;
}
interface EdgeNotationBase {
  symbol: string;
  sourcePort?: string;
  targetPort?: string;
  sourceLabel?: string;
  targetLabel?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  /** Optional manually authored route in logical canvas coordinates. */
  waypoints?: NotationPoint[];
}
export type EdgeNotation = EdgeNotationBase &
  (
    | { collection: 'hipo' | 'dfd-yourdon' | 'dfd-gane-sarson'; properties?: never }
    | { collection: 'uml'; properties?: UmlEdgeProperties }
    | { collection: 'bpmn'; properties?: BpmnEdgeProperties }
  );
export interface NotationSource {
  title: string;
  url: string;
  locator: string;
}
export interface NotationPropertyDefinition {
  key: string;
  label: string;
  type: 'text' | 'boolean' | 'number' | 'integer' | 'enum' | 'timing-states';
  values?: readonly string[];
  minimum?: number;
  maximum?: number;
}
export interface NotationSymbol {
  collection: NotationCollectionId;
  id: string;
  label: string;
  category: string;
  diagramKinds: readonly NotationDiagramKind[];
  defaultSize: { width: number; height: number };
  /** Named geometry implementation; never an arbitrary imported SVG string. */
  geometry: string;
  properties: readonly NotationPropertyDefinition[];
  compartments?: readonly string[];
  container?: boolean;
  source: NotationSource;
}
export type NotationDecoration =
  | 'none'
  | 'open-arrow'
  | 'filled-arrow'
  | 'hollow-triangle'
  | 'filled-triangle'
  | 'hollow-diamond'
  | 'filled-diamond'
  | 'circle'
  | 'cross';
export interface NotationEdgeSymbol {
  collection: NotationCollectionId;
  id: string;
  label: string;
  diagramKinds: readonly NotationDiagramKind[];
  line: 'solid' | 'dashed' | 'dotted';
  sourceDecoration: NotationDecoration;
  targetDecoration: NotationDecoration;
  properties: readonly NotationPropertyDefinition[];
  source: NotationSource;
}
export interface NotationCollection {
  id: NotationCollectionId;
  label: string;
  diagramKinds: readonly { id: NotationDiagramKind; label: string }[];
  sources: readonly NotationSource[];
  limitations: readonly string[];
}
export interface NotationAnchor {
  id: string;
  x: number;
  y: number;
  side: NotationSide;
}
export interface NotationCompartmentBox extends NotationRect {
  id: string;
}
export interface NotationGeometry {
  /** Normalized relief/connection contour; open details remain face strokes. */
  outline: readonly NotationPoint[];
  outlinePath: string;
  detailPaths: readonly string[];
  dashedPaths?: readonly string[];
  filledPaths: readonly string[];
  /** Lightly shaded participant bands, distinct from solid semantic markers. */
  shadedPaths?: readonly string[];
  /** Negative strokes inside a filled marker, painted with the node surface. */
  contrastPaths?: readonly string[];
  /** Separate closed surfaces for line-based glyphs, rather than a filled bounding box. */
  reliefContours?: readonly (readonly NotationPoint[])[];
  compartmentBoxes?: readonly NotationCompartmentBox[];
  contentBox: NotationRect;
  /** A divided identifier band; stereotype prefixes otherwise share the title area. */
  prefixBox?: NotationRect;
  /** Guard label outside a combined-fragment operator tab. */
  guardBox?: NotationRect;
  titleRotation?: -90;
  anchors: readonly NotationAnchor[];
  outlineFill: 'background' | 'foreground' | 'none';
  stroke: 'solid' | 'dashed';
  strokeWidth?: number;
  titleStyle?: 'normal' | 'italic' | 'underlined' | 'hidden';
}
