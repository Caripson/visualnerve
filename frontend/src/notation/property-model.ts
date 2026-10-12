import type { BpmnProperties, NodeNotation, NotationPropertyDefinition } from './types';
import { bpmnEventContexts } from './registry';
import type { NotationPropertyValue } from './PropertyFields';

export function eventChoices(value: NodeNotation): readonly string[] | undefined {
  if (value.collection !== 'bpmn') return undefined;
  const properties = value.properties;
  switch (value.symbol) {
    case 'start-event':
      return properties?.eventSubProcess
        ? properties.nonInterrupting
          ? bpmnEventContexts.nonInterruptingStart
          : bpmnEventContexts.eventSubProcessStart
        : bpmnEventContexts.topLevelStart;
    case 'boundary-event':
      return properties?.nonInterrupting
        ? bpmnEventContexts.nonInterruptingBoundary
        : bpmnEventContexts.boundary;
    case 'intermediate-catch-event':
      return bpmnEventContexts.intermediateCatch;
    case 'intermediate-throw-event':
      return bpmnEventContexts.intermediateThrow;
    case 'end-event':
      return bpmnEventContexts.end;
  }
}
export function editableNodeFields(
  value: NodeNotation,
  fields: readonly NotationPropertyDefinition[],
): readonly NotationPropertyDefinition[] {
  const choices = eventChoices(value);
  return fields.map((field) =>
    field.key === 'eventDefinition' && choices ? { ...field, values: choices } : field,
  );
}
/** UI changes an event context and its applicable marker in one reviewable history step. */
export function editNodeProperty(
  value: NodeNotation,
  key: string,
  next: NotationPropertyValue,
): NodeNotation {
  const properties: Record<string, unknown> = { ...value.properties, [key]: next };
  if (next === undefined) delete properties[key];
  const result = { ...value, properties } as NodeNotation;
  if (result.collection === 'bpmn') {
    const values = result.properties as BpmnProperties;
    if (result.symbol === 'start-event') {
      if (key === 'nonInterrupting' && next === true) values.eventSubProcess = true;
      if (key === 'eventSubProcess' && next === false) values.nonInterrupting = false;
    }
    if (result.symbol === 'event-based-gateway') {
      if (key === 'parallel' && next === true) values.instantiating = true;
      if (key === 'instantiating' && next === false) values.parallel = false;
    }
    const allowed = eventChoices(result);
    const defaultEvent = ['boundary-event', 'intermediate-catch-event'].includes(result.symbol)
      ? 'message'
      : 'none';
    if (allowed && !allowed.includes(values.eventDefinition ?? defaultEvent))
      values.eventDefinition = allowed[0] as BpmnProperties['eventDefinition'];
  }
  return result;
}
