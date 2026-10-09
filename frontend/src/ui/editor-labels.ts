import type { MessageId, Translate } from '../i18n';

/** Interface labels are separate from canonical model keys and authored content. */
const nodeKindMessages: Record<string, MessageId> = {
  generic: 'editor.nodes.typeLabel.generic',
  process: 'editor.nodes.typeLabel.process',
  decision: 'editor.nodes.typeLabel.decision',
  start: 'editor.nodes.typeLabel.start',
  end: 'editor.nodes.typeLabel.end',
  milestone: 'editor.nodes.typeLabel.milestone',
  timeline: 'editor.nodes.typeLabel.timelineItem',
  person: 'editor.nodes.typeLabel.person',
  team: 'editor.nodes.typeLabel.team',
  system: 'editor.nodes.typeLabel.system',
  external: 'editor.nodes.typeLabel.externalSystem',
  input: 'editor.nodes.typeLabel.input',
  output: 'editor.nodes.typeLabel.output',
  document: 'editor.nodes.typeLabel.document',
  database: 'editor.nodes.typeLabel.database',
  note: 'editor.nodes.typeLabel.note',
  group: 'editor.nodes.typeLabel.group',
};
export const nodeKindLabel = (t: Translate, value: string): string =>
  Object.hasOwn(nodeKindMessages, value) ? t(nodeKindMessages[value]) : value;

const diagramModeMessages: Record<string, MessageId> = {
  blank: 'editor.properties.diagram.mode.blank',
  mindmap: 'editor.properties.diagram.mode.mindmap',
  flowchart: 'editor.properties.diagram.mode.flowchart',
  timeline: 'editor.properties.diagram.mode.timeline',
  process: 'editor.properties.diagram.mode.process',
  dependency: 'editor.properties.diagram.mode.dependency',
  responsibility: 'editor.properties.diagram.mode.responsibility',
  freeform: 'editor.properties.diagram.mode.freeform',
  'process-simulator': 'editor.properties.diagram.mode.processSimulator',
};
export const diagramModeLabel = (t: Translate, value: string): string =>
  Object.hasOwn(diagramModeMessages, value) ? t(diagramModeMessages[value]) : value;

const statusMessages: Record<string, MessageId> = {
  '': 'editor.status.noStatus',
  planned: 'editor.status.planned',
  'in-progress': 'editor.status.inProgress',
  blocked: 'editor.status.blocked',
  done: 'editor.selection.done',
};
export const statusLabel = (t: Translate, value: string): string =>
  Object.hasOwn(statusMessages, value) ? t(statusMessages[value]) : value;

const iconMessages: Record<string, MessageId> = {
  work: 'editor.icons.work',
  ideas: 'editor.icons.ideas',
  people: 'editor.icons.people',
  learning: 'editor.icons.learning',
  technology: 'editor.icons.technology',
  design: 'editor.icons.design',
  finance: 'editor.icons.finance',
  health: 'editor.icons.health',
  travel: 'editor.icons.travel',
  home: 'editor.icons.home',
  calendar: 'editor.properties.schedule',
  goals: 'editor.icons.goals',
  nature: 'editor.icons.nature',
  music: 'editor.icons.music',
  launch: 'editor.icons.launch',
  research: 'editor.icons.research',
};
export const iconLabel = (t: Translate, value: string): string =>
  Object.hasOwn(iconMessages, value) ? t(iconMessages[value]) : value;

const paletteMessages: Record<string, MessageId> = {
  '#23664d': 'editor.palette.forest',
  '#226d72': 'editor.palette.teal',
  '#37648d': 'editor.palette.blue',
  '#8f6123': 'editor.palette.amber',
  '#b65344': 'editor.palette.coral',
  '#775491': 'editor.palette.plum',
  '#984f6d': 'editor.palette.berry',
  '#36443e': 'editor.palette.charcoal',
};
export const paletteLabel = (t: Translate, value: string): string =>
  Object.hasOwn(paletteMessages, value) ? t(paletteMessages[value]) : value;

const sqlResolutionMessages: Record<string, MessageId> = {
  resolved: 'editor.sql.referenceResolution.resolved',
  unresolved: 'editor.sql.referenceResolution.unresolved',
  ambiguous: 'editor.sql.referenceResolution.ambiguous',
};
export const sqlResolutionLabel = (t: Translate, value: string): string =>
  Object.hasOwn(sqlResolutionMessages, value) ? t(sqlResolutionMessages[value]) : value;

const sqlSourceKindMessages: Record<string, MessageId> = {
  table: 'editor.sql.query.tableSource',
  derived: 'editor.sql.query.derivedQuery',
  cte: 'editor.sql.query.cteSource',
};
export const sqlSourceKindLabel = (t: Translate, value: string): string =>
  Object.hasOwn(sqlSourceKindMessages, value) ? t(sqlSourceKindMessages[value]) : value;

const sqlRelationshipKindMessages: Record<string, MessageId> = {
  join: 'editor.sql.relationshipKind.join',
  input: 'editor.sql.relationshipKind.input',
  lineage: 'editor.sql.relationshipKind.lineage',
  subquery: 'editor.sql.relationshipKind.subquery',
};
export const sqlRelationshipKindLabel = (t: Translate, value: string): string =>
  Object.hasOwn(sqlRelationshipKindMessages, value) ? t(sqlRelationshipKindMessages[value]) : value;

const historyKindMessages: Record<string, MessageId> = {
  named: 'editor.history.snapshotKind.named',
  'source-refresh': 'editor.history.snapshotKind.sourceRefresh',
  'pre-restore': 'editor.history.snapshotKind.preRestore',
};
export const historyKindLabel = (t: Translate, value: string): string =>
  Object.hasOwn(historyKindMessages, value) ? t(historyKindMessages[value]) : value;

const historyEntityMessages: Record<string, MessageId> = {
  diagram: 'editor.history.entity.diagram',
  node: 'editor.history.entity.node',
  edge: 'editor.history.entity.edge',
  owner: 'editor.history.entity.owner',
  source: 'editor.history.entity.source',
};
export const historyEntityLabel = (t: Translate, value: string): string =>
  Object.hasOwn(historyEntityMessages, value) ? t(historyEntityMessages[value]) : value;

const historyChangeKindMessages: Record<string, MessageId> = {
  added: 'editor.history.changeKind.added',
  removed: 'editor.history.changeKind.removed',
  changed: 'editor.history.changeKind.changed',
};
export const historyChangeKindLabel = (t: Translate, value: string): string =>
  Object.hasOwn(historyChangeKindMessages, value) ? t(historyChangeKindMessages[value]) : value;

const edgeDirectionMessages: Record<string, MessageId> = {
  forward: 'editor.properties.edge.direction.forward',
  backward: 'editor.properties.edge.direction.backward',
  both: 'editor.properties.edge.direction.both',
  none: 'editor.properties.edge.direction.none',
};
export const edgeDirectionLabel = (t: Translate, value: string): string =>
  Object.hasOwn(edgeDirectionMessages, value) ? t(edgeDirectionMessages[value]) : value;

const edgeStyleMessages: Record<string, MessageId> = {
  solid: 'editor.properties.edge.style.solid',
  dashed: 'editor.properties.edge.style.dashed',
  dotted: 'editor.properties.edge.style.dotted',
};
export const edgeStyleLabel = (t: Translate, value: string): string =>
  Object.hasOwn(edgeStyleMessages, value) ? t(edgeStyleMessages[value]) : value;

const sqlColumnRuleMessages: Record<string, MessageId> = {
  'Primary key': 'editor.sql.table.primaryKey',
  'Foreign key': 'editor.sql.table.foreignKey',
  Unique: 'editor.sql.table.unique',
  Nullable: 'editor.sql.table.nullable',
  'Not null': 'editor.sql.table.notNull',
};
export const sqlColumnRuleLabel = (t: Translate, value: string): string =>
  Object.hasOwn(sqlColumnRuleMessages, value) ? t(sqlColumnRuleMessages[value]) : value;

const historyWarningMessages: Record<string, MessageId> = {
  'Affected objects follow the relationships and arrows modeled in this diagram; this is not an execution plan.':
    'editor.history.warning.affectedObjectsFollowTheRelationshipsAndArrowsModeledInThisDiagramThis',
  'Change details are limited to 100 field paths per object, 300 characters per path and 500 characters per label. Counts include all changed objects.':
    'editor.history.warning.changeDetailsAreLimitedTo100FieldPathsPerObject300Characters',
};
export const historyWarningLabel = (t: Translate, value: string): string =>
  Object.hasOwn(historyWarningMessages, value) ? t(historyWarningMessages[value]) : value;

const templateMessages: Record<string, MessageId> = {
  blank: 'editor.templates.blank',
  'mind-map': 'editor.templates.mind-map',
  'basic-flowchart': 'editor.templates.basic-flowchart',
  'project-timeline': 'editor.templates.project-timeline',
  'customer-journey': 'editor.templates.customer-journey',
  'decision-tree': 'editor.templates.decision-tree',
  'process-map': 'editor.templates.process-map',
  'responsibility-flow': 'editor.templates.responsibility-flow',
  'process-simulator-blank': 'editor.templates.process-simulator-blank',
  'process-simulator': 'editor.templates.process-simulator',
  'delivery-network-simulator': 'editor.templates.delivery-network-simulator',
  'system-architecture': 'editor.templates.system-architecture',
};
export const templateLabel = (t: Translate, id: string, fallback: string): string =>
  Object.hasOwn(templateMessages, id) ? t(templateMessages[id]) : fallback;
