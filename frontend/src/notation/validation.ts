import type { Graph, GraphNode } from '../model/types';
import { StorageError } from '../model/errors';
import {
  bpmnEventContexts,
  umlAttachmentTargets,
  getNotationCollection,
  getNotationEdgeSymbol,
  getNotationSymbol,
  notationCompartmentLimit,
} from './registry';
import {
  notationLimits,
  type BpmnProperties,
  type EdgeNotation,
  type NodeNotation,
  type NotationProfile,
  type NotationPropertyDefinition,
} from './types';

export interface NotationIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}
export class NotationValidationError extends StorageError {
  readonly code = 'INVALID_NOTATION';
  readonly issues: readonly NotationIssue[];
  constructor(path: string, message: string) {
    super(422, `${path}: ${message}`);
    this.issues = [{ code: this.code, path, message, severity: 'error' }];
  }
}
function check(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) throw new NotationValidationError(path, message);
}
function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  check(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    path,
    'must be an object',
  );
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value))
    check(allowed.includes(key), `${path}.${key}`, 'unknown field');
}
function text(
  value: unknown,
  path: string,
  maximum: number,
  nonempty = false,
): asserts value is string {
  check(
    typeof value === 'string' && value.length <= maximum && (!nonempty || value.length > 0),
    path,
    `must be ${nonempty ? 'a nonempty' : 'a'} string of at most ${maximum} characters`,
  );
}
function id(value: unknown, path: string) {
  text(value, path, notationLimits.id, true);
  check(
    /^[a-z][a-z0-9-]*(?![\s\S])/.test(value),
    path,
    'must use lowercase letters, numbers and hyphens',
  );
}
function properties(
  value: unknown,
  definitions: readonly NotationPropertyDefinition[],
  path: string,
) {
  object(value, path);
  keys(
    value,
    definitions.map((item) => item.key),
    path,
  );
  for (const descriptor of definitions) {
    const item = value[descriptor.key];
    if (item === undefined) continue;
    const key = `${path}.${descriptor.key}`;
    switch (descriptor.type) {
      case 'text':
        text(item, key, notationLimits.text);
        break;
      case 'boolean':
        check(typeof item === 'boolean', key, 'must be boolean');
        break;
      case 'enum':
        check(
          typeof item === 'string' && descriptor.values?.includes(item),
          key,
          'unsupported value',
        );
        break;
      case 'integer':
      case 'number':
        check(
          typeof item === 'number' &&
            Number.isFinite(item) &&
            Math.abs(item) <= notationLimits.coordinate &&
            (descriptor.type !== 'integer' || Number.isInteger(item)) &&
            (descriptor.minimum === undefined || item >= descriptor.minimum) &&
            (descriptor.maximum === undefined || item <= descriptor.maximum),
          key,
          'number is outside the supported range',
        );
        break;
      case 'timing-states': {
        check(
          Array.isArray(item) && item.length <= notationLimits.timingStates,
          key,
          'too many timing states',
        );
        let previous = -Infinity;
        for (const [index, point] of item.entries()) {
          object(point, `${key}[${index}]`);
          keys(point, ['time', 'state'], `${key}[${index}]`);
          check(
            typeof point.time === 'number' &&
              Number.isFinite(point.time) &&
              Math.abs(point.time) <= notationLimits.coordinate &&
              point.time > previous,
            `${key}[${index}].time`,
            'times must be finite and strictly increasing',
          );
          text(point.state, `${key}[${index}].state`, notationLimits.label, true);
          previous = point.time;
          if (typeof value.timeStart === 'number')
            check(
              point.time >= value.timeStart,
              `${key}[${index}].time`,
              'time precedes the diagram start',
            );
          if (typeof value.timeEnd === 'number')
            check(
              point.time <= value.timeEnd,
              `${key}[${index}].time`,
              'time exceeds the diagram end',
            );
        }
        break;
      }
    }
  }
}
export function validateNotationProfile(value: unknown): asserts value is NotationProfile {
  object(value, 'notation');
  keys(value, ['schemaVersion', 'collection', 'diagramKind'], 'notation');
  check(value.schemaVersion === 1, 'notation.schemaVersion', 'must be 1');
  const collection =
    typeof value.collection === 'string' ? getNotationCollection(value.collection) : undefined;
  check(collection, 'notation.collection', 'unknown collection');
  check(
    collection.diagramKinds.some((kind) => kind.id === value.diagramKind),
    'notation.diagramKind',
    'unsupported diagram kind',
  );
}
export function validateNodeNotation(value: unknown): asserts value is NodeNotation {
  const path = 'node.notation';
  object(value, path);
  keys(
    value,
    [
      'collection',
      'symbol',
      'diagramKind',
      'properties',
      'compartments',
      'ports',
      'attachmentId',
      'relatedNodeId',
    ],
    path,
  );
  const symbol =
    typeof value.collection === 'string' && typeof value.symbol === 'string'
      ? getNotationSymbol(value.collection, value.symbol)
      : undefined;
  check(symbol, path, 'unknown collection or symbol');
  if (value.diagramKind !== undefined)
    check(
      symbol.diagramKinds.includes(value.diagramKind as never),
      `${path}.diagramKind`,
      'unsupported diagram kind for this symbol',
    );
  if (value.properties !== undefined)
    properties(value.properties, symbol.properties, `${path}.properties`);
  for (const key of ['attachmentId', 'relatedNodeId'])
    if (value[key] !== undefined) text(value[key], `${path}.${key}`, notationLimits.id, true);
  if (value.attachmentId !== undefined)
    check(
      (value.collection === 'bpmn' && value.symbol === 'boundary-event') ||
        (value.collection === 'uml' && umlAttachmentTargets[value.symbol as string]),
      `${path}.attachmentId`,
      'this symbol does not support an attachment',
    );
  if (value.compartments !== undefined) {
    check(symbol.compartments, `${path}.compartments`, 'this symbol has no compartments');
    check(
      Array.isArray(value.compartments) &&
        value.compartments.length <=
          notationCompartmentLimit({
            collection: value.collection as string,
            symbol: value.symbol as string,
            diagramKind: value.diagramKind as string | undefined,
            properties: value.properties,
          }),
      `${path}.compartments`,
      'too many compartments',
    );
    const seen = new Set<string>();
    let length = 0;
    value.compartments.forEach((item: unknown, index: number) => {
      const key = `${path}.compartments[${index}]`;
      object(item, key);
      keys(item, ['id', 'title', 'lines'], key);
      id(item.id, `${key}.id`);
      check(!seen.has(item.id as string), `${key}.id`, 'duplicate compartment');
      seen.add(item.id as string);
      if (item.title !== undefined) text(item.title, `${key}.title`, notationLimits.label);
      check(
        Array.isArray(item.lines) && item.lines.length <= notationLimits.linesPerCompartment,
        `${key}.lines`,
        'too many lines',
      );
      item.lines.forEach((line: unknown, lineIndex: number) => {
        text(line, `${key}.lines[${lineIndex}]`, notationLimits.text);
        length += line.length;
      });
    });
    check(
      length <= notationLimits.compartmentText,
      `${path}.compartments`,
      'total compartment text is too large',
    );
  }
  if (value.ports !== undefined) {
    check(
      Array.isArray(value.ports) && value.ports.length <= notationLimits.ports,
      `${path}.ports`,
      'too many ports',
    );
    const seen = new Set<string>();
    value.ports.forEach((item: unknown, index: number) => {
      const key = `${path}.ports[${index}]`;
      object(item, key);
      keys(item, ['id', 'side', 'offset', 'direction', 'label'], key);
      id(item.id, `${key}.id`);
      check(!seen.has(item.id as string), `${key}.id`, 'duplicate port');
      seen.add(item.id as string);
      check(
        ['left', 'right', 'top', 'bottom'].includes(item.side as string),
        `${key}.side`,
        'unsupported side',
      );
      if (item.offset !== undefined)
        check(
          typeof item.offset === 'number' &&
            Number.isFinite(item.offset) &&
            item.offset >= 0 &&
            item.offset <= 1,
          `${key}.offset`,
          'must be a fraction from 0 to 1',
        );
      if (item.direction !== undefined)
        check(
          ['in', 'out', 'both'].includes(item.direction as string),
          `${key}.direction`,
          'unsupported direction',
        );
      if (item.label !== undefined) text(item.label, `${key}.label`, notationLimits.label);
    });
  }
  if (value.collection === 'uml' && value.properties) {
    const props = value.properties as Record<string, unknown>;
    if (props.timeStart !== undefined && props.timeEnd !== undefined)
      check(
        (props.timeStart as number) <= (props.timeEnd as number),
        `${path}.properties.timeEnd`,
        'must not precede the start time',
      );
  }
  if (value.collection === 'bpmn')
    validateBpmnCombination(
      value.symbol as string,
      value.properties as BpmnProperties | undefined,
      path,
    );
}
function validateBpmnCombination(symbol: string, props: BpmnProperties = {}, path: string) {
  let allowed: readonly string[] | undefined;
  if (symbol === 'start-event') {
    check(
      !props.nonInterrupting || props.eventSubProcess === true,
      `${path}.properties.nonInterrupting`,
      'non-interrupting starts require an event subprocess',
    );
    allowed = props.eventSubProcess
      ? props.nonInterrupting
        ? bpmnEventContexts.nonInterruptingStart
        : bpmnEventContexts.eventSubProcessStart
      : bpmnEventContexts.topLevelStart;
  } else if (symbol === 'boundary-event')
    allowed = props.nonInterrupting
      ? bpmnEventContexts.nonInterruptingBoundary
      : bpmnEventContexts.boundary;
  else if (symbol === 'intermediate-catch-event') allowed = bpmnEventContexts.intermediateCatch;
  else if (symbol === 'intermediate-throw-event') allowed = bpmnEventContexts.intermediateThrow;
  else if (symbol === 'end-event') allowed = bpmnEventContexts.end;
  if (allowed) {
    const event =
      props.eventDefinition ??
      (symbol === 'boundary-event' || symbol === 'intermediate-catch-event' ? 'message' : 'none');
    check(
      allowed.includes(event),
      `${path}.properties.eventDefinition`,
      'event definition is not applicable to this event context',
    );
  }
  if (symbol === 'event-based-gateway')
    check(
      !props.parallel || props.instantiating === true,
      `${path}.properties.parallel`,
      'parallel event gateways must be instantiating',
    );
}
function multiplicity(value: unknown, path: string) {
  text(value, path, notationLimits.multiplicity, true);
  check(
    /^(?:\*|(?:0|[1-9]\d*)(?:\.\.(?:\*|0|[1-9]\d*))?)(?![\s\S])/.test(value),
    path,
    'expected *, an integer, or a lower..upper range',
  );
  const [lower, upper] = value.split('..');
  if (lower !== '*') check(Number.isSafeInteger(Number(lower)), path, 'multiplicity is too large');
  if (upper && upper !== '*')
    check(
      Number.isSafeInteger(Number(upper)) && Number(upper) >= Number(lower),
      path,
      'upper multiplicity must not be below lower',
    );
}
export function validateEdgeNotation(value: unknown): asserts value is EdgeNotation {
  const path = 'edge.notation';
  object(value, path);
  keys(
    value,
    [
      'collection',
      'symbol',
      'sourcePort',
      'targetPort',
      'sourceLabel',
      'targetLabel',
      'sourceMultiplicity',
      'targetMultiplicity',
      'waypoints',
      'properties',
    ],
    path,
  );
  const symbol =
    typeof value.collection === 'string' && typeof value.symbol === 'string'
      ? getNotationEdgeSymbol(value.collection, value.symbol)
      : undefined;
  check(symbol, path, 'unknown collection or connector');
  if (value.properties !== undefined) {
    check(symbol.properties.length > 0, `${path}.properties`, 'this connector has no properties');
    properties(value.properties, symbol.properties, `${path}.properties`);
  }
  for (const key of ['sourcePort', 'targetPort'])
    if (value[key] !== undefined) id(value[key], `${path}.${key}`);
  for (const key of ['sourceLabel', 'targetLabel'])
    if (value[key] !== undefined) text(value[key], `${path}.${key}`, notationLimits.label);
  for (const key of ['sourceMultiplicity', 'targetMultiplicity'])
    if (value[key] !== undefined) {
      check(value.collection === 'uml', `${path}.${key}`, 'multiplicity belongs to UML connectors');
      multiplicity(value[key], `${path}.${key}`);
    }
  if (value.waypoints !== undefined) {
    check(
      Array.isArray(value.waypoints) && value.waypoints.length <= notationLimits.waypoints,
      `${path}.waypoints`,
      'too many waypoints',
    );
    value.waypoints.forEach((point: unknown, index: number) =>
      check(
        Array.isArray(point) &&
          point.length === 2 &&
          point.every(
            (item) =>
              typeof item === 'number' &&
              Number.isFinite(item) &&
              Math.abs(item) <= notationLimits.coordinate,
          ),
        `${path}.waypoints[${index}]`,
        'expected two finite logical coordinates',
      ),
    );
  }
  if (value.collection === 'bpmn' && value.symbol === 'sequence-flow' && value.properties) {
    const props = value.properties as Record<string, unknown>;
    check(
      !(props.default === true && props.condition !== undefined && props.condition !== ''),
      `${path}.properties`,
      'default flow cannot have a condition',
    );
  }
}
const sides = ['left', 'right', 'top', 'bottom'];
export function validateNotationGraph(graph: Graph): void {
  if (graph.diagram.notation !== undefined) validateNotationProfile(graph.diagram.notation);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    if (node.notation === undefined) continue;
    validateNodeNotation(node.notation);
    for (const field of ['attachmentId', 'relatedNodeId'] as const) {
      const target: string | undefined = node.notation[field];
      if (target === undefined) continue;
      check(
        target !== node.id && nodes.has(target),
        `nodes.${node.id}.notation.${field}`,
        'must reference another existing node',
      );
      if (field === 'attachmentId') {
        const targetNotation: NodeNotation | undefined = nodes.get(target)?.notation;
        const allowed =
          node.notation.collection === 'bpmn'
            ? [
                'task',
                'subprocess',
                'event-subprocess',
                'transaction',
                'call-activity',
                'ad-hoc-subprocess',
              ]
            : umlAttachmentTargets[node.notation.symbol];
        check(
          targetNotation?.collection === node.notation.collection &&
            allowed?.includes(targetNotation.symbol),
          `nodes.${node.id}.notation.attachmentId`,
          'attachment target is not applicable to this symbol',
        );
      }
    }
  }
  for (const edge of graph.edges) {
    if (edge.notation === undefined) continue;
    validateEdgeNotation(edge.notation);
    for (const end of ['source', 'target'] as const) {
      const port = edge.notation[`${end}Port`];
      if (!port) continue;
      const endpoint = nodes.get(end === 'source' ? edge.sourceNodeId : edge.targetNodeId);
      const custom = endpoint?.notation?.ports?.find((item) => item.id === port);
      check(
        custom || sides.includes(port),
        `edges.${edge.id}.notation.${end}Port`,
        'port does not exist on the endpoint',
      );
      if (custom)
        check(
          custom.direction !== (end === 'source' ? 'in' : 'out'),
          `edges.${edge.id}.notation.${end}Port`,
          'port direction does not permit this connection',
        );
    }
  }
}
/** Model checks are advisory so incomplete diagrams can be saved and collaboratively edited. */
export function notationIssues(graph: Graph): readonly NotationIssue[] {
  const issues: NotationIssue[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, typeof graph.edges>();
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const targets = incoming.get(edge.targetNodeId) ?? [],
      sources = outgoing.get(edge.sourceNodeId) ?? [];
    targets.push(edge);
    sources.push(edge);
    incoming.set(edge.targetNodeId, targets);
    outgoing.set(edge.sourceNodeId, sources);
  }
  const add = (code: string, path: string, message: string) => {
    issues.push({ code, path, message, severity: 'warning' });
  };
  const pool = (node: GraphNode | undefined) => {
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      if (node.notation?.collection === 'bpmn' && node.notation.symbol === 'pool') return node.id;
      seen.add(node.id);
      node = node.parentId ? nodes.get(node.parentId) : undefined;
    }
    return undefined;
  };
  for (const node of graph.nodes) {
    const value = node.notation;
    if (!value) continue;
    const path = `nodes.${node.id}.notation`;
    const profile = graph.diagram.notation;
    if (
      profile &&
      value.collection === profile.collection &&
      value.diagramKind === undefined &&
      !getNotationSymbol(value.collection, value.symbol)?.diagramKinds.includes(profile.diagramKind)
    )
      add(
        'DIAGRAM_KIND',
        path,
        'Set an explicit diagram kind for this object or choose a symbol for the active profile.',
      );
    if (value.collection.startsWith('dfd-') && value.symbol === 'process') {
      if (!(incoming.get(node.id) ?? []).some((edge) => edge.notation?.symbol === 'data-flow'))
        add('DFD_INPUT', path, 'Process has no incoming data flow.');
      if (!(outgoing.get(node.id) ?? []).some((edge) => edge.notation?.symbol === 'data-flow'))
        add('DFD_OUTPUT', path, 'Process has no outgoing data flow.');
    }
    if (value.collection === 'bpmn') {
      const props = value.properties as BpmnProperties | undefined;
      if (value.symbol === 'boundary-event' && !value.attachmentId)
        add('BOUNDARY_ATTACHMENT', path, 'Attach the boundary event to its activity.');
      if (
        (value.symbol === 'boundary-event' || value.symbol === 'end-event') &&
        props?.eventDefinition === 'cancel'
      ) {
        const activity = value.attachmentId
          ? nodes.get(value.attachmentId)
          : node.parentId
            ? nodes.get(node.parentId)
            : undefined;
        if (activity?.notation?.symbol !== 'transaction')
          add('CANCEL_TRANSACTION', path, 'Cancel events belong to a transaction subprocess.');
      }
      if (
        value.symbol === 'start-event' &&
        (incoming.get(node.id) ?? []).some((edge) => edge.notation?.symbol === 'sequence-flow')
      )
        add('START_INCOMING', path, 'Start events cannot receive a sequence flow.');
      if (
        value.symbol === 'end-event' &&
        (outgoing.get(node.id) ?? []).some((edge) => edge.notation?.symbol === 'sequence-flow')
      )
        add('END_OUTGOING', path, 'End events cannot send a sequence flow.');
      if (value.symbol === 'start-event' && node.parentId) {
        const parent = nodes.get(node.parentId);
        if (
          parent?.notation?.collection === 'bpmn' &&
          parent.notation.symbol === 'event-subprocess' &&
          !props?.eventSubProcess
        )
          add(
            'EVENT_SUBPROCESS_START',
            path,
            'An event subprocess needs an event subprocess start variant.',
          );
        if (
          parent?.notation?.collection === 'bpmn' &&
          ['subprocess', 'transaction', 'ad-hoc-subprocess'].includes(parent.notation.symbol) &&
          props?.eventDefinition &&
          props.eventDefinition !== 'none'
        )
          add('SUBPROCESS_START', path, 'An ordinary subprocess uses a none start event.');
      }
    }
  }
  for (const edge of graph.edges) {
    const value = edge.notation;
    if (!value) continue;
    const path = `edges.${edge.id}.notation`;
    const source = nodes.get(edge.sourceNodeId),
      target = nodes.get(edge.targetNodeId);
    if (value.collection.startsWith('dfd-')) {
      if (
        source?.notation?.collection !== value.collection ||
        target?.notation?.collection !== value.collection
      )
        add('DFD_DIALECT', path, 'Data-flow endpoints should belong to the same DFD dialect.');
      else if (source.notation.symbol !== 'process' && target.notation.symbol !== 'process')
        add('DFD_TRANSFORMATION', path, 'A data flow needs a process at one endpoint.');
    }
    if (value.collection === 'bpmn') {
      const a = pool(source),
        b = pool(target);
      if (value.symbol === 'sequence-flow' && a !== b)
        add('SEQUENCE_POOL', path, 'Sequence flow cannot cross participant pools.');
      if (value.symbol === 'message-flow' && a !== undefined && a === b)
        add('MESSAGE_POOL', path, 'Message flow connects different participants.');
      if (
        value.symbol === 'sequence-flow' &&
        source?.notation?.symbol === 'event-based-gateway' &&
        !['intermediate-catch-event', 'task'].includes(target?.notation?.symbol ?? '')
      )
        add(
          'EVENT_GATEWAY_TARGET',
          path,
          'Event-based gateways lead to catching events or receiving tasks.',
        );
    }
  }
  if (
    graph.diagram.notation?.collection.startsWith('dfd-') &&
    graph.diagram.notation.diagramKind === 'context' &&
    graph.nodes.filter(
      (node) =>
        node.notation?.collection === graph.diagram.notation?.collection &&
        node.notation?.symbol === 'process',
    ).length !== 1
  )
    add('DFD_CONTEXT', 'diagram.notation', 'A context diagram has one system process.');
  return issues;
}
