import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawingSvg } from '../src/drawing/DrawingSvg';
import {
  drawingBounds,
  strokeBounds,
  strokeHitTest,
  strokePath,
  unionBounds,
} from '../src/drawing/geometry';
import type { DrawingStroke } from '../src/drawing/types';

function stroke(points: [number, number][], width = 4): DrawingStroke {
  return { id: crypto.randomUUID(), color: '#cc1177', width, points };
}

describe('shared freehand drawing geometry', () => {
  it('creates rounded midpoint paths with exact endpoints and handles lines and dots', () => {
    expect(strokePath([])).toBe('');
    expect(strokePath([[12, -4]])).toBe('M 12 -4');
    expect(
      strokePath([
        [0, 0],
        [10, 20],
      ]),
    ).toBe('M 0 0 L 10 20');
    expect(
      strokePath([
        [0, 0],
        [100, 100],
        [200, 0],
      ]),
    ).toBe('M 0 0 Q 100 100 150 50 L 200 0');
    expect(
      strokePath([
        [0, 0],
        [10, 20],
        [20, 10],
        [30, 0],
      ]),
    ).toBe('M 0 0 Q 10 20 15 15 Q 20 10 25 5 L 30 0');
  });

  it('includes pen radius, negative coordinates and single-point circles in export bounds', () => {
    const line = stroke(
      [
        [-100, 40],
        [20, -50],
      ],
      10,
    );
    const dot = stroke([[200, 200]], 20);
    expect(strokeBounds(line)).toEqual({ x: -105, y: -55, width: 130, height: 100 });
    expect(strokeBounds(dot)).toEqual({ x: 190, y: 190, width: 20, height: 20 });
    expect(drawingBounds([line, dot])).toEqual({ x: -105, y: -55, width: 315, height: 265 });
    expect(drawingBounds([])).toBeUndefined();
    expect(unionBounds(undefined, { x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('hits rendered stroke thickness, round caps and dots with a world-coordinate eraser radius', () => {
    const line = stroke(
      [
        [0, 0],
        [20, 0],
      ],
      4,
    );
    expect(strokeHitTest(line, [-2, 0])).toBe(true);
    expect(strokeHitTest(line, [-2.1, 0])).toBe(false);
    expect(strokeHitTest(line, [10, 4], 2)).toBe(true);
    expect(strokeHitTest(line, [10, 4.1], 2)).toBe(false);
    const dot = stroke([[0, 0]], 10);
    expect(strokeHitTest(dot, [3, 4])).toBe(true);
    expect(strokeHitTest(dot, [4, 4])).toBe(false);
    expect(strokeHitTest(dot, [4, 4], 1)).toBe(true);
  });

  it('erases the same smoothed quadratic curve that is rendered, rather than its invisible control polygon', () => {
    const curve = stroke(
      [
        [0, 0],
        [100, 100],
        [200, 0],
      ],
      2,
    );
    const pointOnCurve: [number, number] = [1000 / 9, 200 / 3];
    expect(strokeHitTest(curve, pointOnCurve)).toBe(true);
    expect(strokeHitTest(curve, [100, 100])).toBe(false);
    expect(strokeHitTest(curve, [500, 500], 10)).toBe(false);
  });

  it('uses identical path geometry for live/export SVG, rounds strokes and renders dots', () => {
    const line = stroke(
      [
        [0, 0],
        [10, 20],
        [30, 10],
      ],
      6,
    );
    const dot = stroke([[50, 40]], 8);
    const markup = renderToStaticMarkup(<DrawingSvg strokes={[line, dot]} />);
    const container = document.createElement('div');
    container.innerHTML = markup;
    const svg = container.querySelector('svg')!;
    expect(svg.style.pointerEvents).toBe('none');
    expect(svg.getAttribute('viewBox')).toBe('-3 -3 57 47');
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(strokePath(line.points));
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('stroke-width')).toBe('6');
    const circle = svg.querySelector('circle')!;
    expect(circle.getAttribute('cx')).toBe('50');
    expect(circle.getAttribute('cy')).toBe('40');
    expect(circle.getAttribute('r')).toBe('4');
    expect(renderToStaticMarkup(<DrawingSvg strokes={[]} />)).toBe('');
  });
});
