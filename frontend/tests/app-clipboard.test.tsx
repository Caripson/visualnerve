import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { blankGraph, newNode } from '../src/model/types';
import { copySelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';

vi.mock('../src/storage/workspace', () => ({
  workspace: { start: async () => {}, stop: () => {} },
}));
vi.mock('../src/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../src/components/Toolbar', () => ({ Toolbar: () => null, FilterBar: () => null }));
vi.mock('../src/components/Properties', () => ({ Properties: () => null }));
vi.mock('../src/canvas/Canvas', () => ({
  Canvas: () =>
    createElement(
      'div',
      { 'data-node-scroll': true, tabIndex: 0, 'aria-label': 'Node content' },
      createElement('span', null, 'Readable declarations'),
    ),
}));
vi.mock('../src/presentation/Player', () => ({ PresentationFeature: () => null }));
vi.mock('../src/components/UnderstandingDialogs', () => ({ UnderstandingDialogs: () => null }));
vi.mock('../src/components/DataPrivacy', () => ({
  LocalBadge: () => null,
  PrivacyIntro: () => null,
  RestoreBackup: () => null,
}));
vi.mock('../src/components/Dialogs', () => ({
  NewDiagram: () =>
    createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': 'New diagram' }),
  ExportDialog: () => null,
  OwnersDialog: () => null,
  SearchDialog: () => null,
  SettingsDialog: () => null,
  DeleteDialog: () => null,
  ConnectDialog: () => null,
}));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ privacyAcknowledged: true, clipboard: null, status: 'saved', message: '' });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

async function pendingPaste() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const readText = vi.fn(() => pending);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText },
  });
  const graph = blankGraph('Original target');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Clipboard source' })];
  const clip = copySelection(graph, [graph.nodes[0].id]);
  useEditor.getState().setGraph(graph);
  useEditor.setState({ clipboard: clip });
  await act(async () => {
    render(createElement(App));
  });
  fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
  expect(readText).toHaveBeenCalledOnce();
  const complete = async (outcome: 'resolve' | 'reject') => {
    await act(async () => {
      if (outcome === 'resolve') resolve(JSON.stringify(clip));
      else reject(new Error('Clipboard permission denied'));
      await pending.catch(() => {});
    });
  };
  return { graph, complete };
}

it.each(['resolve', 'reject'] as const)(
  'cancels a pending paste after changing diagrams when clipboard read %ss',
  async (outcome) => {
    const { graph, complete } = await pendingPaste();
    const originalHistory = useEditor.getState().history;
    const second = blankGraph('Different diagram');
    act(() => useEditor.getState().setGraph(second));
    const before = useEditor.getState();
    await complete(outcome);
    expect(graph.nodes.map((node) => node.title)).toEqual(['Clipboard source']);
    expect(originalHistory).toEqual([]);
    expect(useEditor.getState().graph).toBe(second);
    expect(second.nodes).toEqual([]);
    expect(useEditor.getState().history).toBe(before.history);
    expect(useEditor.getState().editRevision).toBe(before.editRevision);
  },
);

it.each(['resolve', 'reject'] as const)(
  'pastes normally in the original diagram when clipboard read %ss',
  async (outcome) => {
    const { graph, complete } = await pendingPaste();
    await complete(outcome);
    const current = useEditor.getState();
    expect(current.graph!.diagram.id).toBe(graph.diagram.id);
    expect(current.graph!.nodes.map((node) => node.title)).toEqual([
      'Clipboard source',
      'Clipboard source',
    ]);
    expect(current.graph!.nodes[1].id).not.toBe(graph.nodes[0].id);
    expect(current.history).toHaveLength(1);
    expect(current.history[0].label).toBe('Paste nodes');
  },
);

it.each(['resolve', 'reject'] as const)(
  'cancels a pending paste after storage consent is withdrawn when clipboard read %ss',
  async (outcome) => {
    const { graph, complete } = await pendingPaste();
    act(() => useEditor.setState({ privacyAcknowledged: false }));
    const before = useEditor.getState();
    await complete(outcome);
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().history).toBe(before.history);
    expect(useEditor.getState().editRevision).toBe(before.editRevision);
  },
);

it.each(['resolve', 'reject'] as const)(
  'cancels a pending paste after a modal opens when clipboard read %ss',
  async (outcome) => {
    const { graph, complete } = await pendingPaste();
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'New diagram' })).toBeVisible();
    const before = useEditor.getState();
    await complete(outcome);
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().history).toBe(before.history);
    expect(useEditor.getState().editRevision).toBe(before.editRevision);
  },
);

it('leaves native reading shortcuts alone without copying, deleting or editing diagram objects', async () => {
  const graph = blankGraph('Read-only content', 'mindmap');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original title' })];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([graph.nodes[0].id]);
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Saved title' });
  const clip = copySelection(graph, [graph.nodes[0].id]);
  useEditor.setState({ clipboard: clip });
  const readText = vi.fn(async () => JSON.stringify(clip));
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText, writeText },
  });
  await act(async () => {
    render(createElement(App));
  });
  const region = screen.getByLabelText('Node content');
  region.focus();
  const before = useEditor.getState();
  for (const shortcut of [
    { key: 'c', ctrlKey: true },
    { key: 'v', ctrlKey: true },
    { key: 'd', ctrlKey: true },
    { key: 'g', ctrlKey: true },
    { key: 'z', ctrlKey: true },
    { key: 'y', metaKey: true },
    { key: 'Delete' },
    { key: 'Backspace' },
    { key: 'Tab' },
    { key: 'Enter' },
    { key: 'F2' },
  ]) {
    const event = new KeyboardEvent('keydown', {
      ...shortcut,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(region.firstElementChild!, event);
    expect(event.defaultPrevented).toBe(false);
  }
  const after = useEditor.getState();
  expect(after.graph).toBe(before.graph);
  expect(after.history).toBe(before.history);
  expect(after.editRevision).toBe(before.editRevision);
  expect(after.clipboard).toBe(clip);
  expect(after.editingNode).toBeNull();
  expect(readText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'cancels a pending paste after focus moves into node content when clipboard read %ss',
  async (outcome) => {
    const { graph, complete } = await pendingPaste();
    screen.getByLabelText('Node content').focus();
    const before = useEditor.getState();
    await complete(outcome);
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().history).toBe(before.history);
    expect(useEditor.getState().editRevision).toBe(before.editRevision);
  },
);
