import { Play, Pause, Square, RotateCcw, Settings2, SlidersHorizontal } from 'lucide-react';
import type { SimulationSpeed } from './protocol';
import type { SimulationModel } from './types';

export const simulationTime = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${Math.floor(seconds % 60)}s`;

interface ActionProps {
  busy: boolean;
  active: boolean;
  paused: boolean;
  canResume: boolean;
  hasRun: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  reset: () => void;
}

export function SimulationActions({
  compact = false,
  ...props
}: ActionProps & { compact?: boolean }) {
  return (
    <>
      <button
        className="simulation-play primary"
        aria-label={
          props.canResume
            ? 'Resume simulation'
            : props.active
              ? 'Rerun simulation'
              : 'Play simulation'
        }
        disabled={props.busy}
        onClick={props.play}
      >
        <Play size={compact ? 19 : 15} />
        {props.canResume ? 'Resume' : props.active ? 'Rerun' : 'Play'}
      </button>
      <button
        className={compact ? 'simulation-icon-action' : undefined}
        aria-label="Pause simulation"
        disabled={props.busy || !props.active || props.paused}
        onClick={props.pause}
      >
        <Pause size={compact ? 19 : 15} />
        {!compact && 'Pause'}
      </button>
      {!compact && <SimulationStopActions {...props} />}
    </>
  );
}

export function SimulationStopActions(props: ActionProps) {
  return (
    <>
      <button
        aria-label="Stop simulation"
        disabled={props.busy || !props.active}
        onClick={props.stop}
      >
        <Square size={15} />
        Stop
      </button>
      <button
        aria-label="Reset simulation"
        disabled={props.busy || !props.hasRun}
        onClick={props.reset}
      >
        <RotateCcw size={15} />
        Reset
      </button>
    </>
  );
}

export function SimulationDock({
  seconds,
  status,
  openDetails,
  ...actions
}: ActionProps & {
  seconds: number;
  status: string;
  openDetails: () => void;
}) {
  return (
    <div className="simulation-dock">
      <SimulationActions {...actions} compact />
      <div className="simulation-dock-clock">
        <output aria-label="Simulated time" title={simulationTime(seconds)}>
          {simulationTime(seconds)}
        </output>
        <span className="simulation-run-status" role="status">
          {status}
        </span>
      </div>
      <button
        aria-label="Open simulation details"
        className="simulation-details-action"
        onClick={openDetails}
      >
        <SlidersHorizontal size={19} />
        <span>Details</span>
      </button>
    </div>
  );
}

export function SimulationRunSettings({
  model,
  speed,
  setSpeed,
  duration,
  setDuration,
  seed,
  setSeed,
  untilComplete,
  setUntilComplete,
  scenarioId,
  setScenarioId,
  createScenario,
  configure,
}: {
  model: SimulationModel;
  speed: SimulationSpeed;
  setSpeed: (value: SimulationSpeed) => void;
  duration: number;
  setDuration: (value: number) => void;
  seed: number;
  setSeed: (value: number) => void;
  untilComplete: boolean;
  setUntilComplete: (value: boolean) => void;
  scenarioId: string;
  setScenarioId: (value: string) => void;
  createScenario: () => void;
  configure: () => void;
}) {
  return (
    <>
      <label>
        Speed
        <select
          aria-label="Simulation speed"
          value={speed}
          onChange={(event) =>
            setSpeed(
              event.target.value === 'max'
                ? 'max'
                : (Number(event.target.value) as SimulationSpeed),
            )
          }
        >
          {[1, 10, 100, 'max'].map((value) => (
            <option key={value} value={value}>
              {value === 'max' ? 'MAX' : `${value}×`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Duration
        <select
          aria-label="Simulation duration preset"
          value={[3600, 86400, 604800, 2592000, 31536000].includes(duration) ? duration : 'custom'}
          onChange={(event) =>
            event.target.value !== 'custom' && setDuration(Number(event.target.value))
          }
        >
          <option value={3600}>1 hour</option>
          <option value={86400}>1 day</option>
          <option value={604800}>1 week</option>
          <option value={2592000}>1 month (30 days)</option>
          <option value={31536000}>1 year (365 days)</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label>
        Hours
        <input
          aria-label="Simulation duration hours"
          type="number"
          min={0.001}
          step="any"
          value={duration / 3600}
          onChange={(event) => setDuration(Number(event.target.value) * 3600)}
        />
      </label>
      <label>
        Seed
        <input
          aria-label="Simulation random seed"
          type="number"
          min={0}
          step={1}
          value={seed}
          onChange={(event) => setSeed(Number(event.target.value))}
        />
      </label>
      <label className="simulation-finish-field">
        <span>Finish workload</span>
        <input
          aria-label="Finish all generated work"
          type="checkbox"
          checked={untilComplete}
          onChange={(event) => setUntilComplete(event.target.checked)}
        />
      </label>
      <label className="simulation-scenario-field">
        Scenario
        <select
          aria-label="Simulation scenario"
          value={scenarioId}
          onChange={(event) => setScenarioId(event.target.value)}
        >
          <option value="">Base model</option>
          {model.scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>
      <button onClick={createScenario}>New scenario</button>
      <button aria-label="Configure simulation" onClick={configure}>
        <Settings2 size={15} />
        Assumptions
      </button>
    </>
  );
}
