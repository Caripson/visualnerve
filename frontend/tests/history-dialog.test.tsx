import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { blankGraph, newNode } from '../src/model/types';
import { HistoryDialog } from '../src/history/HistoryDialog';
let db: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  db = new WorkspaceDatabase(`history-dialog-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
});
afterEach(async () => {
  await db.delete();
  vi.unstubAllGlobals();
});
async function setup() {
  const graph = blankGraph('Truck');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original' })];
  const original = await repo.importGraph(graph),
    snapshot = await repo.history.create(graph.diagram.id, {
      name: 'Before',
      baseVersion: original.diagram.version,
    });
  const current = await repo.saveGraph(
    { ...original, nodes: [{ ...original.nodes[0], title: 'Current work' }] },
    original.diagram.version,
  );
  return { original, snapshot, current };
}
it('requires comparison and an explicit restore choice, then preserves current work in a checkpoint', async () => {
  const { original, snapshot, current } = await setup(),
    restored = vi.fn(),
    beforeAction = vi.fn();
  render(
    <HistoryDialog
      store={repo.history}
      diagramId={original.diagram.id}
      onClose={vi.fn()}
      onRestored={restored}
      beforeAction={beforeAction}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Snapshot'), { target: { value: snapshot.id } });
  expect(
    screen.queryByRole('button', { name: 'Restore reviewed snapshot' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  await screen.findByText('1 meaningful changes');
  const restore = screen.getByRole('button', { name: 'Restore reviewed snapshot' });
  expect(restore).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText('I reviewed the changes and want to restore this snapshot.'),
  );
  fireEvent.click(restore);
  await waitFor(() => expect(restored).toHaveBeenCalledTimes(1));
  expect(restored.mock.calls[0][0].nodes[0].title).toBe('Original');
  expect(restored.mock.calls[0][0].diagram.version).toBe(current.diagram.version + 1);
  const checkpoint = (await repo.history.list(original.diagram.id)).find(
    (item) => item.kind === 'pre-restore',
  )!;
  expect((await repo.history.read(original.diagram.id, checkpoint.id)).graph.nodes[0].title).toBe(
    'Current work',
  );
  expect(beforeAction).toHaveBeenCalledTimes(2);
});
it('uses the reviewed baseVersion and rejects another tab changing the graph after review', async () => {
  const { original, snapshot, current } = await setup(),
    restored = vi.fn();
  render(
    <HistoryDialog
      store={repo.history}
      diagramId={original.diagram.id}
      onClose={vi.fn()}
      onRestored={restored}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Snapshot'), { target: { value: snapshot.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  await screen.findByText('1 meaningful changes');
  await repo.saveGraph(
    { ...current, nodes: [{ ...current.nodes[0], title: 'Other writer' }] },
    current.diagram.version,
  );
  fireEvent.click(
    screen.getByLabelText('I reviewed the changes and want to restore this snapshot.'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Restore reviewed snapshot' }));
  await screen.findByText(/Another tab changed this diagram/);
  expect(restored).not.toHaveBeenCalled();
  expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Other writer');
  expect(await db.historySnapshots.count()).toBe(1);
});
it('flushes current work before capturing the name and version of a new snapshot', async () => {
  const graph = blankGraph('Truck');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Saved' })];
  const original = await repo.importGraph(graph);
  const beforeAction = vi.fn(async () => {
    await repo.saveGraph(
      { ...original, nodes: [{ ...original.nodes[0], title: 'Pending edit' }] },
      original.diagram.version,
    );
  });
  render(
    <HistoryDialog
      store={repo.history}
      diagramId={original.diagram.id}
      onClose={vi.fn()}
      onRestored={vi.fn()}
      beforeAction={beforeAction}
    />,
  );
  fireEvent.change(screen.getByLabelText('Snapshot name'), {
    target: { value: 'Review checkpoint' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
  await screen.findByText('Named snapshot saved locally.');
  const snapshot = (await repo.history.list(original.diagram.id))[0];
  expect(snapshot.name).toBe('Review checkpoint');
  expect(snapshot.graphVersion).toBe(original.diagram.version + 1);
  expect((await repo.history.read(original.diagram.id, snapshot.id)).graph.nodes[0].title).toBe(
    'Pending edit',
  );
  expect(screen.getByText(/Ordinary autosaves do not create snapshots/)).toBeVisible();
});
