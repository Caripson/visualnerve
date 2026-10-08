import { afterEach, describe, expect, it, vi } from 'vitest';
import { XYPanZoom } from '@xyflow/system';
import { CanvasFocusAnimation, isCanvasNavigationGesture } from '../src/canvas/focus-animation';
import { persistCanvasFocus } from '../src/canvas/navigation';
import { instantiate } from '../src/templates/templates';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  let viewport = { x: 30, y: -80, zoom: 0.8 };
  const access = {
    getViewport: () => viewport,
    setViewport: vi.fn(async (next: typeof viewport) => {
      viewport = next;
    }),
  };
  return { access, navigation: new CanvasFocusAnimation(access) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('owned automatic focus', () => {
  it('interrupts the actual installed XYFlow/D3 transition at its current camera', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    Object.defineProperties(element, {
      clientWidth: { value: 390 },
      clientHeight: { value: 679 },
    });
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 679));
    const panZoom = XYPanZoom({
      domNode: element,
      viewport: { x: 0, y: 0, zoom: 1 },
      minZoom: 0.05,
      maxZoom: 3,
      translateExtent: [
        [-Infinity, -Infinity],
        [Infinity, Infinity],
      ],
      onDraggingChange: () => {},
    });
    const navigation = new CanvasFocusAnimation(panZoom);
    try {
      const movement = navigation.start(async () => {
        await panZoom.setViewport({ x: -200, y: -300, zoom: 1.8 }, { duration: 200 });
        return true;
      });
      await vi.waitFor(() => expect(panZoom.getViewport().zoom).toBeGreaterThan(1), {
        interval: 5,
      });
      const interrupted = panZoom.getViewport();
      expect(interrupted.zoom).toBeLessThan(1.8);
      navigation.cancel();
      await expect(movement.completion).resolves.toBe(false);
      expect(movement.isCurrent()).toBe(false);
      // Wait through the original transition's lifetime to prove it cannot resume.
      await new Promise((resolve) => setTimeout(resolve, 240));
      expect(panZoom.getViewport()).toEqual(interrupted);
    } finally {
      navigation.cancel();
      panZoom.destroy();
    }
  });

  it('settles cancellation even when the interrupted D3 promise never resolves', async () => {
    const f = fixture();
    const run = f.navigation.start(() => new Promise<boolean>(() => {}));
    f.navigation.cancel();
    await expect(run.completion).resolves.toBe(false);
    expect(f.access.setViewport).toHaveBeenCalledWith(f.access.getViewport(), { duration: 0 });
    expect(run.isCurrent()).toBe(false);
  });

  it('persists a completed current focus and invalidates completion before publication', async () => {
    const f = fixture();
    const graph = instantiate('basic-flowchart', 'Focused diagram');
    const first = f.navigation.start(() => Promise.resolve(true));
    const persist = vi.fn();
    await persistCanvasFocus({
      completion: first.completion,
      diagramId: graph.diagram.id,
      nodeId: graph.nodes[0].id,
      active: first.isCurrent,
      current: () => ({ graph, selectedNodes: [graph.nodes[0].id] }),
      viewport: f.access.getViewport,
      persist,
    });
    expect(persist).toHaveBeenCalledWith(f.access.getViewport());
    const next = f.navigation.start(() => Promise.resolve(true));
    await next.completion;
    f.navigation.cancel();
    persist.mockClear();
    await persistCanvasFocus({
      completion: next.completion,
      diagramId: graph.diagram.id,
      nodeId: graph.nodes[0].id,
      active: next.isCurrent,
      current: () => ({ graph, selectedNodes: [graph.nodes[0].id] }),
      viewport: f.access.getViewport,
      persist,
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not publish a replaced or cancelled focus after a late transition completion', async () => {
    const f = fixture();
    const old = deferred<boolean>();
    const next = deferred<boolean>();
    const first = f.navigation.start(() => old.promise);
    const second = f.navigation.start(() => next.promise);
    await expect(first.completion).resolves.toBe(false);
    old.resolve(true);
    await old.promise;
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    next.resolve(true);
    await expect(second.completion).resolves.toBe(true);
    expect(second.isCurrent()).toBe(true);
  });

  it('never rewrites a manual camera when no automatic focus is active', async () => {
    const f = fixture();
    f.navigation.cancel();
    const completed = f.navigation.start(() => Promise.resolve(true));
    await completed.completion;
    f.navigation.cancel();
    f.navigation.cancel();
    expect(f.access.setViewport).not.toHaveBeenCalled();
  });

  it('releases ownership after failed animation setup or an asynchronous rejection', async () => {
    const f = fixture();
    const error = new Error('Camera unavailable');
    await expect(
      f.navigation.start(() => {
        throw error;
      }).completion,
    ).rejects.toBe(error);
    f.navigation.cancel();
    await expect(f.navigation.start(() => Promise.reject(error)).completion).rejects.toBe(error);
    f.navigation.cancel();
    expect(f.access.setViewport).not.toHaveBeenCalled();
    await expect(f.navigation.start(() => Promise.resolve(true)).completion).resolves.toBe(true);
  });
});

describe('canvas input ownership', () => {
  it.each([
    '.node-title',
    '.simulation-node-details',
    '.code-object-scroll',
    '.react-flow__resize-control',
    '.react-flow__pane',
  ])('takes over automatic focus from %s', (selector) => {
    document.body.innerHTML = `<div class="react-flow__renderer"><div class="${selector.slice(1)}"></div></div>`;
    expect(isCanvasNavigationGesture(document.querySelector(selector))).toBe(true);
  });

  it.each([
    'button',
    'input',
    'textarea',
    'select',
    'a',
    '.react-flow__panel',
    '.react-flow__controls',
    '.react-flow__minimap',
    '.react-flow__node-toolbar',
    '.drawing-surface',
    '[role="dialog"]',
    '[contenteditable="true"]',
  ])('leaves fixed controls and native field %s independent', (selector) => {
    const renderer = document.createElement('div');
    renderer.className = 'react-flow__renderer';
    const target = document.createElement(/^[a-z]+$/.test(selector) ? selector : 'div');
    if (selector.startsWith('.')) target.className = selector.slice(1);
    if (selector.startsWith('[role=')) target.setAttribute('role', 'dialog');
    if (selector.startsWith('[contenteditable=')) target.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    target.append(child);
    renderer.append(target);
    document.body.append(renderer);
    expect(isCanvasNavigationGesture(child)).toBe(false);
  });

  it('does not claim another UI surface', () => {
    const control = document.createElement('div');
    document.body.append(control);
    expect(isCanvasNavigationGesture(control)).toBe(false);
    expect(isCanvasNavigationGesture(null)).toBe(false);
  });
});
