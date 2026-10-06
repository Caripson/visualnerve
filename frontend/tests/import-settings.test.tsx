import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportSettings } from '../src/components/ImportSettings';
import { IMPORT_LIMIT_SETTING, LARGE_IMPORT_WARNING } from '../src/imports/limits';
import { useEditor } from '../src/state/editor';
import { workspace } from '../src/storage/workspace';

vi.mock('../src/storage/workspace', () => ({ workspace: { setPreference: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  useEditor.setState({ importFileLimitMb: 50 });
  vi.mocked(workspace.setPreference).mockImplementation(async (key, value) => {
    if (key === IMPORT_LIMIT_SETTING) useEditor.setState({ importFileLimitMb: value as number });
  });
});

it('shows the local default and supported range without warning or confirmation checkbox', () => {
  render(<ImportSettings />);
  expect(screen.getByTestId('import-settings')).toBeInTheDocument();
  expect(screen.getByTestId('import-settings')).toHaveClass('import-settings');
  const input = screen.getByRole('spinbutton', { name: 'Maximum import file size (MB)' });
  expect(input).toHaveValue(50);
  expect(input).toHaveAttribute('min', '50');
  expect(input).toHaveAttribute('max', '1024');
  expect(
    screen.getByText('Only imports up to 50 MB are supported and guaranteed.'),
  ).toBeInTheDocument();
  expect(screen.queryByTestId('import-limit-warning')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('warns while drafting a higher limit and applies it only after Save', async () => {
  render(<ImportSettings />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1024' } });
  expect(screen.getByTestId('import-limit-warning')).toHaveTextContent(LARGE_IMPORT_WARNING);
  expect(useEditor.getState().importFileLimitMb).toBe(50);
  expect(workspace.setPreference).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save import limit' }));
  await waitFor(() =>
    expect(workspace.setPreference).toHaveBeenCalledWith(IMPORT_LIMIT_SETTING, 1024),
  );
  expect(useEditor.getState().importFileLimitMb).toBe(1024);
  expect(await screen.findByRole('status')).toHaveTextContent('saved for this browser');
});

it('keeps the active warning while drafting the default and removes it after saving', async () => {
  useEditor.setState({ importFileLimitMb: 100 });
  render(<ImportSettings />);
  expect(screen.getByTestId('import-limit-warning')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });
  expect(screen.getByTestId('import-limit-warning')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save import limit' }));
  await waitFor(() => expect(screen.queryByTestId('import-limit-warning')).toBeNull());
  expect(useEditor.getState().importFileLimitMb).toBe(50);
});

it('rejects an out of range or fractional draft before persisting it', async () => {
  render(<ImportSettings />);
  for (const value of ['49', '1025', '50.5', '']) {
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save import limit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'whole number from 50 MB to 1024 MB',
    );
  }
  expect(workspace.setPreference).not.toHaveBeenCalled();
  expect(useEditor.getState().importFileLimitMb).toBe(50);
});

it('reports persistence failure without claiming that the draft was saved', async () => {
  vi.mocked(workspace.setPreference).mockRejectedValue(new Error('Browser storage is full.'));
  render(<ImportSettings />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save import limit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Browser storage is full.');
  expect(screen.queryByRole('status')).toBeNull();
  expect(useEditor.getState().importFileLimitMb).toBe(50);
});
