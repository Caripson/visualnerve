import { notationLimits, type NotationCompartment, type NotationCompartmentBox } from './types';

/** Fixed IPO columns and choreography participant bands cannot acquire invisible extra sections. */
export const notationCompartmentLimits = {
  hipo: { 'ipo-chart': { default: 3, detail: 4 } },
  bpmn: { 'choreography-task': 3, 'sub-choreography': 3, 'call-choreography': 3 },
} as const;
export interface NotationCompartmentContext {
  collection: string;
  symbol: string;
  diagramKind?: string;
  properties?: unknown;
}
export function notationCompartmentLimit(value: NotationCompartmentContext): number {
  if (value.collection === 'hipo' && value.symbol === 'ipo-chart') {
    const detail =
      value.diagramKind === 'detail-ipo' ||
      (value.properties != null &&
        typeof value.properties === 'object' &&
        'detail' in value.properties &&
        value.properties.detail === 'detail');
    return notationCompartmentLimits.hipo['ipo-chart'][detail ? 'detail' : 'default'];
  }
  if (value.collection === 'bpmn' && value.symbol in notationCompartmentLimits.bpmn)
    return notationCompartmentLimits.bpmn[
      value.symbol as keyof typeof notationCompartmentLimits.bpmn
    ];
  return notationLimits.compartments;
}
export function notationCompartmentDefaults(
  value: NotationCompartmentContext,
  titles: readonly string[],
): NotationCompartment[] {
  const ids =
    value.collection === 'hipo' && value.symbol === 'ipo-chart'
      ? ['input', 'process', 'output', 'extended-description']
      : value.collection === 'bpmn' && value.symbol in notationCompartmentLimits.bpmn
        ? ['initiating-participant', 'activity', 'other-participant']
        : undefined;
  return titles
    .slice(0, notationCompartmentLimit(value))
    .map((title, index) => ({ id: ids?.[index] ?? `section-${index}`, title, lines: [] }));
}
/** Reserve explicit canonical slots first; assign every remaining section once to a free slot. */
export function assignNotationCompartments(
  boxes: readonly NotationCompartmentBox[],
  sections: readonly NotationCompartment[] | undefined,
): NotationCompartmentBox[] {
  if (!sections?.length) return [...boxes];
  const used = new Set<string>(),
    assigned = new Map<number, NotationCompartment>();
  boxes.forEach((box, index) => {
    const section = sections.find((section) => section.id === box.id);
    if (section) {
      assigned.set(index, section);
      used.add(section.id);
    }
  });
  const remaining = sections.filter((section) => !used.has(section.id));
  boxes.forEach((_, index) => {
    if (!assigned.has(index)) {
      const section = remaining.shift();
      if (section) assigned.set(index, section);
    }
  });
  return boxes.flatMap((box, index) => {
    const section = assigned.get(index);
    return section ? [{ ...box, id: section.id }] : [];
  });
}
