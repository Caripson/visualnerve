import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createEmptySimulationModel } from '../src/simulation/starter';
import {
  ProcessStartPanel,
  ProcessWizard,
  simulationSetupEvent,
} from '../src/simulation/ProcessWizard';
import { useEditor } from '../src/state/editor';

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});
afterEach(() => {
  cleanup();
  useEditor.getState().setGraph(null);
});
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

describe('Process Simulator guided setup UI', () => {
  it('creates a complete process from ordinary fields in one undoable edit', () => {
    const empty = createEmptySimulationModel();
    empty.defaults.seed = 12345;
    const graph = createSimulationGraph('New process', empty);
    useEditor.getState().setGraph(graph);
    const close = vi.fn(),
      created = vi.fn();
    render(<ProcessWizard graph={graph} close={close} created={created} />);
    fireEvent.change(screen.getByLabelText('Work item name'), { target: { value: 'Package' } });
    fireEvent.click(screen.getByRole('button', { name: /A fixed batch/ }));
    fireEvent.change(screen.getByLabelText('Batch size (items)'), { target: { value: '12' } });
    next();
    fireEvent.change(screen.getByLabelText('Work step name'), {
      target: { value: 'Hand over package' },
    });
    fireEvent.change(screen.getByLabelText('Processing time (minutes/item)'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Parallel capacity (slots)'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByLabelText(/Use a shared resource/));
    fireEvent.change(screen.getByLabelText('Shared resource name'), {
      target: { value: 'Store staff' },
    });
    next();
    fireEvent.change(screen.getByLabelText('Revenue per completed item (SEK)'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText('Shared resource cost per unit/hour (SEK)'), {
      target: { value: '150' },
    });
    next();
    expect(screen.getByLabelText('Process preview')).toHaveTextContent('Package arrivals');
    expect(screen.getByLabelText('Process preview')).toHaveTextContent('4 min/item · 2 slots');
    expect(screen.getByText(/seed 12345/)).toBeVisible();
    expect(useEditor.getState().graph!.simulation!.nodes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Create process' }));
    expect(close).toHaveBeenCalledOnce();
    expect(created).toHaveBeenCalledWith({ durationSeconds: 28800, untilComplete: true });
    const saved = useEditor.getState().graph!;
    expect(saved.simulation!.defaults.seed).toBe(12345);
    expect(saved.simulation!.nodes).toHaveLength(4);
    expect(saved.simulation!.nodes.find((node) => node.type === 'work')).toMatchObject({
      name: 'Hand over package',
      work: { processingSeconds: 240, capacity: 2 },
    });
    expect(saved.simulation!.particleTypes[0]).toMatchObject({ name: 'Package', revenue: 20 });
    expect(saved.simulation!.resources[0]).toMatchObject({
      name: 'Store staff',
      capacity: 1,
      costPerHour: 150,
    });
    expect(useEditor.getState().history).toHaveLength(1);
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().graph!.simulation).toEqual(graph.simulation);
    act(() => useEditor.getState().redo());
    expect(useEditor.getState().graph!.simulation).toEqual(saved.simulation);
  });
  it('keeps the document untouched when setup is dismissed and preserves fields when going back', () => {
    const graph = createSimulationGraph('Empty', createEmptySimulationModel());
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ProcessWizard graph={graph} close={close} />);
    fireEvent.change(screen.getByLabelText('Work item name'), { target: { value: 'Customer' } });
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Work item name')).toHaveValue('Customer');
    fireEvent.click(screen.getByRole('button', { name: 'Set up later' }));
    expect(close).toHaveBeenCalledOnce();
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().history).toHaveLength(0);
  });
  it('refuses to overwrite a concurrent semantic API edit', () => {
    const graph = createSimulationGraph('Empty', createEmptySimulationModel());
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ProcessWizard graph={graph} close={close} />);
    next();
    next();
    next();
    act(() =>
      useEditor
        .getState()
        .command('External change', (current) =>
          setSimulationModel(current, { ...current.simulation!, currency: 'EUR' }),
        ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create process' }));
    expect(screen.getByRole('alert')).toHaveTextContent('model changed');
    expect(close).not.toHaveBeenCalled();
    expect(useEditor.getState().graph!.simulation!.currency).toBe('EUR');
  });
  it('shows a real overload warning before creation instead of promising impossible throughput', () => {
    const graph = createSimulationGraph('Overload', createEmptySimulationModel());
    useEditor.getState().setGraph(graph);
    render(<ProcessWizard graph={graph} close={() => {}} />);
    fireEvent.change(screen.getByLabelText('Arrival rate (items/hour)'), {
      target: { value: '100' },
    });
    next();
    next();
    next();
    expect(screen.getByRole('status')).toHaveTextContent('Demand exceeds processing capacity');
    expect(screen.getByText(/Up to 30 items\/hour/)).toBeVisible();
  });
  it('offers a semantic-free reopen action from the empty canvas', () => {
    const open = vi.fn();
    window.addEventListener(simulationSetupEvent, open);
    render(<ProcessStartPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Start guided setup' }));
    expect(open).toHaveBeenCalledOnce();
    window.removeEventListener(simulationSetupEvent, open);
  });
});
