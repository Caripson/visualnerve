import { lazy } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LazyDialogBoundary } from '../src/components/LazyDialogBoundary';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());
function FailedTool(): never {
  throw new Error('Failed to fetch dynamically imported module');
}
it('announces a loading dialog while keeping the editor outside the lazy boundary mounted', () => {
  const Tool = lazy(() => new Promise(() => undefined));
  const close = vi.fn();
  render(
    <>
      <button>Edit diagram</button>
      <LazyDialogBoundary close={close} beforeReload={async () => undefined}>
        <Tool />
      </LazyDialogBoundary>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Edit diagram' })).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Opening tools' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Opening tools');
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(close).toHaveBeenCalledOnce();
});
it('a failed optional chunk leaves the editor usable and waits for saves before reload', async () => {
  let saved!: () => void;
  const beforeReload = vi.fn(() => new Promise<void>((resolve) => (saved = resolve)));
  const reload = vi.fn(),
    close = vi.fn();
  render(
    <>
      <button>Edit diagram</button>
      <LazyDialogBoundary close={close} beforeReload={beforeReload} reload={reload}>
        <FailedTool />
      </LazyDialogBoundary>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Edit diagram' })).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Tool could not open' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Save and reload' }));
  expect(beforeReload).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Saving before reload…' })).toBeDisabled();
  expect(reload).not.toHaveBeenCalled();
  saved();
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});
it('keeps failed saves recoverable and a different dialog can still open', async () => {
  const beforeReload = vi.fn().mockRejectedValue(new Error('Storage full'));
  const reload = vi.fn();
  const { rerender } = render(
    <LazyDialogBoundary key="code" close={vi.fn()} beforeReload={beforeReload} reload={reload}>
      <FailedTool />
    </LazyDialogBoundary>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save and reload' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full');
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save and reload' })).toBeEnabled();
  rerender(
    <LazyDialogBoundary key="sql" close={vi.fn()} beforeReload={beforeReload}>
      <p>SQL editor</p>
    </LazyDialogBoundary>,
  );
  expect(screen.getByText('SQL editor')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Tool could not open' })).toBeNull();
});
