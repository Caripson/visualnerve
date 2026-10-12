import { describe, expect, it } from 'vitest';
import { notationCompartmentDefaults, notationCompartmentLimit } from '../src/notation/registry';
import { notationGeometry } from '../src/notation/geometry';
import { validateNodeNotation } from '../src/notation/validation';
import type { NodeNotation, NotationRect } from '../src/notation/types';

const sections = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `section-${index}`,
    title: `Section ${index}`,
    lines: [`Entry ${index}`],
  }));
const overlaps = (a: NotationRect, b: NotationRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('fixed notation text regions', () => {
  it('limits overview IPO to three slots and detail IPO to four by either detail selector', () => {
    const overview: NodeNotation = {
      collection: 'hipo',
      symbol: 'ipo-chart',
      diagramKind: 'overview-ipo',
      compartments: sections(3),
    };
    expect(notationCompartmentLimit(overview)).toBe(3);
    validateNodeNotation(overview);
    expect(() => validateNodeNotation({ ...overview, compartments: sections(4) })).toThrow(
      'too many compartments',
    );
    for (const value of [
      { ...overview, diagramKind: 'detail-ipo', properties: { detail: 'overview' } },
      { ...overview, diagramKind: 'overview-ipo', properties: { detail: 'detail' } },
    ] as NodeNotation[]) {
      expect(notationCompartmentLimit(value)).toBe(4);
      validateNodeNotation({ ...value, compartments: sections(4) });
      expect(() => validateNodeNotation({ ...value, compartments: sections(5) })).toThrow(
        'too many compartments',
      );
    }
    expect(
      notationCompartmentDefaults(overview, [
        'Input',
        'Process',
        'Output',
        'Extended description',
      ]).map((section) => section.id),
    ).toEqual(['input', 'process', 'output']);
  });

  it.each(['choreography-task', 'sub-choreography', 'call-choreography'])(
    'rejects a fourth invisible %s participant section',
    (symbol) => {
      const value: NodeNotation = { collection: 'bpmn', symbol, compartments: sections(3) };
      validateNodeNotation(value);
      expect(notationCompartmentLimit(value)).toBe(3);
      expect(() => validateNodeNotation({ ...value, compartments: sections(4) })).toThrow(
        'too many compartments',
      );
      expect(
        notationCompartmentDefaults(value, ['Initiator', 'Activity', 'Responder', 'Extra']).map(
          (section) => section.id,
        ),
      ).toEqual(['initiating-participant', 'activity', 'other-participant']);
    },
  );

  it('reserves canonical slots before custom sections and never duplicates a missing-input section', () => {
    for (const compartments of [
      [{ id: 'process', lines: ['Process only'] }],
      [
        { id: 'custom-input', lines: ['Input'] },
        { id: 'output', lines: ['Output'] },
        { id: 'process', lines: ['Process'] },
      ],
      [
        { id: 'output', lines: ['Output'] },
        { id: 'custom-process', lines: ['Process'] },
        { id: 'input', lines: ['Input'] },
      ],
    ]) {
      const shape = notationGeometry({ collection: 'hipo', symbol: 'ipo-chart', compartments });
      expect(shape.compartmentBoxes).toHaveLength(compartments.length);
      expect(new Set(shape.compartmentBoxes!.map((box) => box.id)).size).toBe(compartments.length);
      expect([...shape.compartmentBoxes!.map((box) => box.id)].sort()).toEqual(
        compartments.map((section) => section.id).sort(),
      );
      for (const box of shape.compartmentBoxes!) {
        if (box.id === 'input') expect(box.x).toBeCloseTo(0.015);
        if (box.id === 'process') expect(box.x).toBeCloseTo(1 / 3 + 0.015);
        if (box.id === 'output') expect(box.x).toBeCloseTo(2 / 3 + 0.015);
      }
    }
  });

  it('shades the noninitiating band and keeps choreography rename/title separate from activity entries', () => {
    for (const participant of ['initiating', 'non-initiating'] as const) {
      const value: NodeNotation = {
        collection: 'bpmn',
        symbol: 'choreography-task',
        properties: { participant },
        compartments: notationCompartmentDefaults(
          { collection: 'bpmn', symbol: 'choreography-task' },
          ['Initiator', 'Activity', 'Responder'],
        ),
      };
      const shape = notationGeometry(value),
        boxes = shape.compartmentBoxes!;
      const initiator = boxes.find((box) => box.id === 'initiating-participant')!,
        responder = boxes.find((box) => box.id === 'other-participant')!;
      expect(initiator.y).toBe(participant === 'initiating' ? 0.025 : 0.8);
      expect(responder.y).toBe(participant === 'initiating' ? 0.8 : 0.025);
      expect(shape.shadedPaths).toEqual([
        participant === 'initiating'
          ? 'M 0 76 L 100 76 L 100 100 L 0 100 Z'
          : 'M 0 0 L 100 0 L 100 24 L 0 24 Z',
      ]);
      for (const box of boxes) expect(overlaps(box, shape.contentBox)).toBe(false);
      const size = 280;
      expect(boxes.find((box) => box.id === 'activity')!.height * size).toBeGreaterThan(
        19 + 12 * 1.35 + 8,
      );
    }
    expect(
      notationGeometry({
        collection: 'bpmn',
        symbol: 'participant-band',
        properties: { participant: 'initiating' },
      }).shadedPaths,
    ).toEqual([]);
    expect(
      notationGeometry({
        collection: 'bpmn',
        symbol: 'participant-band',
        properties: { participant: 'non-initiating' },
      }).shadedPaths,
    ).toHaveLength(1);
  });

  it('puts formal parameters in the dashed upper-right box and retains every body section', () => {
    const compartments = [
      { id: 'attributes', lines: ['- total: Money'] },
      { id: 'parameters', lines: ['T: Item'] },
      { id: 'operations', lines: ['+ reserve(): void'] },
    ];
    const shape = notationGeometry({
      collection: 'uml',
      symbol: 'template-classifier',
      compartments,
    });
    const parameter = shape.compartmentBoxes!.find((box) => box.id === 'parameters')!;
    expect(parameter).toEqual({ id: 'parameters', x: 0.565, y: 0.015, width: 0.42, height: 0.25 });
    expect(shape.dashedPaths).toEqual(['M 55 0 L 100 0 L 100 28 L 55 28 Z']);
    for (const box of shape.compartmentBoxes!) expect(overlaps(box, shape.contentBox)).toBe(false);
    for (const id of ['attributes', 'operations'])
      expect(shape.compartmentBoxes!.find((box) => box.id === id)!.y).toBeGreaterThan(0.34);
    for (const count of [1, 3, 16]) {
      const values = sections(count),
        result = notationGeometry({
          collection: 'uml',
          symbol: 'template-classifier',
          compartments: values,
        });
      expect(result.compartmentBoxes).toHaveLength(count);
      expect(result.compartmentBoxes!.every((box) => box.height > 0)).toBe(true);
      expect(new Set(result.compartmentBoxes!.map((box) => box.id)).size).toBe(count);
      expect(result.compartmentBoxes![0].y).toBe(0.015);
    }
  });

  it('keeps interaction reference names, operator tabs, guards and operands in distinct regions', () => {
    const use = notationGeometry({ collection: 'uml', symbol: 'interaction-use' });
    expect(use.prefixBox).toEqual({ x: 0.04, y: 0.025, width: 0.2, height: 0.12 });
    expect(use.contentBox).toEqual({ x: 0.04, y: 0.24, width: 0.92, height: 0.5 });
    const combined = notationGeometry({
      collection: 'uml',
      symbol: 'combined-fragment',
      properties: { operator: 'alt', guard: 'approved' },
      compartments: sections(2),
    });
    expect(combined.contentBox).toEqual({ x: 0.34, y: 0.025, width: 0.62, height: 0.12 });
    expect(combined.guardBox).toEqual({ x: 0.34, y: 0.15, width: 0.62, height: 0.08 });
    const regions = [
      combined.prefixBox!,
      combined.contentBox,
      combined.guardBox!,
      ...combined.compartmentBoxes!,
    ];
    for (let i = 0; i < regions.length; i++)
      for (let j = i + 1; j < regions.length; j++)
        expect(overlaps(regions[i], regions[j])).toBe(false);
  });

  it('draws square operand guards and line-based named observations instead of constraint braces', () => {
    expect(notationGeometry({ collection: 'uml', symbol: 'operand-guard' }).outlinePath).toBe(
      'M 12 10 H 4 V 90 H 12 M 88 10 H 96 V 90 H 88',
    );
    for (const symbol of ['time-observation', 'duration-observation']) {
      const shape = notationGeometry({ collection: 'uml', symbol });
      expect(shape.outlinePath).toBe('M 0 80 H 100');
      expect(shape.outlineFill).toBe('none');
      expect(shape.reliefContours).toHaveLength(1);
      expect(shape.contentBox.y + shape.contentBox.height).toBeLessThan(0.8);
    }
    expect(
      notationGeometry({ collection: 'uml', symbol: 'time-constraint' }).outlinePath,
    ).toContain('Q');
  });
});
