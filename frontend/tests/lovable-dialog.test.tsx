import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LovableDialog } from '../src/components/LovableDialog';
import { buildLovablePrompt, lovableLink } from '../src/export/lovable';
import { download } from '../src/export/semantic';
import { blankGraph, base, newEdge, newNode, type Graph, type Owner } from '../src/model/types';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { useEditor } from '../src/state/editor';

vi.mock('../src/export/semantic', async (original) => ({
  ...(await original<typeof import('../src/export/semantic')>()),
  download: vi.fn(),
}));

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ owners: [] });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const graph = blankGraph('Orders / café');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Order', description: 'Create a customer order.' }),
    newNode(graph.diagram.id, { title: 'Review', notes: 'Show the terms before approving.' }),
    newNode(graph.diagram.id, { title: 'Report' }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'Ready to review' }),
  ];
  useEditor.getState().setGraph(graph);
  return graph;
}

const promptText = () =>
  (screen.getByLabelText('Lovable build prompt') as HTMLTextAreaElement).value;
const count = (label: string) =>
  within(screen.getByLabelText('Build brief contents')).getByText(label).nextElementSibling;

it('previews the exact selected brief and link with boundary counts and merged owner responsibilities', () => {
  const graph = fixture();
  const imported: Owner = {
    ...base(),
    name: 'Imported reviewer',
    kind: 'person',
    color: '#23664d',
    metadata: {},
  };
  const local: Owner = { ...imported, ...base(), name: 'Local coordinator' };
  graph.owners = [imported];
  graph.nodes[0].ownerIds = [imported.id, local.id];
  useEditor.setState({ owners: [local] });
  useEditor.getState().select([graph.nodes[0].id]);
  render(<LovableDialog close={vi.fn()} />);
  expect(screen.getByLabelText('Lovable build prompt')).toHaveAttribute('readonly');
  expect(count('Objects')).toHaveTextContent('3');
  expect(promptText()).toContain('Imported reviewer');
  expect(promptText()).toContain('Local coordinator');
  fireEvent.change(screen.getByLabelText('App instructions'), {
    target: { value: 'Build for café staff.\nUse Swedish labels & accessible forms.' },
  });
  fireEvent.change(screen.getByLabelText('Lovable scope'), { target: { value: 'selected' } });
  const expected = buildLovablePrompt(
    { ...graph, owners: [imported, local] },
    'Build for café staff.\nUse Swedish labels & accessible forms.',
    { scope: 'selected', selectedIds: [graph.nodes[0].id] },
  );
  expect(promptText()).toBe(expected.text);
  expect(count('Objects')).toHaveTextContent('1');
  expect(count('Relationships')).toHaveTextContent('0');
  expect(count('Boundary connections')).toHaveTextContent('1');
  const link = screen.getByRole('link', { name: 'Open in Lovable' });
  expect(link).toHaveAttribute('href', lovableLink(expected.text).url);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(useEditor.getState().graph?.diagram.settings.lovable).toEqual({
    version: 1,
    instructions: 'Build for café staff.\nUse Swedish labels & accessible forms.',
    scope: 'selected',
  });
  act(() => useEditor.getState().select([]));
  expect(screen.getByLabelText('Lovable scope')).toHaveValue('diagram');
  expect(count('Objects')).toHaveTextContent('3');
});

it('defaults CSV diagrams to current groups without including raw rows or arbitrary metadata', () => {
  const dataset = parseCsv(
    'Region,Person\nNorth,PRIVATE-RAW-PERSON\nSouth,OTHER-RAW-PERSON',
    'data.csv',
  );
  const analysis = defaultAnalysis(dataset);
  const graph = csvGraph(dataset, analysis);
  const south = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'South')!;
  south.metadata = { ...south.metadata, csv: { ...getCsvNode(south)!, visible: false } };
  graph.nodes.push(
    newNode(graph.diagram.id, {
      title: 'Manual feature',
      description: 'Create a dashboard with regional totals.',
      metadata: { privateValue: 'PRIVATE-METADATA' },
    }),
  );
  graph.diagram.settings.drawing = {
    version: 1,
    visible: false,
    strokes: [{ id: 'stroke', color: '#e85d3f', width: 3, points: [[0, 0]] }],
  };
  useEditor.getState().setGraph(graph);
  render(<LovableDialog close={vi.fn()} />);
  expect(screen.getByLabelText('Lovable scope')).toHaveValue('csv-view');
  expect(count('Objects')).toHaveTextContent(String(graph.nodes.length - 1));
  expect(promptText()).toContain('Manual feature');
  expect(promptText()).toContain('Create a dashboard with regional totals.');
  expect(promptText()).not.toContain('PRIVATE-RAW-PERSON');
  expect(promptText()).not.toContain('PRIVATE-METADATA');
  expect(
    screen.getByText(
      'Drawing marks are visual notes. Describe anything important in your instructions.',
    ),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText('Lovable scope'), { target: { value: 'diagram' } });
  expect(count('Objects')).toHaveTextContent(String(graph.nodes.length));
});

it('copies and downloads the complete prompt even when prompt or encoded URL limits block direct opening', async () => {
  const graph = fixture();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  graph.nodes[0].description = 'Full requirements '.repeat(3500);
  render(<LovableDialog close={vi.fn()} />);
  const complete = promptText();
  expect(complete.length).toBeGreaterThan(50_000);
  expect(screen.getByRole('button', { name: 'Open in Lovable' })).toBeDisabled();
  expect(screen.getByText(/Lovable links support at most 50,000 prompt characters/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open Lovable and paste the prompt' })).toHaveAttribute(
    'href',
    'https://lovable.dev/',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy build prompt' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Build prompt copied.'));
  expect(writeText).toHaveBeenCalledWith(complete);
  fireEvent.click(screen.getByRole('button', { name: 'Download build brief' }));
  expect(download).toHaveBeenCalledWith('Orders-café-lovable-brief.md', complete, 'text/markdown');
  act(() =>
    useEditor.getState().setGraph({
      ...graph,
      nodes: [{ ...graph.nodes[0], description: '😀'.repeat(5000) }, ...graph.nodes.slice(1)],
    }),
  );
  expect(promptText().length).toBeLessThan(50_000);
  expect(
    screen.getByText(/encoded link exceeds the local 60,000-character URL limit/),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open in Lovable' })).toBeDisabled();
});

it('focuses and selects the full read-only prompt when clipboard permission is denied', async () => {
  fixture();
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
  });
  render(<LovableDialog close={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy build prompt' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Clipboard access is unavailable.'),
  );
  const preview = screen.getByLabelText('Lovable build prompt') as HTMLTextAreaElement;
  expect(preview).toHaveFocus();
  expect(preview.selectionStart).toBe(0);
  expect(preview.selectionEnd).toBe(preview.value.length);
  expect(screen.getByRole('button', { name: 'Download build brief' })).toBeEnabled();
});

it('preserves pasted instructions longer than the link limit in the draft, preview, copy and download', async () => {
  const graph = fixture();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<LovableDialog close={vi.fn()} />);
  const input = screen.getByLabelText('App instructions') as HTMLTextAreaElement;
  const instructions = 'Keep every requirement: café orders, roles & access.\n'.repeat(1100);
  expect(instructions.length).toBeGreaterThan(50_000);
  expect(input.maxLength).toBe(-1);
  fireEvent.change(input, { target: { value: instructions } });
  expect(input.value).toBe(instructions);
  expect(useEditor.getState().graph?.diagram.settings.lovable).toEqual({
    version: 1,
    instructions,
    scope: 'diagram',
  });
  const complete = buildLovablePrompt(graph, instructions, { scope: 'diagram' }).text;
  expect(promptText()).toBe(complete);
  expect(screen.getByRole('button', { name: 'Open in Lovable' })).toBeDisabled();
  expect(screen.getByText(/Lovable links support at most 50,000 prompt characters/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Copy build prompt' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Build prompt copied.'));
  expect(writeText).toHaveBeenCalledWith(complete);
  fireEvent.click(screen.getByRole('button', { name: 'Download build brief' }));
  expect(download).toHaveBeenCalledWith('Orders-café-lovable-brief.md', complete, 'text/markdown');
});

it('normalizes malformed saved settings only on edit, coalesces typing and keeps scope separately undoable', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const graph = fixture();
  const malformed = { version: 1, instructions: { invalid: true }, scope: 'unknown' };
  graph.diagram.settings.lovable = malformed;
  useEditor.getState().select([graph.nodes[0].id]);
  const { unmount } = render(<LovableDialog close={vi.fn()} />);
  expect(screen.getByLabelText('App instructions')).toHaveValue('');
  expect(screen.getByLabelText('Lovable scope')).toHaveValue('diagram');
  expect(useEditor.getState().graph?.diagram.settings.lovable).toBe(malformed);
  fireEvent.change(screen.getByLabelText('App instructions'), { target: { value: 'Build' } });
  fireEvent.change(screen.getByLabelText('App instructions'), {
    target: { value: 'Build a useful app.' },
  });
  expect(useEditor.getState().history).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Lovable scope'), { target: { value: 'selected' } });
  expect(useEditor.getState().history).toHaveLength(2);
  expect(useEditor.getState().graph?.diagram.settings.lovable).toEqual({
    version: 1,
    instructions: 'Build a useful app.',
    scope: 'selected',
  });
  const stored = useEditor.getState().graph!;
  expect(JSON.stringify(stored.diagram.settings.lovable)).not.toContain('Application objects');
  expect(stored.nodes).toBe(graph.nodes);
  expect(stored.edges).toBe(graph.edges);
  unmount();
  render(<LovableDialog close={vi.fn()} />);
  expect(screen.getByLabelText('App instructions')).toHaveValue('Build a useful app.');
  expect(screen.getByLabelText('Lovable scope')).toHaveValue('selected');
  act(() => useEditor.getState().undo());
  expect(screen.getByLabelText('App instructions')).toHaveValue('Build a useful app.');
  expect(screen.getByLabelText('Lovable scope')).toHaveValue('diagram');
  act(() => useEditor.getState().undo());
  expect(useEditor.getState().graph?.diagram.settings.lovable).toEqual(malformed);
  expect(screen.getByLabelText('App instructions')).toHaveValue('');
});

it.each([null, [], 'legacy draft', { version: 2, instructions: 'Old version', scope: 'selected' }])(
  'tolerates unsupported stored draft %j without modifying the diagram on opening',
  (lovable) => {
    const graph: Graph = fixture();
    graph.diagram.settings.lovable = lovable;
    render(<LovableDialog close={vi.fn()} />);
    expect(screen.getByLabelText('App instructions')).toHaveValue('');
    expect(screen.getByLabelText('Lovable scope')).toHaveValue('diagram');
    expect(useEditor.getState().history).toHaveLength(0);
    expect(useEditor.getState().graph).toBe(graph);
  },
);
