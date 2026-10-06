import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEditor } from '../src/state/editor';
import { SpatialLoadFailure } from '../src/spatial/SpatialLoadFailure';

const mocks = vi.hoisted(() => ({ settled: vi.fn() }));
vi.mock('../src/storage/workspace', () => ({ workspace: { settled: mocks.settled } }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('finishes active edits and waits for local saves before reloading to retry the 3D module', async () => {
  let resolve!: () => void;
  mocks.settled.mockImplementation(() => new Promise<void>((done) => (resolve = done)));
  const finish = vi.spyOn(useEditor.getState(), 'finishEditing');
  const reload = vi.fn();
  render(<SpatialLoadFailure onReturnTo2D={vi.fn()} onReload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reload to retry 3D' }));
  await waitFor(() => expect(mocks.settled).toHaveBeenCalledOnce());
  expect(finish).toHaveBeenCalledOnce();
  expect(finish.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.settled.mock.invocationCallOrder[0],
  );
  expect(screen.getByRole('button', { name: 'Saving before reload…' })).toBeDisabled();
  expect(reload).not.toHaveBeenCalled();
  resolve();
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

it('keeps changes open when saving fails and permits a later retry or return to 2D', async () => {
  mocks.settled
    .mockRejectedValueOnce(new Error('Local storage is full.'))
    .mockResolvedValue(undefined);
  const reload = vi.fn();
  const returnTo2D = vi.fn();
  render(<SpatialLoadFailure onReturnTo2D={returnTo2D} onReload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reload to retry 3D' }));
  await expect(screen.findByRole('alert')).resolves.toHaveTextContent('Local storage is full.');
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Return to 2D' }));
  expect(returnTo2D).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Reload to retry 3D' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});
