import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiagramFileImportDialog } from '../src/components/DiagramFileImportDialog';
import { blankGraph, newNode } from '../src/model/types';
import type { DiagramImportResult } from '../src/imports/diagram/types';
import { parseDiagramFile } from '../src/imports/diagram/client';
vi.mock('../src/imports/diagram/client', () => ({ parseDiagramFile: vi.fn() }));
const file = new File(['xml'], 'process.drawio');
function preview(): DiagramImportResult {
  return {
    format: 'drawio',
    warnings: [],
    pages: ['Overview', 'Details'].map((name, index) => {
      const graph = blankGraph(name, 'freeform');
      graph.nodes = [
        newNode(graph.diagram.id, { title: index ? '<script>alert(1)</script>' : 'Start' }),
      ];
      return {
        id: String(index),
        name,
        graph,
        warnings: index ? ['Custom stencil simplified.'] : [],
      };
    }),
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('previews pages without saving, selects one page and creates only its native graph with the chosen name', async () => {
  const result = preview();
  vi.mocked(parseDiagramFile).mockResolvedValue(result);
  const close = vi.fn(),
    create = vi.fn().mockResolvedValue(undefined);
  render(<DiagramFileImportDialog file={file} close={close} create={create} />);
  await screen.findByLabelText('Diagram page');
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Diagram page'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Imported diagram name'), {
    target: { value: 'Reviewed flow' },
  });
  expect(screen.getByText('Custom stencil simplified.')).toBeVisible();
  expect(
    screen.getByRole('img', { name: 'Diagram page preview' }).querySelector('script'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0][0]).toMatchObject({
    diagram: { name: 'Reviewed flow' },
    nodes: result.pages[1].graph.nodes,
  });
  expect(result.pages[1].graph.diagram.name).toBe('Details');
  expect(close).toHaveBeenCalledOnce();
});
it('cancels a pending file read and ignores late preview results', async () => {
  let resolve!: (value: DiagramImportResult) => void;
  let signal!: AbortSignal;
  vi.mocked(parseDiagramFile).mockImplementation((_file, options) => {
    signal = options!.signal!;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const create = vi.fn(),
    close = vi.fn();
  const view = render(<DiagramFileImportDialog file={file} close={close} create={create} />);
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  await act(async () => resolve(preview()));
  expect(screen.queryByLabelText('Diagram page')).toBeNull();
  expect(create).not.toHaveBeenCalled();
  view.unmount();
});
it('keeps a failed creation reviewable and permits retry after the save error', async () => {
  vi.mocked(parseDiagramFile).mockResolvedValue(preview());
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error('Storage is full.'))
    .mockResolvedValue(undefined);
  render(<DiagramFileImportDialog file={file} close={vi.fn()} create={create} />);
  await screen.findByLabelText('Diagram page');
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Storage is full.');
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
});
it('shows malformed-file errors with no page or save action available', async () => {
  vi.mocked(parseDiagramFile).mockRejectedValue(new Error('Invalid ZIP package.'));
  render(
    <DiagramFileImportDialog file={new File([], 'broken.vsdx')} close={vi.fn()} create={vi.fn()} />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid ZIP package.');
  expect(screen.queryByLabelText('Diagram page')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
});
