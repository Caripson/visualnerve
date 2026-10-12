import { describe, expect, it } from 'vitest';
import { notationBackgroundStyle, notationTitleHasFill } from '../src/notation/appearance';
import { notationGeometry } from '../src/notation/geometry';
import { getNotationSymbol } from '../src/notation/registry';
import type { NodeNotation } from '../src/notation/types';

describe('notation text surfaces', () => {
  it.each([
    ['dfd-gane-sarson', 'process', true],
    ['dfd-yourdon', 'process', true],
    ['uml', 'use-case', true],
    ['uml', 'class', true],
    ['dfd-gane-sarson', 'data-store', false],
    ['dfd-yourdon', 'data-store', false],
    ['uml', 'package', false],
    ['uml', 'actor', false],
    ['bpmn', 'task', true],
    ['bpmn', 'start-event', false],
    ['bpmn', 'end-event', false],
  ] as const)('uses the actual %s/%s label surface for contrast', (collection, symbol, filled) => {
    const value = { collection, symbol } as NodeNotation;
    expect(
      notationTitleHasFill(
        notationGeometry(value),
        getNotationSymbol(collection, symbol)?.container,
      ),
    ).toBe(filled);
  });

  it('inherits theme text and editing surfaces over transparent regions while preserving saved paint', () => {
    expect(notationBackgroundStyle('#E4EEE9', false)).toEqual({ '--node-bg': '#E4EEE9' });
    expect(notationBackgroundStyle('#172d55', false)).toEqual({ '--node-bg': '#172d55' });
    expect(notationBackgroundStyle(undefined, false)).toEqual({});
    expect(notationBackgroundStyle('#E4EEE9', true)).toMatchObject({
      '--node-bg': '#E4EEE9',
      '--text': '#000000',
      '--surface': '#E4EEE9',
    });
  });
});
