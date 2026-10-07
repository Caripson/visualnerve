import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelEditor } from '../src/simulation/ModelEditor';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel, createKioskModel } from '../src/simulation/examples';
import { resolveScenario } from '../src/simulation/schema';
import { useEditor } from '../src/state/editor';

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});
afterEach(() => {
  cleanup();
  useEditor.getState().setGraph(null);
});

describe('normal simulation settings UI', () => {
  it('edits processing, capacity and cost through structured fields while preserving a concurrent layout edit', () => {
    const graph = createSimulationGraph('Basic', createBasicModel());
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    fireEvent.change(screen.getByLabelText('Simulation node'), { target: { value: work.id } });
    fireEvent.change(screen.getByLabelText('Work capacity'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Processing time (minutes)'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText('Work cost / hour'), { target: { value: '500' } });
    act(() => {
      useEditor.getState().updateNode(work.id, { x: 987 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
    expect(
      useEditor.getState().graph!.simulation!.nodes.find((node) => node.id === work.id),
    ).toMatchObject({ work: { capacity: 8, processingSeconds: 720, costPerHour: 500 } });
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === work.id)?.x).toBe(987);
  });
  it('blocks Apply for invalid JSON in a structured field and permits it after correction', () => {
    const graph = createSimulationGraph('Basic', createBasicModel());
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    fireEvent.change(screen.getByLabelText('Opening schedule (seconds)'), {
      target: { value: '[' },
    });
    expect(screen.getByRole('button', { name: 'Apply assumptions' })).toBeDisabled();
    expect(
      screen
        .getAllByRole('alert')
        .map((alert) => alert.textContent)
        .join(' '),
    ).toContain('valid JSON');
    expect(useEditor.getState().graph!.simulation).toBe(graph.simulation);
    fireEvent.change(screen.getByLabelText('Opening schedule (seconds)'), {
      target: { value: '[]' },
    });
    expect(screen.getByRole('button', { name: 'Apply assumptions' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('rejects overwriting an actual semantic change made while settings are open', () => {
    const graph = createSimulationGraph('Basic', createBasicModel());
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    const model = structuredClone(graph.simulation!);
    model.particleTypes[0].revenue = 999;
    act(() => {
      useEditor
        .getState()
        .command('External assumptions', (current) => setSimulationModel(current, model));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(screen.getByRole('alert')).toHaveTextContent('model changed');
    expect(close).not.toHaveBeenCalled();
    expect(useEditor.getState().graph!.simulation!.particleTypes[0].revenue).toBe(999);
  });
  it('stores a scenario budget override without changing the baseline currency or budget', () => {
    const model = createBasicModel();
    model.economics = { maximumBudget: 1000 };
    model.scenarios = [{ id: 'a', name: 'Scenario A', overrides: {} }];
    const graph = createSimulationGraph('Basic', model);
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} scenarioId="a" close={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'economics' }));
    expect(screen.getByLabelText('Simulation currency')).toBeDisabled();
    expect(screen.getByLabelText('Simulation assumptions')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Maximum budget'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
    const saved = useEditor.getState().graph!.simulation!;
    expect(saved.economics?.maximumBudget).toBe(1000);
    expect(resolveScenario(saved, 'a').economics?.maximumBudget).toBe(2000);
  });
  it('can create a Source through the UI in an empty semantic model', () => {
    const model = createBasicModel();
    model.nodes = [];
    model.edges = [];
    model.particleTypes = [];
    const graph = createSimulationGraph('Empty', model);
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    fireEvent.change(screen.getByLabelText('Add simulation node'), { target: { value: 'source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
    expect(useEditor.getState().graph!.simulation!.nodes[0]).toMatchObject({ type: 'source' });
    expect(useEditor.getState().graph!.simulation!.particleTypes).toHaveLength(1);
  });
  it('deletes a used resource through settings and restores all assumptions with Undo', () => {
    const graph = createSimulationGraph('Kiosk', createKioskModel());
    const resource = graph.simulation!.resources.find((entry) => entry.id === 'store-staff')!;
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ModelEditor graph={graph} close={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'resources' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: resource.name })).getByRole('button', {
        name: 'Delete resource',
      }),
    );
    expect(useEditor.getState().graph!.simulation).toBe(graph.simulation);
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(close).toHaveBeenCalledOnce();
    expect(
      useEditor.getState().graph!.simulation!.resources.some((entry) => entry.id === resource.id),
    ).toBe(false);
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().graph!.simulation).toEqual(graph.simulation);
    expect(useEditor.getState().graph!.nodes).toEqual(graph.nodes);
    expect(useEditor.getState().graph!.edges).toEqual(graph.edges);
  });
});
