import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { PresentationFeature } from '../src/presentation/PresentationFeature';
import { usePresentationLifecycle } from '../src/presentation/usePresentationLifecycle';

const fixture = vi.hoisted(() => ({
  close: vi.fn(),
  changed: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
  snapshot: { open: false, diagramId: '' },
  listeners: new Set<() => void>(),
  imports: 0,
  release: undefined as undefined | (() => void),
}));
vi.mock('../src/storage/workspace', () => ({ workspace: {} }));
vi.mock('../src/presentation/service', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    presentation: { close: fixture.close, changed: fixture.changed, pause: fixture.pause },
    usePresentation: () =>
      useSyncExternalStore(
        (listener) => {
          fixture.listeners.add(listener);
          return () => fixture.listeners.delete(listener);
        },
        () => fixture.snapshot,
      ),
  };
});
vi.mock('../src/presentation/video-service', () => ({ videoExport: { cancel: fixture.cancel } }));
vi.mock('../src/presentation/Player', async () => {
  fixture.imports++;
  await new Promise<void>((resolve) => (fixture.release = resolve));
  const { useState } = await import('react');
  const { usePresentation } = await import('../src/presentation/service');
  return {
    PresentationPlayerView: () => {
      const player = usePresentation();
      const [page, setPage] = useState(0);
      return player.open ? (
        <button onClick={() => setPage((value) => value + 1)}>Player page {page}</button>
      ) : null;
    },
  };
});

function publish(open: boolean) {
  fixture.snapshot = { open, diagramId: useEditor.getState().graph!.diagram.id };
  for (const listener of fixture.listeners) listener();
}
beforeEach(() => {
  vi.clearAllMocks();
  const graph = blankGraph('Walkthrough');
  graph.nodes = [newNode(graph.diagram.id, { title: 'First', description: 'Narration' })];
  useEditor.setState({ graph, privacyAcknowledged: true });
  fixture.snapshot = { open: false, diagramId: graph.diagram.id };
});
afterEach(() => {
  cleanup();
  useEditor.setState({ graph: null });
  vi.restoreAllMocks();
});

describe('always-mounted presentation safety', () => {
  it('tracks semantic graph changes before optional player UI is ever requested', () => {
    renderHook(() => usePresentationLifecycle());
    const original = useEditor.getState().graph!;
    act(() =>
      useEditor.setState({
        selectedNodes: [original.nodes[0].id],
        focusNode: original.nodes[0].id,
      }),
    );
    expect(fixture.changed).not.toHaveBeenCalled();
    act(() => useEditor.setState({ graph: structuredClone(original) }));
    expect(fixture.changed).not.toHaveBeenCalled();
    const edited = structuredClone(original);
    edited.nodes[0].description = 'Changed narration';
    act(() => useEditor.setState({ graph: edited }));
    expect(fixture.changed).toHaveBeenCalledOnce();
    const connected = structuredClone(edited);
    connected.nodes.push(newNode(connected.diagram.id, { title: 'Next' }));
    connected.edges.push(
      newEdge(connected.diagram.id, connected.nodes[0].id, connected.nodes[1].id),
    );
    act(() => useEditor.setState({ graph: connected }));
    expect(fixture.changed).toHaveBeenCalledTimes(2);
    expect(fixture.imports).toBe(0);
  });

  it('closes on privacy revocation and retains interruption/hidden-tab safety before UI loading', () => {
    const mounted = renderHook(() => usePresentationLifecycle());
    act(() => window.dispatchEvent(new Event('visualnerve:presentation-interrupted')));
    expect(fixture.pause).toHaveBeenCalledWith('Camera taken over. Press Play to continue.', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fixture.pause).toHaveBeenCalledWith('Playback paused while this tab is hidden.');
    act(() => useEditor.setState({ privacyAcknowledged: false }));
    expect(fixture.close).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(fixture.close).toHaveBeenCalledTimes(2);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    const calls = fixture.pause.mock.calls.length;
    window.dispatchEvent(new Event('visualnerve:presentation-interrupted'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixture.pause).toHaveBeenCalledTimes(calls);
  });

  it('loads player UI only when requested, hides a cancelled loading dialog, and retains loaded paging state', async () => {
    const mounted = render(<PresentationFeature />);
    expect(fixture.imports).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => publish(true));
    await waitFor(() => expect(fixture.imports).toBe(1));
    expect(screen.getByRole('dialog', { name: 'Opening tools' })).toBeInTheDocument();
    act(() => publish(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => fixture.release!());
    expect(screen.queryByRole('button', { name: /Player page/ })).toBeNull();
    act(() => publish(true));
    const page = await screen.findByRole('button', { name: 'Player page 0' });
    fireEvent.click(page);
    expect(screen.getByRole('button', { name: 'Player page 1' })).toBeInTheDocument();
    act(() => publish(false));
    expect(screen.queryByRole('button', { name: /Player page/ })).toBeNull();
    act(() => publish(true));
    expect(screen.getByRole('button', { name: 'Player page 1' })).toBeInTheDocument();
    expect(fixture.imports).toBe(1);
    mounted.unmount();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });
});
