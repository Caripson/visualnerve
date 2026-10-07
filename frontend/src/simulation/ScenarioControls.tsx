import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { setSimulationModel } from './document';

export function ScenarioControls({
  graph,
  id,
  select,
}: {
  graph: Graph;
  id: string;
  select: (id: string) => void;
}) {
  const scenario = graph.simulation?.scenarios.find((entry) => entry.id === id);
  if (!scenario) return null;
  const change = (patch: Partial<typeof scenario>) =>
    useEditor.getState().command('Update simulation scenario', (current) =>
      setSimulationModel(current, {
        ...current.simulation!,
        scenarios: current.simulation!.scenarios.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry,
        ),
      }),
    );
  return (
    <details className="simulation-scenario-options">
      <summary>Scenario assumptions: {scenario.name}</summary>
      <div className="simulation-row">
        <label>
          Demand multiplier
          <input
            aria-label="Scenario demand multiplier"
            type="number"
            min={0}
            step={0.1}
            value={scenario.demandMultiplier ?? 1}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0) change({ demandMultiplier: value });
            }}
          />
        </label>
        <button
          onClick={() => {
            const name = window.prompt('Scenario name', scenario.name)?.trim();
            if (name) change({ name });
          }}
        >
          Rename scenario
        </button>
        <button
          onClick={() => {
            useEditor.getState().command('Delete simulation scenario', (current) =>
              setSimulationModel(current, {
                ...current.simulation!,
                scenarios: current.simulation!.scenarios.filter((entry) => entry.id !== id),
              }),
            );
            select('');
          }}
        >
          Delete scenario
        </button>
        <p>
          Demand multiplier scales all sources in this scenario. Change a single source in
          Assumptions to scale one business flow.
        </p>
      </div>
    </details>
  );
}
