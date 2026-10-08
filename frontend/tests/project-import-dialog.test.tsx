import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CodeImportDialog } from '../src/components/CodeImportDialog';
import { readProjectArchive } from '../src/code/project/client';
import { parseCodeAsync } from '../src/code/client';
import { parseCode } from '../src/code/analyzer';
import { getCodeAnalysis } from '../src/code/schema';
import { projectIgnoredReasons, type ProjectArchiveResult } from '../src/code/project/types';

vi.mock('../src/code/project/client', () => ({ readProjectArchive: vi.fn() }));
vi.mock('../src/code/client', () => ({ parseCodeAsync: vi.fn() }));
const read = vi.mocked(readProjectArchive);
const parse = vi.mocked(parseCodeAsync);
const scanned: ProjectArchiveResult = {
  name: 'Example project',
  expandedBytes: 1024,
  ignored: {
    total: 1,
    reasons: Object.fromEntries(
      projectIgnoredReasons.map((key) => [key, key === 'dependency' ? 1 : 0]),
    ) as ProjectArchiveResult['ignored']['reasons'],
  },
  files: [
    { path: 'README.md', language: 'markdown', content: '[Usage](docs/usage.md)' },
    { path: 'docs/usage.md', language: 'markdown', content: '# Usage' },
  ],
};
beforeEach(() => {
  read.mockReset();
  parse.mockReset();
});
it('reviews archive exclusions, changes detail and creates only the source-free preview after confirmation', async () => {
  read.mockResolvedValue(scanned);
  parse.mockImplementation(async (input) => parseCode(input));
  const create = vi.fn().mockResolvedValue(undefined);
  render(
    <CodeImportDialog
      initialFiles={[new File(['zip'], 'example.zip')]}
      create={create}
      close={vi.fn()}
    />,
  );
  expect(await screen.findByLabelText('Project scan summary')).toHaveTextContent('1 dependency');
  expect(screen.getByLabelText('Project scan summary')).toHaveTextContent('1.00 KB expanded');
  expect(screen.getByLabelText('Code diagram detail')).toHaveValue('files');
  fireEvent.change(screen.getByLabelText('Code diagram detail'), { target: { value: 'folders' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  expect(await screen.findByLabelText('Code preview')).toHaveTextContent('Folders');
  expect(parse).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'folders', files: scanned.files }),
    expect.any(Object),
  );
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  const graph = create.mock.calls[0][0];
  expect(getCodeAnalysis(graph)?.project).toMatchObject({ name: scanned.name, ignoredEntries: 1 });
  expect(JSON.stringify(graph)).not.toContain('[Usage](docs/usage.md)');
});
it('shows real scan percentage and cancels before a stale archive result can become a preview', async () => {
  let finish!: (value: ProjectArchiveResult) => void;
  read.mockImplementation((_file, options) => {
    options?.onProgress?.({ stage: 'scan', completed: 3, total: 10 });
    return new Promise((done) => {
      finish = done;
    });
  });
  render(
    <CodeImportDialog
      initialFiles={[new File(['zip'], 'example.zip')]}
      create={vi.fn()}
      close={vi.fn()}
    />,
  );
  expect(await screen.findByRole('progressbar', { name: 'Project scan progress' })).toHaveAttribute(
    'value',
    '30',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preparation' }));
  expect(read.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => finish(scanned));
  expect(screen.queryByLabelText('Project scan summary')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
});
it('reports a bad ZIP without allowing diagram creation', async () => {
  read.mockRejectedValue(new Error('Project ZIP checksum does not match.'));
  render(
    <CodeImportDialog
      initialFiles={[new File(['zip'], 'broken.zip')]}
      create={vi.fn()}
      close={vi.fn()}
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('checksum');
  expect(screen.getByRole('button', { name: 'Preview code' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
});
