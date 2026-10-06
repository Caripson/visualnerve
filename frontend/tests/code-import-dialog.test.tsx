import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CodeImportDialog } from '../src/components/CodeImportDialog';
import { parseCodeAsync } from '../src/code/client';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import type { CodeImportResult } from '../src/code/types';

vi.mock('../src/code/client', () => ({ parseCodeAsync: vi.fn() }));
const parse = vi.mocked(parseCodeAsync);
const initialSource = 'function charge() { return 42; }';
function result(): CodeImportResult {
  const graph = blankGraph('Payments');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'charge',
      metadata: {
        codeObject: {
          version: 1,
          language: 'typescript',
          path: 'source.ts',
          kind: 'function',
          name: 'charge',
          line: 1,
        },
      },
    }),
    newNode(graph.diagram.id, {
      title: 'gateway',
      metadata: {
        codeObject: {
          version: 1,
          language: 'typescript',
          path: 'gateway.ts',
          kind: 'external',
          name: 'gateway',
          external: true,
        },
      },
    }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      metadata: {
        codeRelation: {
          version: 1,
          kind: 'calls',
          confidence: 'unresolved',
          evidence: { path: 'source.ts', line: 1 },
        },
      },
    }),
  ];
  return {
    version: 1,
    graph,
    languages: ['typescript'],
    mode: 'symbols',
    fileCount: 1,
    symbolCount: 1,
    dependencyCount: 1,
    unresolvedCount: 1,
    warnings: ['Dynamic targets require source review.'],
  };
}
function sourceFile(name: string, content: string) {
  const file = new File([content], name);
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return file;
}
beforeEach(() => {
  parse.mockReset();
});

it('offers all 50 languages, previews confidence and creates only after explicit confirmation', async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const preview = result();
  parse.mockResolvedValue(preview);
  render(<CodeImportDialog create={create} close={close} />);
  expect(within(screen.getByLabelText('Source language')).getAllByRole('option')).toHaveLength(50);
  expect(screen.getByText(/Original source is a temporary draft/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Source code'), { target: { value: initialSource } });
  fireEvent.change(screen.getByLabelText('Code diagram detail'), { target: { value: 'symbols' } });
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  const region = await screen.findByLabelText('Code preview');
  expect(region).toHaveTextContent('1 unresolved connections');
  expect(region).toHaveTextContent('source.ts:1');
  expect(region).toHaveTextContent('Dynamic targets require source review.');
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledWith(preview.graph);
});

it('invalidates an existing preview when focus or language changes', async () => {
  parse.mockResolvedValue(result());
  render(<CodeImportDialog create={vi.fn()} close={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Source code'), { target: { value: initialSource } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  await screen.findByLabelText('Code preview');
  fireEvent.change(screen.getByLabelText('Code focus'), { target: { value: 'charge' } });
  expect(screen.queryByLabelText('Code preview')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Source language'), { target: { value: 'python' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  await screen.findByLabelText('Code preview');
  expect(parse).toHaveBeenLastCalledWith(
    expect.objectContaining({
      mode: 'files',
      focus: 'charge',
      files: [{ path: 'source.py', content: initialSource, language: 'python' }],
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it('aborts an in-flight preview when edited and ignores a late worker result', async () => {
  let complete!: (result: CodeImportResult) => void;
  parse.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<CodeImportDialog create={vi.fn()} close={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Source code'), { target: { value: initialSource } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  const signal = parse.mock.calls[0][1]!.signal!;
  fireEvent.change(screen.getByLabelText('Source code'), {
    target: { value: 'function updated() {}' },
  });
  expect(signal.aborted).toBe(true);
  await act(async () => complete(result()));
  expect(screen.queryByLabelText('Code preview')).toBeNull();
  expect(screen.getByRole('button', { name: 'Preview code' })).toBeEnabled();
});

it('requires a language for an ambiguous file and retains project file paths', async () => {
  const ambiguous = sourceFile('model.m', 'function y = transform(x)\ny = x;\nend');
  const python = sourceFile('main.py', 'def run():\n    return 1');
  Object.defineProperty(python, 'webkitRelativePath', { value: 'project/main.py' });
  parse.mockResolvedValue(result());
  render(<CodeImportDialog initialFiles={[ambiguous, python]} create={vi.fn()} close={vi.fn()} />);
  await screen.findByLabelText('Language for model.m');
  expect(screen.getByRole('button', { name: 'Preview code' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Language for model.m'), { target: { value: 'matlab' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  await screen.findByLabelText('Code preview');
  expect(parse).toHaveBeenCalledWith(
    expect.objectContaining({
      files: [
        { path: 'model.m', content: expect.any(String), language: 'matlab' },
        { path: 'project/main.py', content: expect.any(String), language: 'python' },
      ],
    }),
    expect.any(Object),
  );
});

it('aborts analysis on close and preserves a failed create for retry', async () => {
  parse.mockResolvedValue(result());
  const create = vi.fn().mockRejectedValue(new Error('Local storage is full.'));
  const close = vi.fn();
  render(<CodeImportDialog create={create} close={close} />);
  fireEvent.change(screen.getByLabelText('Source code'), { target: { value: initialSource } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview code' }));
  await screen.findByLabelText('Code preview');
  fireEvent.click(screen.getByRole('button', { name: 'Create diagram' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Local storage is full.');
  expect(screen.getByRole('button', { name: 'Create diagram' })).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
});
