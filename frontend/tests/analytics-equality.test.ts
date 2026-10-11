import { describe, expect, it } from 'vitest';
import { analyticsDefinitionsEqual, reconcileAnalytics } from '../src/analytics/reconcile';
import { blankAnalytics } from '../src/analytics/validation';
import { growthChurnInput } from '../src/analytics/example';
import { archiveResult } from '../src/analytics/document';
import { measure } from '../src/analytics/engine';

describe('allocation-bounded semantic equality', () => {
  it('ignores JSON object insertion order but preserves every array position', () => {
    expect(
      analyticsDefinitionsEqual({ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 }),
    ).toBe(true);
    expect(
      analyticsDefinitionsEqual(
        [
          { id: 'a', value: 1 },
          { id: 'b', value: 2 },
        ],
        [
          { value: 1, id: 'a' },
          { value: 2, id: 'b' },
        ],
      ),
    ).toBe(true);
    expect(analyticsDefinitionsEqual([1, 2], [2, 1])).toBe(false);
    expect(analyticsDefinitionsEqual([1], [1, 2])).toBe(false);
    expect(analyticsDefinitionsEqual([1], { 0: 1 })).toBe(false);
  });

  it('distinguishes missing, null, explicit undefined and primitive types', () => {
    expect(analyticsDefinitionsEqual({}, { value: null })).toBe(false);
    expect(analyticsDefinitionsEqual({}, { value: undefined })).toBe(false);
    expect(analyticsDefinitionsEqual({ value: undefined }, { value: null })).toBe(false);
    expect(analyticsDefinitionsEqual({ value: 0 }, { value: false })).toBe(false);
    expect(analyticsDefinitionsEqual({ value: 0 }, { value: '0' })).toBe(false);
    expect(analyticsDefinitionsEqual({ value: -0 }, { value: 0 })).toBe(true);
    expect(analyticsDefinitionsEqual(null, null)).toBe(true);
    expect(analyticsDefinitionsEqual(undefined, undefined)).toBe(true);
  });

  it('keeps unchanged definitions unchanged and detects deeply changed observations', () => {
    const before = growthChurnInput();
    const same = structuredClone(before);
    same.datasets[0].observations[0] = Object.fromEntries(
      Object.entries(same.datasets[0].observations[0]).reverse(),
    ) as (typeof same.datasets)[0]['observations'][number];
    const unchanged = reconcileAnalytics(before, same);
    expect(unchanged.datasets[0].version).toBe(before.datasets[0].version);
    const changed = structuredClone(before);
    changed.datasets[0].observations.at(-1)!.value! += 1;
    expect(reconcileAnalytics(before, changed).datasets[0].version).toBe(2);
    expect(before.datasets[0].version).toBe(1);
  });

  it('retains immutable archive enforcement and exact one-step version transitions', () => {
    const initial = growthChurnInput();
    const before = archiveResult(
      initial,
      measure(initial, initial.measurements[0]),
      { measurement: initial.measurements[0] },
      1,
    );
    const unchanged = reconcileAnalytics(before, structuredClone(before));
    expect(unchanged.results[0]).toEqual(before.results[0]);
    const forged = structuredClone(before);
    forged.results[0].inputSnapshot.datasets[0].observations[0].value = 999;
    expect(() => reconcileAnalytics(before, forged)).toThrow(/immutable/);
    const jumped = structuredClone(before);
    jumped.datasets[0].observations.at(-1)!.value! += 1;
    jumped.datasets[0].version += 2;
    expect(() => reconcileAnalytics(before, jumped)).toThrow(/exactly one/);
    const newModel = blankAnalytics();
    newModel.datasets = [{ ...initial.datasets[0], version: 2 }];
    newModel.series = initial.series;
    expect(() => reconcileAnalytics(blankAnalytics(), newModel)).toThrow(/start at version 1/);
  });
});
