import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelEditor } from '../src/simulation/ModelEditor';
import { ProcessWizard } from '../src/simulation/ProcessWizard';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { createEmptySimulationModel } from '../src/simulation/starter';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { validateGraph } from '../src/model/validation';
import { useEditor } from '../src/state/editor';
import { instantiate } from '../src/templates/templates';
import { resolveScenario } from '../src/simulation/schema';
import { QuantityField } from '../src/simulation/infrastructure/QuantityField';
import { quantityUnits, quantityValue } from '../src/simulation/infrastructure/quantity';
import { EditorValidationProvider } from '../src/simulation/editor/JsonField';
import {
  projectSimulationRenderModel,
  projectSimulationCapacityNodes,
  logicalNodeId,
} from '../src/simulation/render-model';
import { connectedNodeChoices, addConnectedNode } from '../src/nodes/connected-node';
import { infrastructureReading } from '../src/simulation/infrastructure/metrics';
import { compareInfrastructure } from '../src/simulation/infrastructure/comparison';
import { InfrastructureComparisonPanel } from '../src/simulation/infrastructure/InfrastructureComparisonPanel';
import { InfrastructureMetricsPanel } from '../src/simulation/infrastructure/InfrastructureMetricsPanel';
import { SimulationEngine } from '../src/simulation/engine';

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
});
afterEach(() => {
  cleanup();
  useEditor.getState().setGraph(null);
});
const commit = (label: string, value: string) => {
  const input = screen.getByLabelText(label, { exact: true });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
describe('typed infrastructure UI', () => {
  it('converts explicit units and never writes invalid intermediate numbers', () => {
    const change = vi.fn(),
      validity = vi.fn();
    const view = render(
      <EditorValidationProvider change={validity}>
        <QuantityField
          label="RAM"
          value={1024}
          units={quantityUnits.memory}
          maximum={4096}
          change={change}
        />
      </EditorValidationProvider>,
    );
    fireEvent.change(screen.getByLabelText('RAM unit'), { target: { value: '1' } });
    expect(screen.getByLabelText('RAM', { exact: true })).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('RAM', { exact: true }), { target: { value: '2' } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('RAM', { exact: true }), { key: 'Enter' });
    expect(change).toHaveBeenLastCalledWith(2048);
    fireEvent.change(screen.getByLabelText('RAM', { exact: true }), { target: { value: '-' } });
    fireEvent.blur(screen.getByLabelText('RAM', { exact: true }));
    expect(change).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeVisible();
    view.unmount();
    expect(validity).toHaveBeenLastCalledWith(expect.any(String), false, 'RAM');
    expect(quantityValue('32', quantityUnits.payload[0])).toBe(33554432);
    expect(quantityValue('1500', quantityUnits.power[1])).toBe(1.5);
    expect(quantityValue('15', quantityUnits.arrival[0])).toBe(54000);
  });
  it('commits decimal commas from a mobile keyboard and rejects mixed separators', () => {
    const change = vi.fn();
    render(
      <QuantityField label="Load power" value={1} units={quantityUnits.power} change={change} />,
    );
    fireEvent.change(screen.getByLabelText('Load power', { exact: true }), {
      target: { value: '1,5' },
    });
    expect(change).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByLabelText('Load power', { exact: true }));
    expect(change).toHaveBeenLastCalledWith(1.5);
    fireEvent.change(screen.getByLabelText('Load power', { exact: true }), {
      target: { value: '1,234.5' },
    });
    fireEvent.blur(screen.getByLabelText('Load power', { exact: true }));
    expect(change).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('without thousands separators');
  });
  it('edits CPU/RAM requirements atomically and preserves them through Undo', () => {
    const graph = instantiate('api-compute-capacity', 'API');
    useEditor.getState().setGraph(graph);
    const execute = graph.simulation!.nodes.find((node) => node.name === 'Execute API request')!;
    render(<ModelEditor graph={graph} close={() => {}} />);
    const description = screen.getByLabelText('Model assumptions text');
    expect(description).toHaveValue(graph.simulation!.description);
    fireEvent.change(description, {
      target: {
        value: 'Synthetic API allocation, not a hardware benchmark. Eight requests per second.',
      },
    });
    fireEvent.change(screen.getByLabelText('Simulation node'), { target: { value: execute.id } });
    commit('Computational work', '0.4');
    commit('Cores per active request', '2');
    commit('RAM amount 1', '128');
    fireEvent.change(screen.getByLabelText('Computational work'), { target: { value: 'bad' } });
    expect(screen.getByRole('button', { name: 'Apply assumptions' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Computational work'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(
      useEditor.getState().graph!.simulation!.nodes.find((node) => node.id === execute.id),
    ).toMatchObject({
      work: {
        infrastructure: {
          cpu: { coreSeconds: 0.4, cores: 2 },
          memory: [{ amountMiB: 128, scope: 'case' }],
        },
      },
    });
    expect(useEditor.getState().graph!.simulation!.description).toBe(
      'Synthetic API allocation, not a hardware benchmark. Eight requests per second.',
    );
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().graph!.simulation).toEqual(graph.simulation);
  });
  it('edits a scenario typed pool without changing the baseline or dimension', () => {
    const graph = instantiate('api-compute-capacity', 'API');
    useEditor.getState().setGraph(graph);
    const scenario = graph.simulation!.scenarios.find((s) => s.name === 'Double CPU')!;
    render(<ModelEditor graph={graph} scenarioId={scenario.id} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'resources' }));
    commit('API CPU pool capacity', '6');
    expect(screen.queryAllByRole('button', { name: 'Delete resource' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    const saved = useEditor.getState().graph!.simulation!;
    expect(saved.resources[0].capacity).toBe(2);
    expect(resolveScenario(saved, scenario.id).resources[0]).toMatchObject({
      capacity: 6,
      unit: 'cores',
      infrastructure: { kind: 'cpu', unit: 'cores' },
    });
  });
  it('edits link payload and propagation using authoritative conversions', () => {
    const graph = instantiate('network-multi-site-capacity', 'Sites');
    useEditor.getState().setGraph(graph);
    const edge = graph.simulation!.edges.find((edge) => edge.infrastructure)!;
    render(<ModelEditor graph={graph} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'connections' }));
    commit(`Payload ${edge.id}`, '64');
    fireEvent.change(screen.getByLabelText(`Propagation delay ${edge.id} unit`), {
      target: { value: '1' },
    });
    commit(`Propagation delay ${edge.id}`, '150');
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    expect(
      useEditor.getState().graph!.simulation!.edges.find((entry) => entry.id === edge.id),
    ).toMatchObject({ travelSeconds: 0.15, infrastructure: { transfer: { bytes: 64 * 1048576 } } });
  });
  it('edits generation, battery, efficiencies and energy load without fixed service time', () => {
    const graph = instantiate('energy-power-capacity', 'Power');
    useEditor.getState().setGraph(graph);
    const load = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    render(<ModelEditor graph={graph} close={() => {}} />);
    fireEvent.change(screen.getByLabelText('Simulation node'), { target: { value: load.id } });
    commit('Energy per item', '2');
    commit('Requested load power', '4');
    expect(screen.queryByLabelText('Processing time (minutes)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'resources' }));
    const pool = graph.simulation!.resources[0];
    commit(`${pool.name} Initial stored energy`, '4');
    commit(`${pool.name} Charge efficiency`, '95');
    commit('Generation 1 power', '3');
    expect(screen.getByRole('button', { name: 'Delete resource' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
    const saved = useEditor.getState().graph!.simulation!;
    expect(saved.resources[0].infrastructure).toMatchObject({
      generation: [{ powerKW: 3 }, { powerKW: 8 }, { powerKW: 1 }],
      battery: { initialKWh: 4 },
    });
    expect(
      saved.resources[0].infrastructure?.kind === 'energy' &&
        saved.resources[0].infrastructure.battery?.chargeEfficiency,
    ).toBeCloseTo(0.95);
    expect(saved.nodes.find((node) => node.id === load.id)).toMatchObject({
      work: { processingSeconds: 0, infrastructure: { energy: { energyKWh: 2, powerKW: 4 } } },
    });
  });
  it('creates and persists a complete infrastructure model through guided ordinary fields', async () => {
    const graph = createSimulationGraph('My API', createEmptySimulationModel());
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(<ProcessWizard graph={graph} close={close} />);
    fireEvent.change(screen.getByLabelText('Capacity model domain'), {
      target: { value: 'api-compute-capacity' },
    });
    commit('Incoming API requests arrivals', '8');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    commit('API CPU pool capacity', '4');
    commit('Database connection pool capacity', '2');
    commit('Database connection pool cost per unit/hour', '0,1');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(useEditor.getState().graph!.simulation!.nodes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Create capacity model' }));
    expect(close).toHaveBeenCalledOnce();
    const saved = useEditor.getState().graph!;
    expect(saved.diagram.id).toBe(graph.diagram.id);
    validateGraph(saved);
    const database = new WorkspaceDatabase(`guided-capacity-${crypto.randomUUID()}`);
    try {
      await database.open();
      const repository = new Repository(database);
      await repository.saveGraph(graph, 0);
      const persisted = await repository.saveGraph(saved, graph.diagram.version);
      const reloaded = await repository.getGraph(graph.diagram.id);
      expect(reloaded.simulation).toEqual(persisted.simulation);
      expect(reloaded.nodes.every((node) => node.diagramId === graph.diagram.id)).toBe(true);
      expect(reloaded.edges.every((edge) => edge.diagramId === graph.diagram.id)).toBe(true);
    } finally {
      await database.delete();
    }
    expect(saved.simulation).toMatchObject({
      schemaVersion: 2,
      infrastructure: { schemaVersion: 1 },
    });
    expect(saved.simulation!.resources[0].capacity).toBe(4);
    expect(saved.simulation!.resources.find((resource) => resource.id === 'db')).toMatchObject({
      capacity: 2,
      unit: 'connections',
      costPerHour: 0.1,
    });
    expect(saved.simulation!.nodes.find((node) => node.type === 'source')).toMatchObject({
      source: { ratePerHour: 28800 },
    });
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().graph!.simulation!.nodes).toHaveLength(0);
  });
  it('keeps typed pools aggregate and directs quick-add to requirements instead of legacy units', () => {
    const graph = instantiate('api-compute-capacity', 'API');
    const projection = projectSimulationRenderModel(graph, {
      model: structuredClone(graph.simulation!),
      options: {},
    });
    const capacity = projectSimulationCapacityNodes(graph, projection);
    for (const resource of graph.simulation!.resources.filter(
      (resource) => resource.infrastructure,
    )) {
      const display = graph.simulation!.nodes.find(
        (node) => node.type === 'resource' && node.resourceId === resource.id,
      )!;
      expect(capacity.nodes.filter((node) => logicalNodeId(node) === display.id)).toHaveLength(1);
      expect(connectedNodeChoices(graph, display.id)).toEqual([
        expect.objectContaining({ type: 'infrastructure:requirements' }),
      ]);
      expect(() => addConnectedNode(graph, display.id)).toThrow(/Assumptions/);
    }
    expect(projection.resourceEdges.map((edge) => edge.label)).toEqual(
      expect.arrayContaining(['1 cores · 0.2 core-s', '96 MiB · case']),
    );
  });
});

it('reads exact measured pressure and saved-run domain deltas', () => {
  const graph = instantiate('api-compute-capacity', 'Pressure');
  const model = graph.simulation!;
  const source = model.nodes.find((node) => node.type === 'source')!;
  if (source.type !== 'source') throw Error('source');
  source.source = { ...source.source, ratePerHour: 0, burst: 6, maxCount: 6 };
  const cpu = model.resources.find((pool) => pool.infrastructure?.kind === 'cpu')!;
  const execute = model.nodes.find(
    (node) => node.type === 'work' && node.work.infrastructure?.cpu,
  )!;
  if (execute.type !== 'work') throw Error('work');
  execute.work.infrastructure!.cpu!.coreSeconds = 10;
  const engine = new SimulationEngine(model);
  engine.advance(1);
  const state = engine.state();
  expect(infrastructureReading(undefined, cpu.id)).toBeUndefined();
  expect(infrastructureReading(state, cpu.id)).toMatchObject({
    kind: 'CPU',
    usage: 2,
    unit: 'cores',
    pressure: 'congested',
  });
  const ram = model.resources.find((pool) => pool.infrastructure?.kind === 'memory')!;
  expect(infrastructureReading(state, ram.id)).toMatchObject({
    kind: 'RAM',
    usage: 480,
    unit: 'MiB',
    pressure: 'congested',
  });
  const scenario = structuredClone(model);
  scenario.resources.find((pool) => pool.id === cpu.id)!.capacity = 4;
  const alternate = new SimulationEngine(scenario);
  alternate.advance(1);
  const comparison = compareInfrastructure(state.infrastructure, alternate.state().infrastructure)!;
  expect(comparison.delta.cpu[cpu.id].reservedCores).toBe(2);
  render(
    <>
      <InfrastructureMetricsPanel state={state} currency="SEK" />
      <InfrastructureComparisonPanel comparison={comparison} currency="SEK" />
    </>,
  );
  expect(screen.getByRole('region', { name: 'Infrastructure capacity metrics' })).toHaveTextContent(
    'Constrained',
  );
  const row = screen.getByRole('row', { name: 'Reserved cores 2 cores 4 cores 2 cores' });
  expect(row).toBeInTheDocument();
});

it('introduces a typed pool and requirements into a legacy model through the normal editor', () => {
  const graph = createSimulationGraph('General capacity', createBasicModel());
  useEditor.getState().setGraph(graph);
  render(<ModelEditor graph={graph} close={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'resources' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add shared resource' }));
  fireEvent.change(screen.getByLabelText('Resource dimension New resource'), {
    target: { value: 'cpu' },
  });
  commit('New resource capacity', '2');
  fireEvent.click(screen.getByRole('button', { name: 'nodes' }));
  fireEvent.change(screen.getByLabelText('Simulation node'), {
    target: { value: graph.simulation!.nodes.find((node) => node.type === 'work')!.id },
  });
  fireEvent.change(screen.getByLabelText('Activity dimension'), { target: { value: 'cpu' } });
  commit('Computational work', '5');
  commit('Fixed processing overhead', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Apply assumptions' }));
  const saved = useEditor.getState().graph!.simulation!;
  expect(saved).toMatchObject({ schemaVersion: 2, infrastructure: { schemaVersion: 1 } });
  expect(saved.resources[0]).toMatchObject({
    capacity: 2,
    unit: 'cores',
    infrastructure: { kind: 'cpu' },
  });
  expect(saved.nodes.find((node) => node.type === 'work')).toMatchObject({
    work: { processingSeconds: 0, infrastructure: { cpu: { coreSeconds: 5, cores: 1 } } },
  });
});
