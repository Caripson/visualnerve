import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelEditor } from '../src/simulation/ModelEditor';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { useEditor } from '../src/state/editor';
import { ProcessHierarchyNav } from '../src/simulation/ProcessHierarchyNav';
import { openSimulationProcess, useProcessNavigation } from '../src/simulation/process-navigation';
import { StarterProcessFields } from '../src/simulation/StarterProcessFields';
import { starterDefaults } from '../src/simulation/starter';

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useProcessNavigation.setState({ views: {} });
});
afterEach(() => {
  cleanup();
  useEditor.getState().setGraph(null);
});

function fixture() {
  const model = createBasicModel();
  model.processes = [
    { id: 'delivery', name: 'Delivery' },
    { id: 'assembly', name: 'Assembly', parentId: 'delivery' },
  ];
  model.nodes[1].processId = 'assembly';
  return createSimulationGraph('Process editor', model);
}
describe('hierarchy user interface', () => {
  it('identifies the subprocess for every shared-resource checkbox', () => {
    const draft = starterDefaults();
    const change = vi.fn();
    render(<StarterProcessFields draft={draft} change={change} />);
    draft.steps.forEach((step, index) => {
      const checkbox = screen.getByRole('checkbox', {
        name: `Subprocess ${index + 1} (${step.name}): use shared resource`,
      });
      expect(checkbox).toBeChecked();
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Subprocess 2 (Warehouse preparation): use shared resource',
      }),
    );
    expect(change.mock.lastCall![0].steps[1].usesSharedResource).toBe(false);
    expect(change.mock.lastCall![0].steps[0].usesSharedResource).toBe(true);
  });
  it('saves process names and node membership through one authoritative document', () => {
    const graph = fixture();
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'processes' }));
    fireEvent.change(screen.getByLabelText('Process name assembly'), {
      target: { value: 'Order assembly' },
    });
    fireEvent.change(screen.getByLabelText('Process membership Work'), {
      target: { value: 'delivery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
    expect(
      useEditor
        .getState()
        .graph!.simulation!.processes?.find((process) => process.id === 'assembly')?.name,
    ).toBe('Order assembly');
    expect(
      useEditor.getState().graph!.simulation!.nodes.find((node) => node.id === work.id)?.processId,
    ).toBe('delivery');
  });
  it('keeps a temporarily blank process name editable and reports validation on Apply', () => {
    const graph = fixture();
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'processes' }));
    fireEvent.change(screen.getByLabelText('Process name assembly'), { target: { value: '' } });
    expect(screen.getByLabelText('Process name assembly')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid|name/i);
    fireEvent.change(screen.getByLabelText('Process name assembly'), {
      target: { value: 'Assembly restored' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('adds a subprocess then makes it available in each node membership selector', () => {
    const graph = fixture();
    useEditor.getState().setGraph(graph);
    render(<ModelEditor graph={graph} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'processes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add subprocess to Assembly' }));
    fireEvent.click(screen.getByRole('button', { name: 'nodes' }));
    const member = screen.getByRole('combobox', { name: 'Node process group' });
    expect(within(member).getByRole('option', { name: 'New subprocess' })).toBeInTheDocument();
  });
  it('adds a real editable Work step directly to an empty opened process', () => {
    const graph = fixture();
    useEditor.getState().setGraph(graph);
    openSimulationProcess(graph.diagram.id, 'assembly');
    render(<ProcessHierarchyNav graph={graph} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add step to Assembly' }));
    const current = useEditor.getState().graph!;
    const added = current.simulation!.nodes.at(-1)!;
    expect(added).toMatchObject({
      type: 'work',
      processId: 'assembly',
      work: { capacity: 1, processingSeconds: 60 },
    });
    expect(current.nodes.find((node) => node.id === added.id)).toMatchObject({
      width: 250,
      height: 240,
    });
    expect(current.nodes.every((node) => !node.id.startsWith('simulation-process:'))).toBe(true);
    expect(useEditor.getState().selectedNodes).toEqual([added.id]);
  });
  it('opens every direct subprocess using accessible navigation even when cards are offscreen', () => {
    const graph = fixture();
    useEditor.getState().setGraph(graph);
    render(<ProcessHierarchyNav graph={graph} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Open main process' }), {
      target: { value: 'delivery' },
    });
    expect(screen.getByRole('combobox', { name: 'Open subprocess' })).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox', { name: 'Open subprocess' }), {
      target: { value: 'assembly' },
    });
    expect(useProcessNavigation.getState().views[graph.diagram.id]).toEqual({
      mode: 'hierarchy',
      processId: 'assembly',
    });
  });
  it('shows breadcrumb navigation and switches to all steps without changing the simulation', () => {
    const graph = fixture();
    const before = structuredClone(graph.simulation);
    openSimulationProcess(graph.diagram.id, 'assembly');
    render(<ProcessHierarchyNav graph={graph} />);
    expect(screen.getByRole('button', { name: 'Assembly' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all steps' }));
    expect(useProcessNavigation.getState().views[graph.diagram.id].mode).toBe('all');
    fireEvent.click(screen.getByRole('button', { name: 'Return to process view' }));
    expect(useProcessNavigation.getState().views[graph.diagram.id]).toEqual({
      mode: 'hierarchy',
      processId: 'assembly',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Process overview' }));
    expect(useProcessNavigation.getState().views[graph.diagram.id].processId).toBeUndefined();
    expect(graph.simulation).toEqual(before);
  });
});
