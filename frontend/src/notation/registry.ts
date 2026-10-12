import {
  umlDiagramKinds,
  bpmnEventDefinitions,
  type NotationCollection,
  type NotationCollectionId,
  type NotationDiagramKind,
  type NotationEdgeSymbol,
  type NotationPropertyDefinition,
  type NotationSource,
  type NotationSymbol,
} from './types';
export { notationLimits } from './types';
export {
  notationCompartmentLimits,
  notationCompartmentLimit,
  notationCompartmentDefaults,
} from './compartments';

/** OMG BPMN 2.0.2 Table 10.93, printed pages 259–260; no Cartesian trigger invention. */
export const bpmnEventContexts = {
  topLevelStart: [
    'none',
    'message',
    'timer',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  eventSubProcessStart: [
    'message',
    'timer',
    'error',
    'escalation',
    'compensation',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  nonInterruptingStart: [
    'message',
    'timer',
    'escalation',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  intermediateCatch: [
    'message',
    'timer',
    'conditional',
    'link',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  boundary: [
    'message',
    'timer',
    'error',
    'escalation',
    'cancel',
    'compensation',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  nonInterruptingBoundary: [
    'message',
    'timer',
    'escalation',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  intermediateThrow: [
    'none',
    'message',
    'escalation',
    'compensation',
    'link',
    'signal',
    'multiple',
  ],
  end: [
    'none',
    'message',
    'error',
    'escalation',
    'cancel',
    'compensation',
    'signal',
    'terminate',
    'multiple',
  ],
} as const;

/** Symbol-specific native attachment references, independent of containment. */
export const umlAttachmentTargets: Readonly<Record<string, readonly string[]>> = {
  port: ['class', 'component', 'part', 'system-boundary'],
  activation: ['lifeline'],
  qualifier: ['class', 'interface', 'association-class'],
  'activity-parameter': ['activity'],
  'input-pin': ['action', 'send-signal-action', 'accept-event-action'],
  'output-pin': ['action', 'send-signal-action', 'accept-event-action'],
  'expansion-node': ['expansion-region'],
  'connection-point-reference': ['state'],
};

const hipo: NotationSource = {
  title: 'IBM Improved Programming Technologies — An Overview, GC20-1850-0 (1974)',
  url: 'https://bitsavers.trailing-edge.com/pdf/ibm/generalInfo/GC20-1850-0_Improved_Programming_Technologies_-_An_Overview_1st_ed_197410.pdf',
  locator: 'Chapter 5, printed pages 13–17, Figures 11–14',
};
const hipoFlows: NotationSource = {
  title: 'IBM Preparing Method of Operation Diagrams — The HIPO Method, TR00.2209 (1971)',
  url: 'https://bitsavers.trailing-edge.com/pdf/ibm/generalInfo/TR00.2209_Preparing_Method_of_Operation_Diagrams_-_The_HIPO_Method_Jul71.pdf',
  locator: 'Printed pages 11–17: data areas and data/action/alteration/reference connectors',
};
const hipoMedia: NotationSource = {
  title: 'IBM Flowcharting Techniques, GC20-8152-1 — supplemental media notation',
  url: 'https://fulmanski.pl/zajecia/wdi/zajecia_20142015/materialy/IBM-FlowchartingTechniques-GC20-8152-1.pdf',
  locator:
    'Printed pages 2–7, Figure 1 and completed media symbols; supplemental to HIPO structure, not a verified GX20-1971 aperture inventory',
};
const yourdon: NotationSource = {
  title: 'Edward Yourdon, Structured Analysis, Chapter 9: Dataflow Diagrams',
  url: 'https://www.yourdon.com/strucanalysis/wiki/index.php?title=Chapter_9',
  locator: 'Process, flow, store and terminator notation; context and leveled diagrams',
};
const gane: NotationSource = {
  title:
    'Chris Gane and Trish Sarson, Structured Systems Analysis: Tools and Techniques (1977 edition)',
  url: 'https://archive.org/details/structuredsystem0000gane',
  locator:
    'Data-flow diagram notation: numbered rounded processes, external entities and open-ended stores',
};
const uml: NotationSource = {
  title: 'OMG Unified Modeling Language 2.5.1',
  url: 'https://www.omg.org/spec/UML/2.5.1/PDF',
  locator: 'Clauses 7–20 notation subsections; Annex A diagram taxonomy',
};
const bpmn: NotationSource = {
  title: 'OMG Business Process Model and Notation 2.0.2',
  url: 'https://www.omg.org/spec/BPMN/2.0.2/PDF',
  locator:
    'Clauses 7–11 graphical elements; Table 10.93 event variants; Clause 12 depiction resolution',
};
const kindLabels: Record<string, string> = {
  vtoc: 'Visual Table of Contents',
  'overview-ipo': 'Overview IPO',
  'detail-ipo': 'Detail IPO',
  context: 'Context diagram',
  'data-flow': 'Data-flow diagram',
  class: 'Class diagram',
  object: 'Object diagram',
  component: 'Component diagram',
  'composite-structure': 'Composite structure diagram',
  package: 'Package diagram',
  deployment: 'Deployment diagram',
  profile: 'Profile diagram',
  'use-case': 'Use case diagram',
  activity: 'Activity diagram',
  'state-machine': 'State machine diagram',
  sequence: 'Sequence diagram',
  communication: 'Communication diagram',
  'interaction-overview': 'Interaction overview diagram',
  timing: 'Timing diagram',
  process: 'Process diagram',
  collaboration: 'Collaboration diagram',
  choreography: 'Choreography diagram',
  conversation: 'Conversation diagram',
};
const hipoKinds = ['vtoc', 'overview-ipo', 'detail-ipo'] as const;
const dfdKinds = ['context', 'data-flow'] as const;
const bpmnKinds = ['process', 'collaboration', 'choreography', 'conversation'] as const;
const kinds = (values: readonly NotationDiagramKind[]) =>
  values.map((id) => ({ id, label: kindLabels[id] }));
export const notationCollections: readonly NotationCollection[] = [
  {
    id: 'hipo',
    label: 'HIPO',
    diagramKinds: kinds(hipoKinds),
    sources: [hipo, hipoFlows, hipoMedia],
    limitations: [
      'Editable VTOC and IPO structure based on archived IBM publications, with explicitly supplemental IBM flowchart media; this does not reconstruct an unverified complete GX20-1971 media aperture inventory.',
    ],
  },
  {
    id: 'dfd-yourdon',
    label: 'Classic DFD — Yourdon / DeMarco',
    diagramKinds: kinds(dfdKinds),
    sources: [yourdon],
    limitations: [
      'Decomposition references and draft balancing checks are modeling aids; data transformations are not executed.',
    ],
  },
  {
    id: 'dfd-gane-sarson',
    label: 'Classic DFD — Gane / Sarson',
    diagramKinds: kinds(dfdKinds),
    sources: [gane],
    limitations: [
      'The distinct graphical dialect is retained; no executable data-processing semantics.',
    ],
  },
  {
    id: 'uml',
    label: 'UML',
    diagramKinds: kinds(umlDiagramKinds),
    sources: [uml],
    limitations: [
      'Graphical modeling across all fourteen diagram kinds; not a complete UML metamodel, XMI interchange implementation, OCL evaluator or conformance certification.',
    ],
  },
  {
    id: 'bpmn',
    label: 'BPMN',
    diagramKinds: kinds(bpmnKinds),
    sources: [bpmn],
    limitations: [
      'Graphical families and applicable marker variants; no process execution, BPMN XML interchange or conformance certification.',
    ],
  },
];
const text = (key: string, label = key): NotationPropertyDefinition => ({
  key,
  label,
  type: 'text',
});
const bool = (key: string, label = key): NotationPropertyDefinition => ({
  key,
  label,
  type: 'boolean',
});
const choice = (
  key: string,
  values: readonly string[],
  label = key,
): NotationPropertyDefinition => ({ key, label, type: 'enum', values });
const source = (collection: NotationCollectionId) =>
  collection === 'hipo'
    ? hipo
    : collection === 'uml'
      ? uml
      : collection === 'bpmn'
        ? bpmn
        : collection === 'dfd-yourdon'
          ? yourdon
          : gane;
function node(
  collection: NotationCollectionId,
  id: string,
  label: string,
  geometry: string,
  diagramKinds: readonly NotationDiagramKind[],
  properties: readonly NotationPropertyDefinition[] = [],
  extra: Partial<NotationSymbol> = {},
): NotationSymbol {
  return {
    collection,
    id,
    label,
    category: geometry,
    geometry,
    diagramKinds,
    properties,
    defaultSize: { width: 220, height: 120 },
    source: source(collection),
    ...extra,
  };
}
const headers = [
  text('stereotype', 'Stereotype'),
  text('classifier', 'Classifier'),
  bool('abstract', 'Abstract'),
  bool('static', 'Static'),
  choice('visibility', ['public', 'private', 'protected', 'package'], 'Visibility'),
];
const structural = [
  'class',
  'object',
  'component',
  'composite-structure',
  'package',
  'deployment',
  'profile',
] as const;
const behavior = [
  'activity',
  'state-machine',
  'sequence',
  'communication',
  'interaction-overview',
  'timing',
] as const;
const activityKinds = ['activity', 'interaction-overview'] as const;
const stateKinds = ['state-machine'] as const;
const interactionKinds = ['sequence', 'communication', 'interaction-overview', 'timing'] as const;
const compartments = (names: readonly string[]) => ({ compartments: names });
const container = { container: true, defaultSize: { width: 480, height: 280 } };
const eventSize = { defaultSize: { width: 80, height: 80 } };
const bpmnEventSize = { defaultSize: { width: 80, height: 128 } };
const bpmnGatewaySize = { defaultSize: { width: 100, height: 148 } };
const gatewaySize = { defaultSize: { width: 100, height: 100 } };
const loop = choice(
  'loop',
  ['none', 'standard', 'parallel-multi-instance', 'sequential-multi-instance'],
  'Loop / instance marker',
);
const taskProperties = [
  choice(
    'taskType',
    ['none', 'service', 'send', 'receive', 'user', 'manual', 'business-rule', 'script'],
    'Task type',
  ),
  loop,
  bool('compensation', 'Compensation'),
];
const subprocessProperties = [
  loop,
  bool('collapsed', 'Collapsed'),
  bool('compensation', 'Compensation'),
];
const eventProperties = [choice('eventDefinition', bpmnEventDefinitions, 'Event definition')];
const number = {
  key: 'level',
  label: 'Decomposition level',
  type: 'integer',
  minimum: 0,
  maximum: 99,
} as const;
export const notationSymbols: readonly NotationSymbol[] = [
  node(
    'hipo',
    'vtoc-module',
    'VTOC module',
    'hipo-module',
    ['vtoc'],
    [text('moduleNumber', 'Module number')],
  ),
  node(
    'hipo',
    'vtoc-reference',
    'VTOC module reference',
    'hipo-reference',
    ['vtoc'],
    [text('moduleNumber', 'Module number')],
  ),
  node(
    'hipo',
    'ipo-chart',
    'Input / Process / Output chart',
    'hipo-ipo',
    ['overview-ipo', 'detail-ipo'],
    [
      text('moduleNumber', 'Module number'),
      choice('detail', ['overview', 'detail'], 'Detail level'),
    ],
    {
      ...compartments(['Input', 'Process', 'Output', 'Extended description']),
      defaultSize: { width: 660, height: 300 },
    },
  ),
  node('hipo', 'data-area', 'Data area', 'rectangle', ['overview-ipo', 'detail-ipo'], [], {
    source: hipoFlows,
  }),
  node(
    'hipo',
    'document',
    'Document / report',
    'classic-document',
    ['overview-ipo', 'detail-ipo'],
    [],
    { source: hipoMedia },
  ),
  node(
    'hipo',
    'manual-input',
    'Manual input',
    'classic-manual-input',
    ['overview-ipo', 'detail-ipo'],
    [],
    { source: hipoMedia },
  ),
  node('hipo', 'display', 'Display', 'classic-display', ['overview-ipo', 'detail-ipo'], [], {
    source: hipoMedia,
  }),
  node(
    'hipo',
    'stored-data',
    'Online storage',
    'classic-online-storage',
    ['overview-ipo', 'detail-ipo'],
    [],
    { source: hipoMedia },
  ),
  node(
    'hipo',
    'magnetic-tape',
    'Magnetic tape',
    'classic-magnetic-tape',
    ['overview-ipo', 'detail-ipo'],
    [],
    { source: hipoMedia, defaultSize: { width: 140, height: 140 } },
  ),
  node(
    'hipo',
    'punched-card',
    'Punched card',
    'classic-punched-card',
    ['overview-ipo', 'detail-ipo'],
    [],
    { source: hipoMedia },
  ),
  node(
    'hipo',
    'magnetic-disk',
    'Magnetic disk',
    'classic-magnetic-disk',
    ['overview-ipo', 'detail-ipo'],
    [],
    { source: hipoMedia },
  ),
  ...(['dfd-yourdon', 'dfd-gane-sarson'] as const).flatMap((collection) => [
    node(
      collection,
      'process',
      'Process',
      collection === 'dfd-yourdon' ? 'circle' : 'dfd-process',
      dfdKinds,
      [text('number', 'Process number'), number],
    ),
    node(collection, 'external-entity', 'External entity', 'rectangle', dfdKinds),
    node(
      collection,
      'data-store',
      'Data store',
      collection === 'dfd-yourdon' ? 'open-store' : 'dfd-store',
      dfdKinds,
      [text('number', 'Store number')],
    ),
    node(
      collection,
      'duplicate-external-entity',
      'Repeated external entity',
      'duplicate-entity',
      dfdKinds,
      [bool('duplicate', 'Repeated')],
    ),
    node(
      collection,
      'duplicate-data-store',
      'Repeated data store',
      collection === 'dfd-yourdon' ? 'duplicate-open-store' : 'duplicate-dfd-store',
      dfdKinds,
      [text('number', 'Store number'), bool('duplicate', 'Repeated')],
    ),
    node(collection, 'note', 'Annotation', 'note', dfdKinds),
  ]),
  ...(['class', 'interface', 'enumeration', 'data-type', 'association-class'] as const).map((id) =>
    node(
      'uml',
      id,
      id[0].toUpperCase() + id.slice(1).replaceAll('-', ' '),
      'uml-class',
      structural,
      headers,
      {
        ...compartments(id === 'enumeration' ? ['Literals'] : ['Attributes', 'Operations']),
        defaultSize: { width: 280, height: 210 },
      },
    ),
  ),
  node('uml', 'template-classifier', 'Template classifier', 'uml-template', structural, headers, {
    ...compartments(['Template parameters', 'Attributes', 'Operations']),
    defaultSize: { width: 350, height: 280 },
  }),
  node('uml', 'qualifier', 'Association qualifier', 'rectangle', ['class'], headers, {
    defaultSize: { width: 160, height: 60 },
    ...compartments(['Qualifiers']),
  }),
  node('uml', 'nary-association', 'N-ary association', 'diamond', ['class'], [], eventSize),
  node(
    'uml',
    'object',
    'Object / instance specification',
    'uml-object',
    ['object', 'communication', 'deployment'],
    headers,
    compartments(['Slots']),
  ),
  node(
    'uml',
    'provided-interface',
    'Provided interface',
    'provided-interface',
    ['component', 'composite-structure'],
    [],
    eventSize,
  ),
  node(
    'uml',
    'required-interface',
    'Required interface',
    'required-interface',
    ['component', 'composite-structure'],
    [],
    eventSize,
  ),
  node(
    'uml',
    'component',
    'Component',
    'uml-component',
    ['component', 'deployment', 'composite-structure'],
    headers,
    compartments(['Provided interfaces', 'Required interfaces']),
  ),
  node('uml', 'port', 'Port', 'rectangle', ['component', 'composite-structure'], headers, {
    defaultSize: { width: 40, height: 40 },
  }),
  node(
    'uml',
    'part',
    'Part / property',
    'uml-object',
    ['composite-structure'],
    headers,
    compartments(['Properties']),
  ),
  node('uml', 'collaboration', 'Collaboration', 'dashed-ellipse', ['composite-structure'], headers),
  ...(['package', 'model', 'profile'] as const).map((id) =>
    node(
      'uml',
      id,
      `${id[0].toUpperCase()}${id.slice(1)}`,
      'package',
      id === 'profile' ? ['profile'] : structural,
      headers,
      { ...container, ...compartments(['Members']) },
    ),
  ),
  node(
    'uml',
    'stereotype',
    'Stereotype',
    'uml-class',
    ['profile'],
    headers,
    compartments(['Properties', 'Constraints']),
  ),
  ...(['node', 'device', 'execution-environment'] as const).map((id) =>
    node('uml', id, id.replaceAll('-', ' '), 'uml-node', ['deployment'], headers, {
      ...container,
      ...compartments(['Deployed artifacts']),
    }),
  ),
  node('uml', 'artifact', 'Artifact', 'artifact', ['deployment', 'component'], headers),
  node('uml', 'actor', 'Actor', 'actor', ['use-case'], headers, {
    defaultSize: { width: 110, height: 160 },
  }),
  node('uml', 'use-case', 'Use case', 'ellipse', ['use-case']),
  node(
    'uml',
    'extension-point',
    'Extension points',
    'uml-class',
    ['use-case'],
    [],
    compartments(['Extension points']),
  ),
  node(
    'uml',
    'system-boundary',
    'Subject / system boundary',
    'rectangle',
    ['use-case'],
    headers,
    container,
  ),
  node('uml', 'activity', 'Activity', 'rounded', activityKinds, headers, container),
  node('uml', 'action', 'Action', 'rounded', activityKinds, headers),
  node(
    'uml',
    'activity-parameter',
    'Activity parameter node',
    'rectangle',
    activityKinds,
    headers,
    { defaultSize: { width: 140, height: 60 } },
  ),
  node(
    'uml',
    'exception-handler',
    'Exception handler',
    'lightning',
    activityKinds,
    [text('guard')],
    { defaultSize: { width: 80, height: 80 } },
  ),
  ...(['object-node', 'central-buffer', 'data-store'] as const).map((id) =>
    node(
      'uml',
      id,
      id.replaceAll('-', ' '),
      'rectangle',
      activityKinds,
      headers,
      compartments(['State']),
    ),
  ),
  ...(['input-pin', 'output-pin', 'expansion-node'] as const).map((id) =>
    node(
      'uml',
      id,
      id.replaceAll('-', ' '),
      id === 'expansion-node' ? 'expansion-node' : 'rectangle',
      activityKinds,
      headers,
      { defaultSize: { width: 40, height: 40 } },
    ),
  ),
  node('uml', 'initial-node', 'Initial node', 'filled-circle', activityKinds, [], {
    defaultSize: { width: 40, height: 40 },
  }),
  node('uml', 'activity-final', 'Activity final', 'bullseye', activityKinds, [], eventSize),
  node('uml', 'flow-final', 'Flow final', 'cross-circle', activityKinds, [], eventSize),
  ...(['decision', 'merge'] as const).map((id) =>
    node(
      'uml',
      id,
      id === 'decision' ? 'Decision' : 'Merge',
      'diamond',
      activityKinds,
      [text('guard', 'Guard')],
      gatewaySize,
    ),
  ),
  ...(['fork', 'join'] as const).map((id) =>
    node(
      'uml',
      id,
      id === 'fork' ? 'Fork' : 'Join',
      'bar',
      activityKinds,
      [choice('orientation', ['horizontal', 'vertical'], 'Orientation')],
      { defaultSize: { width: 200, height: 30 } },
    ),
  ),
  node(
    'uml',
    'partition',
    'Activity partition / swimlane',
    'lane',
    activityKinds,
    [text('stereotype'), choice('orientation', ['horizontal', 'vertical'])],
    container,
  ),
  node(
    'uml',
    'expansion-region',
    'Expansion region',
    'dashed-rounded',
    activityKinds,
    headers,
    container,
  ),
  node(
    'uml',
    'interruptible-region',
    'Interruptible activity region',
    'dashed-rounded',
    activityKinds,
    [],
    container,
  ),
  node('uml', 'send-signal-action', 'Send signal action', 'send-signal', activityKinds),
  node('uml', 'accept-event-action', 'Accept event action', 'accept-event', activityKinds),
  node('uml', 'time-event-action', 'Accept time event action', 'hourglass', activityKinds),
  node(
    'uml',
    'state',
    'State',
    'rounded',
    stateKinds,
    headers,
    compartments(['Entry / do / exit', 'Internal transitions']),
  ),
  node('uml', 'initial-state', 'Initial pseudostate', 'filled-circle', stateKinds, [], {
    defaultSize: { width: 40, height: 40 },
  }),
  node('uml', 'final-state', 'Final state', 'bullseye', stateKinds, [], eventSize),
  node('uml', 'choice', 'Choice pseudostate', 'diamond', stateKinds, [text('guard')], gatewaySize),
  node('uml', 'junction', 'Junction pseudostate', 'filled-circle', stateKinds, [], {
    defaultSize: { width: 40, height: 40 },
  }),
  ...(['fork-state', 'join-state'] as const).map((id) =>
    node(
      'uml',
      id,
      id.replace('-state', ' pseudostate'),
      'bar',
      stateKinds,
      [choice('orientation', ['horizontal', 'vertical'])],
      { defaultSize: { width: 200, height: 30 } },
    ),
  ),
  node('uml', 'shallow-history', 'Shallow history', 'history', stateKinds, [], eventSize),
  node('uml', 'deep-history', 'Deep history', 'deep-history', stateKinds, [], eventSize),
  node('uml', 'entry-point', 'Entry point', 'circle', stateKinds, [], eventSize),
  node('uml', 'exit-point', 'Exit point', 'cross-circle', stateKinds, [], eventSize),
  node('uml', 'terminate', 'Terminate pseudostate', 'cross', stateKinds, [], eventSize),
  node(
    'uml',
    'connection-point-reference',
    'Connection point reference',
    'circle',
    stateKinds,
    [],
    eventSize,
  ),
  node('uml', 'lifeline', 'Lifeline', 'lifeline', ['sequence'], headers, {
    defaultSize: { width: 160, height: 400 },
  }),
  node('uml', 'activation', 'Execution specification', 'rectangle', ['sequence'], [], {
    defaultSize: { width: 40, height: 160 },
  }),
  node(
    'uml',
    'combined-fragment',
    'Combined fragment',
    'interaction-frame',
    ['sequence'],
    [
      choice('operator', [
        'alt',
        'opt',
        'loop',
        'break',
        'par',
        'strict',
        'seq',
        'critical',
        'neg',
        'assert',
        'ignore',
        'consider',
      ]),
      text('guard'),
    ],
    { ...container, ...compartments(['Operands']) },
  ),
  node('uml', 'interaction-use', 'Interaction use', 'interaction-frame', interactionKinds, headers),
  node(
    'uml',
    'interaction',
    'Interaction',
    'interaction-frame',
    interactionKinds,
    headers,
    container,
  ),
  node('uml', 'continuation', 'Continuation', 'hexagon', ['sequence']),
  node(
    'uml',
    'timing-lifeline',
    'Timing lifeline',
    'timing-lifeline',
    ['timing'],
    [
      text('classifier'),
      { key: 'timeStart', label: 'Start time', type: 'number' },
      { key: 'timeEnd', label: 'End time', type: 'number' },
      { key: 'timingStates', label: 'State timeline', type: 'timing-states' },
    ],
    { defaultSize: { width: 500, height: 160 }, ...compartments(['States']) },
  ),
  node(
    'uml',
    'state-invariant',
    'State invariant',
    'rounded',
    ['sequence', 'timing'],
    [text('guard')],
  ),
  node(
    'uml',
    'operand-guard',
    'Interaction operand guard',
    'constraint',
    ['sequence', 'interaction-overview'],
    [text('guard')],
  ),
  node(
    'uml',
    'time-constraint',
    'Time constraint',
    'constraint',
    ['sequence', 'timing'],
    [text('guard')],
  ),
  node(
    'uml',
    'duration-constraint',
    'Duration constraint',
    'constraint',
    ['sequence', 'timing'],
    [text('guard')],
  ),
  node(
    'uml',
    'time-observation',
    'Time observation',
    'constraint',
    ['sequence', 'timing'],
    [text('guard')],
  ),
  node(
    'uml',
    'duration-observation',
    'Duration observation',
    'constraint',
    ['sequence', 'timing'],
    [text('guard')],
  ),
  node(
    'uml',
    'message-endpoint',
    'Found / lost message endpoint',
    'filled-circle',
    ['sequence'],
    [],
    { defaultSize: { width: 40, height: 40 } },
  ),
  node('uml', 'destruction', 'Destruction occurrence', 'cross', ['sequence'], [], eventSize),
  node('uml', 'note', 'Comment / constraint', 'note', umlDiagramKinds, [text('stereotype')]),
  node('bpmn', 'task', 'Task', 'rounded', ['process', 'collaboration'], taskProperties),
  ...(
    ['subprocess', 'event-subprocess', 'transaction', 'call-activity', 'ad-hoc-subprocess'] as const
  ).map((id) =>
    node(
      'bpmn',
      id,
      id.replaceAll('-', ' '),
      id === 'transaction'
        ? 'transaction'
        : id === 'event-subprocess'
          ? 'dashed-rounded'
          : id === 'call-activity'
            ? 'call-activity'
            : 'rounded',
      ['process', 'collaboration'],
      subprocessProperties,
      { ...container, ...compartments(['Details']) },
    ),
  ),
  node(
    'bpmn',
    'start-event',
    'Start event',
    'circle',
    ['process', 'collaboration', 'choreography'],
    [
      ...eventProperties,
      bool('eventSubProcess', 'Event subprocess start'),
      bool('nonInterrupting', 'Non-interrupting'),
    ],
    bpmnEventSize,
  ),
  node(
    'bpmn',
    'intermediate-catch-event',
    'Intermediate catching event',
    'double-circle',
    ['process', 'collaboration', 'choreography'],
    eventProperties,
    bpmnEventSize,
  ),
  node(
    'bpmn',
    'intermediate-throw-event',
    'Intermediate throwing event',
    'double-circle',
    ['process', 'collaboration', 'choreography'],
    eventProperties,
    bpmnEventSize,
  ),
  node(
    'bpmn',
    'boundary-event',
    'Boundary event',
    'double-circle',
    ['process', 'collaboration'],
    [...eventProperties, bool('nonInterrupting', 'Non-interrupting')],
    bpmnEventSize,
  ),
  node(
    'bpmn',
    'end-event',
    'End event',
    'end-circle',
    ['process', 'collaboration', 'choreography'],
    eventProperties,
    bpmnEventSize,
  ),
  ...(
    ['exclusive-gateway', 'inclusive-gateway', 'parallel-gateway', 'complex-gateway'] as const
  ).map((id) =>
    node(
      'bpmn',
      id,
      id.replaceAll('-', ' '),
      id,
      ['process', 'collaboration', 'choreography'],
      [],
      bpmnGatewaySize,
    ),
  ),
  node(
    'bpmn',
    'event-based-gateway',
    'Event-based gateway',
    'event-based-gateway',
    ['process', 'collaboration', 'choreography'],
    [bool('instantiating', 'Instantiating'), bool('parallel', 'Parallel event gateway')],
    bpmnGatewaySize,
  ),
  node(
    'bpmn',
    'pool',
    'Participant / pool',
    'lane',
    ['collaboration', 'process', 'conversation'],
    [bool('collapsed', 'Black-box participant'), bool('isCollection', 'Multiple participant')],
    { ...container, defaultSize: { width: 780, height: 320 } },
  ),
  node('bpmn', 'lane', 'Lane', 'lane', ['process', 'collaboration'], [], {
    ...container,
    defaultSize: { width: 720, height: 180 },
  }),
  ...(['data-object', 'data-input', 'data-output'] as const).map((id) =>
    node(
      'bpmn',
      id,
      id.replaceAll('-', ' '),
      'artifact',
      ['process', 'collaboration', 'choreography'],
      [bool('isCollection', 'Collection')],
      { defaultSize: { width: 120, height: 150 } },
    ),
  ),
  node('bpmn', 'data-store', 'Data store', 'cylinder', [
    'process',
    'collaboration',
    'choreography',
  ]),
  node('bpmn', 'group', 'Group', 'dashed-rounded', bpmnKinds, [], container),
  node('bpmn', 'text-annotation', 'Text annotation', 'annotation', bpmnKinds),
  node(
    'bpmn',
    'message',
    'Message',
    'envelope',
    ['collaboration', 'choreography', 'conversation'],
    [],
    { defaultSize: { width: 100, height: 70 } },
  ),
  ...(['choreography-task', 'sub-choreography', 'call-choreography'] as const).map((id) =>
    node(
      'bpmn',
      id,
      id.replaceAll('-', ' '),
      'choreography',
      ['choreography'],
      [loop, bool('collapsed'), choice('participant', ['initiating', 'non-initiating'])],
      {
        defaultSize: { width: 280, height: 280 },
        ...compartments(['Initiating participant', 'Activity', 'Other participant']),
      },
    ),
  ),
  ...(['conversation', 'sub-conversation', 'call-conversation'] as const).map((id) =>
    node(
      'bpmn',
      id,
      id.replaceAll('-', ' '),
      'hexagon',
      ['conversation'],
      id === 'sub-conversation' ? [bool('collapsed')] : [],
    ),
  ),
  node(
    'bpmn',
    'participant-band',
    'Choreography participant band',
    'rectangle',
    ['choreography'],
    [choice('participant', ['initiating', 'non-initiating']), bool('isCollection')],
  ),
];
function edge(
  collection: NotationCollectionId,
  id: string,
  label: string,
  targetDecoration: NotationEdgeSymbol['targetDecoration'],
  line: NotationEdgeSymbol['line'] = 'solid',
  sourceDecoration: NotationEdgeSymbol['sourceDecoration'] = 'none',
  properties: readonly NotationPropertyDefinition[] = [],
): NotationEdgeSymbol {
  return {
    collection,
    id,
    label,
    line,
    sourceDecoration,
    targetDecoration,
    properties,
    diagramKinds:
      collection === 'uml'
        ? umlDiagramKinds
        : collection === 'bpmn'
          ? bpmnKinds
          : collection === 'hipo'
            ? hipoKinds
            : dfdKinds,
    source: collection === 'hipo' ? hipoFlows : source(collection),
  };
}
const umlEdgeProperties = [
  text('guard', 'Guard'),
  text('trigger', 'Trigger'),
  text('effect', 'Effect'),
  text('messageNumber', 'Message number'),
  text('stereotype', 'Stereotype'),
];
export const notationEdgeSymbols: readonly NotationEdgeSymbol[] = [
  edge('hipo', 'hierarchy', 'Module hierarchy', 'none'),
  edge('hipo', 'data-flow', 'Data flow', 'open-arrow'),
  edge('hipo', 'alteration-flow', 'Alteration flow', 'open-arrow', 'solid'),
  edge('hipo', 'action-flow', 'Action flow', 'filled-arrow'),
  edge('hipo', 'reference', 'Reference', 'open-arrow', 'dotted'),
  edge('dfd-yourdon', 'data-flow', 'Data flow', 'open-arrow'),
  edge('dfd-gane-sarson', 'data-flow', 'Data flow', 'open-arrow'),
  ...(
    [
      ['association', 'Association', 'none', 'solid', 'none'],
      ['navigable-association', 'Navigable association', 'open-arrow', 'solid', 'none'],
      ['aggregation', 'Shared aggregation', 'none', 'solid', 'hollow-diamond'],
      ['composition', 'Composition', 'none', 'solid', 'filled-diamond'],
      ['generalization', 'Generalization', 'hollow-triangle', 'solid', 'none'],
      ['realization', 'Realization', 'hollow-triangle', 'dashed', 'none'],
      ['dependency', 'Dependency', 'open-arrow', 'dashed', 'none'],
      ['usage', 'Usage', 'open-arrow', 'dashed', 'none'],
      ['package-import', 'Package import', 'open-arrow', 'dashed', 'none'],
      ['package-merge', 'Package merge', 'open-arrow', 'dashed', 'none'],
      ['extension', 'Stereotype extension', 'filled-triangle', 'solid', 'none'],
      ['include', 'Include', 'open-arrow', 'dashed', 'none'],
      ['extend', 'Extend', 'open-arrow', 'dashed', 'none'],
      ['link', 'Instance link', 'none', 'solid', 'none'],
      ['connector', 'Connector', 'none', 'solid', 'none'],
      ['control-flow', 'Control flow', 'open-arrow', 'solid', 'none'],
      ['object-flow', 'Object flow', 'open-arrow', 'solid', 'none'],
      ['transition', 'Transition', 'open-arrow', 'solid', 'none'],
      ['synchronous-message', 'Synchronous message', 'filled-arrow', 'solid', 'none'],
      ['asynchronous-message', 'Asynchronous message', 'open-arrow', 'solid', 'none'],
      ['reply', 'Reply message', 'open-arrow', 'dashed', 'none'],
      ['create-message', 'Create message', 'open-arrow', 'dashed', 'none'],
      ['delete-message', 'Delete message', 'filled-arrow', 'solid', 'none'],
      ['found-message', 'Found message', 'filled-arrow', 'solid', 'none'],
      ['lost-message', 'Lost message', 'filled-arrow', 'solid', 'none'],
      ['interrupting-flow', 'Interrupting activity edge', 'open-arrow', 'solid', 'none'],
      ['exception-flow', 'Exception flow', 'open-arrow', 'solid', 'none'],
      ['duration', 'Duration interval', 'open-arrow', 'solid', 'open-arrow'],
      ['template-binding', 'Template binding', 'open-arrow', 'dashed', 'none'],
      ['note-link', 'Comment attachment', 'none', 'dashed', 'none'],
    ] as const
  ).map(([id, label, decoration, line, start]) =>
    edge('uml', id, label, decoration, line, start, umlEdgeProperties),
  ),
  edge('bpmn', 'sequence-flow', 'Sequence flow', 'filled-arrow', 'solid', 'none', [
    text('condition', 'Condition'),
    bool('default', 'Default flow'),
  ]),
  edge('bpmn', 'message-flow', 'Message flow', 'open-arrow', 'dashed', 'circle'),
  edge('bpmn', 'association', 'Association', 'none', 'dotted'),
  edge('bpmn', 'data-association', 'Data association', 'open-arrow', 'dotted'),
  edge('bpmn', 'conversation-link', 'Conversation link', 'none'),
];
const nodes = new Map(notationSymbols.map((item) => [`${item.collection}:${item.id}`, item]));
const edges = new Map(notationEdgeSymbols.map((item) => [`${item.collection}:${item.id}`, item]));
export function getNotationSymbol(collection: string | undefined, id: string | undefined) {
  return nodes.get(`${collection}:${id}`);
}
export function getNotationEdgeSymbol(collection: string | undefined, id: string | undefined) {
  return edges.get(`${collection}:${id}`);
}
export function getNotationCollection(id: string | undefined) {
  return notationCollections.find((item) => item.id === id);
}
