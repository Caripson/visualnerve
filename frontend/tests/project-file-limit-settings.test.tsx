import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectFileLimitSettings } from '../src/components/ProjectFileLimitSettings';
import {
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
  LARGE_PROJECT_FILE_WARNING,
} from '../src/code/project/limits';
import { useEditor } from '../src/state/editor';
import { workspace } from '../src/storage/workspace';

vi.mock('../src/storage/workspace', () => ({ workspace: { setPreference: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  useEditor.setState({ projectSourceFileLimit: 500 });
  vi.mocked(workspace.setPreference).mockImplementation(async (key, value) => {
    if (key === PROJECT_SOURCE_FILE_LIMIT_SETTING)
      useEditor.setState({ projectSourceFileLimit: value as number });
  });
});

it('shows the local default and supported range without warning or confirmation checkbox', () => {
  render(<ProjectFileLimitSettings />);
  expect(screen.getByTestId('project-file-limit-settings')).toBeInTheDocument();
  expect(screen.getByTestId('project-file-limit-settings')).toHaveClass('import-settings');
  const input = screen.getByRole('spinbutton', {
    name: 'Maximum analyzed source files in a ZIP project',
  });
  expect(input).toHaveValue(500);
  expect(input).toHaveAttribute('min', '500');
  expect(input).toHaveAttribute('max', '10000');
  expect(
    screen.getByText(
      'Only ZIP projects with up to 500 analyzed source files are supported and guaranteed.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByTestId('project-file-limit-warning')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('warns while drafting a higher limit and applies it only after Save', async () => {
  render(<ProjectFileLimitSettings />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10000' } });
  expect(screen.getByTestId('project-file-limit-warning')).toHaveTextContent(
    LARGE_PROJECT_FILE_WARNING,
  );
  expect(useEditor.getState().projectSourceFileLimit).toBe(500);
  expect(workspace.setPreference).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save ZIP file limit' }));
  await waitFor(() =>
    expect(workspace.setPreference).toHaveBeenCalledWith(PROJECT_SOURCE_FILE_LIMIT_SETTING, 10000),
  );
  expect(useEditor.getState().projectSourceFileLimit).toBe(10000);
  expect(await screen.findByRole('status')).toHaveTextContent('saved for this browser');
});

it('keeps the active warning while drafting the default and removes it after saving', async () => {
  useEditor.setState({ projectSourceFileLimit: 1000 });
  render(<ProjectFileLimitSettings />);
  expect(screen.getByTestId('project-file-limit-warning')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '500' } });
  expect(screen.getByTestId('project-file-limit-warning')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save ZIP file limit' }));
  await waitFor(() => expect(screen.queryByTestId('project-file-limit-warning')).toBeNull());
  expect(useEditor.getState().projectSourceFileLimit).toBe(500);
});

it('rejects an out of range or fractional draft before persisting it', async () => {
  render(<ProjectFileLimitSettings />);
  for (const value of ['499', '10001', '500.5', '']) {
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ZIP file limit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('whole number from 500 to 10,000');
  }
  expect(workspace.setPreference).not.toHaveBeenCalled();
  expect(useEditor.getState().projectSourceFileLimit).toBe(500);
});

it('reports persistence failure without claiming that the draft was saved', async () => {
  vi.mocked(workspace.setPreference).mockRejectedValue(new Error('Browser storage is full.'));
  render(<ProjectFileLimitSettings />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save ZIP file limit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Browser storage is full.');
  expect(screen.queryByRole('status')).toBeNull();
  expect(useEditor.getState().projectSourceFileLimit).toBe(500);
});
