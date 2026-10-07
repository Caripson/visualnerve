import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { PlayerSubtitles, type PlayerSubtitlesProps } from '../src/presentation/PlayerSubtitles';

let width: number;
let resize: () => void;
let disconnect: Mock<() => void>;
let observe: Mock<(element: Element) => void>;
let context: {
  font: string;
  letterSpacing: string;
  measureText: Mock<(value: string) => { width: number }>;
};
let time: { elapsedMs: number; durationMs: number };
let getPlaybackTime: Mock<() => { elapsedMs: number; durationMs: number }>;
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  vi.useFakeTimers();
  width = 240;
  time = { elapsedMs: 0, durationMs: 1000 };
  getPlaybackTime = vi.fn(() => time);
  disconnect = vi.fn<() => void>();
  observe = vi.fn<(element: Element) => void>();
  resize = () => undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: Element) {
        observe(element);
      }
      disconnect() {
        disconnect();
      }
    },
  );
  context = {
    font: '',
    letterSpacing: '0px',
    measureText: vi.fn((value: string) => ({ width: Array.from(value).length * 10 })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('presentation-caption') ? 80 : width;
  });
  stylesheet = document.createElement('style');
  stylesheet.textContent = '.presentation-caption { font: 500 18px serif; padding: 10px 20px; }';
  document.head.append(stylesheet);
});

afterEach(() => {
  cleanup();
  stylesheet.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function properties(overrides: Partial<PlayerSubtitlesProps> = {}): PlayerSubtitlesProps {
  return {
    narration: Array.from({ length: 40 }, (_, index) => `marker${index}`).join(' '),
    stepId: 'first',
    status: 'playing',
    getPlaybackTime,
    bottom: 90,
    ...overrides,
  };
}
function caption() {
  return screen.getByRole('region', { name: 'Walkthrough subtitles' });
}
function pageCount() {
  return Number(caption().getAttribute('data-page-count'));
}
function at(elapsedMs: number) {
  time.elapsedMs = elapsedMs;
  act(() => vi.advanceTimersByTime(100));
}

it('shows a short first cue, measures the actual font and keeps complete narration accessible', () => {
  const narration = 'Deliver the truck safely.';
  render(<PlayerSubtitles {...properties({ narration })} />);
  expect(caption()).toHaveTextContent(narration);
  expect(caption()).toHaveAttribute('aria-description', narration);
  expect(caption()).toHaveAttribute('data-page', '1');
  expect(caption()).toHaveAttribute('data-page-count', '1');
  expect(caption().parentElement).toHaveStyle({ bottom: '90px' });
  expect(context.font).toBe(getComputedStyle(caption()).font);
  expect(context.font).toContain('18px');
  expect(context.font).toContain('serif');
  expect(observe).toHaveBeenCalledWith(caption().parentElement);
  expect(observe).not.toHaveBeenCalledWith(caption());
});

it('shows every word across two-line pages without rendering the whole long description', () => {
  const props = properties();
  render(<PlayerSubtitles {...props} />);
  expect(pageCount()).toBeGreaterThan(2);
  expect(caption()).not.toHaveTextContent('marker39');
  const cues: string[] = [];
  const count = pageCount();
  for (let index = 0; index < count; index++) {
    at(((index + 0.05) / count) * time.durationMs);
    expect(caption()).toHaveAttribute('data-page', String(index + 1));
    expect(caption().textContent!.split('\n').length).toBeLessThanOrEqual(2);
    cues.push(caption().textContent!);
  }
  expect(cues.join(' ').replace(/\s+/g, ' ')).toBe(props.narration);
  expect(caption()).toHaveAttribute('aria-description', props.narration);
});

it('preserves all characters of long identifiers and Unicode across caption pages', () => {
  const narration = `Start ${'Customer0123456789'.repeat(12)}${'🚚'.repeat(16)} Finished`;
  render(<PlayerSubtitles {...properties({ narration })} />);
  const cues: string[] = [];
  const count = pageCount();
  for (let index = 0; index < count; index++) {
    at(((index + 0.05) / count) * time.durationMs);
    cues.push(caption().textContent!);
  }
  expect(cues.join('').replace(/\s/g, '')).toBe(narration.replace(/\s/g, ''));
});

it('follows runtime time, clamps at the last page and uses the first page without a duration', () => {
  render(<PlayerSubtitles {...properties()} />);
  const count = pageCount();
  at(500);
  expect(caption()).toHaveAttribute('data-page', String(Math.floor(count / 2) + 1));
  at(2000);
  expect(caption()).toHaveAttribute('data-page', String(count));
  expect(caption()).toHaveTextContent('marker39');
  time.durationMs = 0;
  at(2000);
  expect(caption()).toHaveAttribute('data-page', '1');
});

it('stops polling on pause and resumes at runtime time rather than elapsed wall-clock time', () => {
  const props = properties();
  const view = render(<PlayerSubtitles {...props} />);
  at(250);
  view.rerender(<PlayerSubtitles {...props} status="paused" />);
  const paused = caption().textContent;
  getPlaybackTime.mockClear();
  time.elapsedMs = 900;
  act(() => vi.advanceTimersByTime(10000));
  expect(caption().textContent).toBe(paused);
  expect(getPlaybackTime).not.toHaveBeenCalled();
  view.rerender(<PlayerSubtitles {...props} status="playing" />);
  expect(caption()).toHaveAttribute('data-page', String(Math.floor(0.9 * pageCount()) + 1));
});

it('reflows at the same runtime position on resize and does not restart when the panel moves', () => {
  const props = properties();
  const view = render(<PlayerSubtitles {...props} />);
  at(600);
  const previousCount = pageCount();
  width = 140;
  act(() => resize());
  expect(pageCount()).toBeGreaterThan(previousCount);
  expect(caption()).toHaveAttribute('data-page', String(Math.floor(0.6 * pageCount()) + 1));
  const cue = caption().textContent;
  view.rerender(<PlayerSubtitles {...props} bottom={210} />);
  expect(caption().textContent).toBe(cue);
  expect(caption().parentElement).toHaveStyle({ bottom: '210px' });
});

it('keeps page layout stable when a changing cue shrink-wraps within the same overlay', () => {
  render(<PlayerSubtitles {...properties()} />);
  const count = pageCount();
  const first = caption().textContent;
  context.measureText.mockClear();
  at(500);
  expect(caption().textContent).not.toBe(first);
  act(() => resize());
  expect(pageCount()).toBe(count);
  expect(context.measureText).not.toHaveBeenCalled();
});

it('resets for a new step and releases its polling and observer on unmount', () => {
  const props = properties();
  const view = render(<PlayerSubtitles {...props} />);
  at(900);
  time.elapsedMs = 0;
  view.rerender(
    <PlayerSubtitles {...props} stepId="second" narration="Inspect the finished truck." />,
  );
  expect(caption()).toHaveAttribute('data-page', '1');
  expect(caption()).toHaveTextContent('Inspect the finished');
  expect(disconnect).toHaveBeenCalledOnce();
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  getPlaybackTime.mockClear();
  context.measureText.mockClear();
  act(() => {
    vi.advanceTimersByTime(1000);
    resize();
  });
  expect(getPlaybackTime).not.toHaveBeenCalled();
  expect(context.measureText).not.toHaveBeenCalled();
});

it('keeps captions usable without canvas or ResizeObserver and hides empty narration', () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  vi.stubGlobal('ResizeObserver', undefined);
  const props = properties();
  const view = render(<PlayerSubtitles {...props} />);
  expect(pageCount()).toBeGreaterThan(1);
  const previousCount = pageCount();
  width = 500;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(pageCount()).toBeLessThan(previousCount);
  view.rerender(<PlayerSubtitles {...props} narration={' \n '} />);
  expect(screen.queryByRole('region', { name: 'Walkthrough subtitles' })).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
