import { expect, it } from 'vitest';
import { subtitlePages } from '../src/presentation/video-subtitles';

const measure = (text: string) => Array.from(text).length * 10;

it('retains the existing three-line video pages while allowing two-line live captions', () => {
  const text = 'First line\nSecond line\nThird line\nFourth line';
  expect(subtitlePages(text, measure, 200)).toEqual([
    ['First line', 'Second line', 'Third line'],
    ['Fourth line'],
  ]);
  expect(subtitlePages(text, measure, 200, 2)).toEqual([
    ['First line', 'Second line'],
    ['Third line', 'Fourth line'],
  ]);
});

it('wraps long identifiers without dropping Unicode characters in either page size', () => {
  const text = `${'customer-012345'.repeat(20)}${'🚚'.repeat(10)}`;
  for (const linesPerPage of [2, 3]) {
    const pages = subtitlePages(text, measure, 100, linesPerPage);
    expect(pages.flat().join('')).toBe(text);
    expect(pages.every((page) => page.length <= linesPerPage)).toBe(true);
    expect(pages.flat().every((line) => measure(line) <= 100)).toBe(true);
  }
});

it('handles empty captions and rejects line counts that could make paging unbounded', () => {
  expect(subtitlePages(' \n\r\n ', measure, 100, 2)).toEqual([]);
  for (const linesPerPage of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => subtitlePages('Caption', measure, 100, linesPerPage)).toThrow(RangeError);
});
