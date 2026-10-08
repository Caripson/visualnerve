import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QuickAddPlacement } from '../src/nodes/quick-add-placement';
import { NodeQuickAdd } from '../src/nodes/NodeQuickAdd';
import { createBasicModel } from '../src/simulation/examples';
import { createSimulationGraph } from '../src/simulation/document';
import { useEditor } from '../src/state/editor';

vi.mock('@xyflow/react', async (actual) => ({
  ...(await actual<typeof import('@xyflow/react')>()),
  NodeToolbar: ({ children }: { children: ReactNode }) => (
    <div className="react-flow">
      <div className="react-flow__node-toolbar" data-testid="quick-toolbar">
        {children}
      </div>
    </div>
  ),
}));

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});
afterEach(() => vi.restoreAllMocks());

describe('screen-sized connected-node toolbar placement', () => {
  const placement = new QuickAddPlacement();
  const canvas = { left: 0, top: 165, width: 320, height: 475 };

  it.each([0.05, 0.18, 0.75, 1, 2])(
    'keeps the full trigger inside either edge at %sx canvas zoom',
    (zoom) => {
      for (const x of [-80, 300]) {
        const trigger = { left: x * zoom, top: 550, width: 146, height: 44 };
        const offset = placement.offset(trigger, canvas);
        expect(trigger.left + offset.x).toBeGreaterThanOrEqual(canvas.left + 8);
        expect(trigger.left + offset.x + trigger.width).toBeLessThanOrEqual(
          canvas.left + canvas.width - 8,
        );
        expect(trigger.top + offset.y).toBeGreaterThanOrEqual(canvas.top + 8);
        expect(trigger.top + offset.y + trigger.height).toBeLessThanOrEqual(
          canvas.top + canvas.height - 8,
        );
      }
    },
  );

  it('leaves ordinary anchors unchanged and keeps above/below controls inside a short landscape canvas', () => {
    expect(placement.offset({ left: 20, top: 220, width: 146, height: 44 }, canvas)).toEqual({
      x: 0,
      y: 0,
    });
    const landscape = { left: 235, top: 180, width: 540, height: 130 };
    for (const top of [130, 290]) {
      const trigger = { left: 640, top, width: 146, height: 44 };
      const offset = placement.offset(trigger, landscape);
      expect(trigger.top + offset.y).toBeGreaterThanOrEqual(landscape.top + 8);
      expect(trigger.top + offset.y + trigger.height).toBeLessThanOrEqual(
        landscape.top + landscape.height - 8,
      );
      expect(trigger.left + offset.x + trigger.width).toBeLessThanOrEqual(
        landscape.left + landscape.width - 8,
      );
    }
  });

  it('moves the actual failing Add next anchor above tools while avoiding other floating panels', () => {
    const trigger = { left: 650, top: 904, width: 115, height: 36 };
    const viewport = { left: 230, top: 620, width: 940, height: 330 };
    const panels = [
      { left: 615, top: 885, width: 163, height: 40 },
      { left: 439, top: 636, width: 516, height: 42 },
      { left: 992, top: 833, width: 166, height: 117 },
      { left: 963, top: 703, width: 179, height: 37 },
    ];
    expect(placement.offset(trigger, viewport, panels)).toEqual({ x: 0, y: -63 });
  });

  it('chooses the nearest gap between controls, minimap and edit toolbar within a narrow canvas', () => {
    const trigger = { left: 145, top: 115, width: 146, height: 44 };
    const viewport = { left: 0, top: 0, width: 320, height: 180 };
    const panels = [
      { left: 0, top: 0, width: 320, height: 60 },
      { left: 100, top: 120, width: 180, height: 50 },
      { left: 0, top: 65, width: 80, height: 100 },
      { left: 290, top: 65, width: 30, height: 100 },
    ];
    expect(placement.offset(trigger, viewport, panels)).toEqual({ x: -9, y: -47 });
  });

  it('marks an impossible-clearance position for the control-only overlay while retaining canvas bounds', () => {
    const viewport = { left: 20, top: 100, width: 320, height: 80 };
    expect(
      placement.offset({ left: 150, top: 130, width: 146, height: 44 }, viewport, [viewport]),
    ).toEqual({ x: 0, y: -2, occluded: true });
  });

  it('repositions a real trigger after camera movement without oscillating, and retains accessible insert/Undo', async () => {
    const graph = createSimulationGraph('Quick controls', createBasicModel());
    const outcome = graph.simulation!.nodes.find((node) => node.type === 'outcome')!;
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([outcome.id]);
    let anchor = { left: 300, top: 610 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('react-flow'))
        return new DOMRect(canvas.left, canvas.top, canvas.width, canvas.height);
      if (this.classList.contains('node-quick-add-anchor'))
        return new DOMRect(anchor.left, anchor.top, 146, 44);
      if (this.classList.contains('node-quick-add')) {
        const [x, y] = this.style.translate.split(' ').map((value) => parseFloat(value) || 0);
        return new DOMRect(anchor.left + (x || 0), anchor.top + (y || 0), 146, 44);
      }
      return new DOMRect(0, 0, 100, 44);
    });
    const { unmount } = render(<NodeQuickAdd id={outcome.id} />);
    const trigger = screen.getByRole('button', { name: 'Add previous' });
    const control = trigger.closest<HTMLElement>('.node-quick-add')!;
    expect(control.style.translate).toBe('-134px -22px');
    expect(control.style.maxWidth).toBe('304px');
    const toolbar = screen.getByTestId('quick-toolbar');
    await act(async () => {
      toolbar.style.transform = 'translate(300px, 610px)';
      await Promise.resolve();
    });
    expect(control.style.translate).toBe('-134px -22px');
    anchor = { left: -40, top: 150 };
    await act(async () => {
      toolbar.style.transform = 'translate(-40px, 150px)';
      await Promise.resolve();
    });
    expect(control.style.translate).toBe('48px 23px');
    fireEvent.click(trigger);
    const insert = screen.getByRole('button', { name: 'Insert work step' });
    expect(insert).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Insert work step' }));
    expect(useEditor.getState().graph!.simulation!.nodes).toHaveLength(4);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    unmount();
    expect(control.style.translate).toBe('');
  });
  it('reacts to measured panel addition, movement and removal without moving the model or looping', async () => {
    const graph = createSimulationGraph('Floating controls', createBasicModel());
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([work.id]);
    const viewport = { left: 230, top: 620, width: 940, height: 330 };
    let anchor = { left: 650, top: 904 };
    let toolsTop = 885;
    let measurements = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('react-flow'))
        return new DOMRect(viewport.left, viewport.top, viewport.width, viewport.height);
      if (this.classList.contains('canvas-tools-panel')) return new DOMRect(615, toolsTop, 163, 40);
      if (this.classList.contains('node-quick-add-anchor'))
        return new DOMRect(anchor.left, anchor.top, 115, 36);
      if (this.classList.contains('node-quick-add')) {
        measurements++;
        const [x, y] = this.style.translate.split(' ').map((value) => parseFloat(value) || 0);
        return new DOMRect(anchor.left + (x || 0), anchor.top + (y || 0), 115, 36);
      }
      return new DOMRect(0, 0, 100, 44);
    });
    const { unmount } = render(<NodeQuickAdd id={work.id} />);
    const control = screen
      .getByRole('button', { name: 'Add next' })
      .closest<HTMLElement>('.node-quick-add')!;
    expect(control.style.translate).toBe('0px 0px');
    const canvasElement = control.closest('.react-flow')!;
    const panel = document.createElement('div');
    panel.className = 'react-flow__panel canvas-tools-panel';
    await act(async () => {
      canvasElement.append(panel);
      await Promise.resolve();
    });
    expect(control.style.translate).toBe('0px -63px');
    toolsTop = 820;
    await act(async () => {
      panel.style.top = '820px';
      await Promise.resolve();
    });
    expect(control.style.translate).toBe('0px 0px');
    anchor = { left: 650, top: 830 };
    await act(async () => {
      screen.getByTestId('quick-toolbar').style.transform = 'translate(650px, 830px)';
      await Promise.resolve();
    });
    expect(control.style.translate).toBe('0px 38px');
    await act(async () => {
      panel.remove();
      await Promise.resolve();
    });
    expect(control.style.translate).toBe('0px 0px');
    expect(useEditor.getState().graph).toEqual(graph);
    expect(measurements).toBeLessThan(20);
    unmount();
    expect(control.style.translate).toBe('');
  });

  it('portals only the control when every canvas position is obstructed, restores inline placement, and cleans up', async () => {
    const graph = createSimulationGraph('Narrow control fallback', createBasicModel());
    const outcome = graph.simulation!.nodes.find((node) => node.type === 'outcome')!;
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([outcome.id]);
    const viewport = { left: 20, top: 100, width: 320, height: 80 };
    let anchor = { left: 150, top: 130 };
    let measurements = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('react-flow') || this.classList.contains('canvas-tools-panel'))
        return new DOMRect(viewport.left, viewport.top, viewport.width, viewport.height);
      if (this.classList.contains('node-quick-add-anchor'))
        return new DOMRect(anchor.left, anchor.top, 146, 44);
      if (this.classList.contains('node-quick-add')) {
        measurements++;
        if (this.classList.contains('node-quick-add-floating'))
          return new DOMRect(parseFloat(this.style.left), parseFloat(this.style.top), 146, 44);
        const [x, y] = this.style.translate.split(' ').map((value) => parseFloat(value) || 0);
        return new DOMRect(anchor.left + (x || 0), anchor.top + (y || 0), 146, 44);
      }
      return new DOMRect(0, 0, 100, 44);
    });
    const { unmount } = render(<NodeQuickAdd id={outcome.id} />);
    const toolbar = screen.getByTestId('quick-toolbar');
    const canvasElement = toolbar.closest('.react-flow')!;
    const panel = document.createElement('div');
    panel.className = 'react-flow__panel canvas-tools-panel';
    await act(async () => {
      canvasElement.append(panel);
      await Promise.resolve();
    });
    let trigger = screen.getByRole('button', { name: 'Add previous' });
    let floating = trigger.closest<HTMLElement>('.node-quick-add-floating')!;
    expect(floating.parentElement).toBe(document.body);
    expect(floating.style.left).toBe('150px');
    expect(floating.style.top).toBe('128px');
    expect(toolbar.style.zIndex).toBe('');
    expect(toolbar.querySelector('.node-quick-add-anchor')).toHaveStyle({
      width: '146px',
      height: '44px',
    });
    anchor = { left: -50, top: 90 };
    await act(async () => {
      toolbar.style.transform = 'translate(-50px, 90px)';
      await Promise.resolve();
    });
    expect(floating.style.left).toBe('28px');
    expect(floating.style.top).toBe('108px');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Insert work step' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    await act(async () => {
      panel.remove();
      await Promise.resolve();
    });
    expect(document.querySelector('.node-quick-add-floating')).toBeNull();
    trigger = screen.getByRole('button', { name: 'Add previous' });
    expect(toolbar.contains(trigger)).toBe(true);
    expect(trigger.closest<HTMLElement>('.node-quick-add')!.style.translate).toBe('78px 18px');
    expect(useEditor.getState().graph).toEqual(graph);
    expect(measurements).toBeLessThan(30);
    // Restore obstruction, then unmount: no detached control or popup may remain.
    await act(async () => {
      canvasElement.append(panel);
      await Promise.resolve();
    });
    floating = screen
      .getByRole('button', { name: 'Add previous' })
      .closest<HTMLElement>('.node-quick-add-floating')!;
    fireEvent.click(screen.getByRole('button', { name: 'Add previous' }));
    unmount();
    expect(floating.isConnected).toBe(false);
    expect(screen.queryByRole('button', { name: 'Add previous' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Add previous menu' })).toBeNull();
  });
});
