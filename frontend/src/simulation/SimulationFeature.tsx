import { useEffect, useMemo, useState } from 'react';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { getSpatialView } from '../spatial/types';
import { setSimulationModel } from './document';
import { simulationService } from './service';
import { useSimulation } from './useSimulation';
import { ModelEditor } from './ModelEditor';
import { MetricsDashboard } from './MetricsDashboard';
import { ScenarioControls } from './ScenarioControls';
import { cloneScenario } from './scenario-patch';
import type { SimulationSpeed } from './protocol';
import {
  SimulationActions,
  SimulationDock,
  SimulationRunSettings,
  SimulationStopActions,
  simulationTime,
} from './SimulationControls';
import { SimulationResults } from './SimulationResults';
import { SimulationWorkbench } from './SimulationWorkbench';
import './simulation.css';

export { simulationTime } from './SimulationControls';
export function SimulationFeature() {
  const graph = useEditor((state) => state.graph);
  const view = useSimulation(graph?.simulation ? graph.diagram.id : undefined);
  const compact = useCompactLayout();
  const [settings, setSettings] = useState(false);
  const [details, setDetails] = useState(false);
  const [scenarioId, setScenarioId] = useState('');
  const [speed, setSpeed] = useState<SimulationSpeed>(100);
  const [duration, setDuration] = useState(86400);
  const [seed, setSeed] = useState(42);
  const [untilComplete, setUntilComplete] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof simulationService.list>>>([]);
  const sameModel = useMemo(
    () => !view || JSON.stringify(graph?.simulation) === JSON.stringify(view.run.model),
    [graph?.simulation, view?.run.model],
  );
  useEffect(() => {
    setSettings(false);
    setScenarioId('');
    setError('');
    setDetails(false);
    if (graph?.simulation) {
      setDuration(graph.simulation.defaults.durationSeconds);
      setSeed(graph.simulation.defaults.seed);
    }
  }, [graph?.diagram.id]);
  useEffect(() => {
    if (graph?.simulation)
      void simulationService
        .list(graph.diagram.id)
        .then(setRuns)
        .catch((failure) => setError(failure.message));
  }, [graph?.diagram.id, view?.run.status, view?.run.id]);
  if (!graph?.simulation || graph.diagram.type !== 'process-simulator') return null;
  const model = graph.simulation;
  const active = view?.run.status === 'running' || view?.run.status === 'paused';
  const paused = view?.run.status === 'paused';
  const sameRunSettings =
    !view ||
    ((view.run.options.scenarioId ?? '') === scenarioId &&
      view.run.options.seed === seed &&
      view.run.options.durationSeconds === duration &&
      !!view.run.options.untilComplete === untilComplete);
  const canResume = paused && view?.replayTimeSeconds === undefined && sameModel && sameRunSettings;
  async function perform(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const play = () =>
    perform(async () => {
      await workspace.settled();
      if (canResume && view) {
        await simulationService.control(view.run.id, 'resume');
        return;
      }
      if (active && view) await simulationService.control(view.run.id, 'stop');
      const saved = useEditor.getState().graph!;
      await simulationService.start(saved.diagram.id, saved.simulation!, {
        durationSeconds: duration,
        seed,
        scenarioId: scenarioId || undefined,
        untilComplete,
        speed,
        animated: speed !== 'max',
        origin: 'ui',
      });
    });
  const createScenario = () => {
    const name = window
      .prompt('Scenario name', `Scenario ${String.fromCharCode(65 + model.scenarios.length)}`)
      ?.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    useEditor.getState().command('Create simulation scenario', (current) =>
      setSimulationModel(current, {
        ...current.simulation!,
        scenarios: [
          ...current.simulation!.scenarios,
          cloneScenario(current.simulation!, scenarioId, name, id),
        ],
      }),
    );
    setScenarioId(id);
  };
  const actions = {
    busy,
    active,
    paused,
    canResume,
    hasRun: !!view,
    play,
    pause: () => view && void perform(() => simulationService.control(view.run.id, 'pause')),
    stop: () => view && void perform(() => simulationService.control(view.run.id, 'stop')),
    reset: () => view && void perform(() => simulationService.control(view.run.id, 'reset')),
  };
  const runSettings = (
    <SimulationRunSettings
      model={model}
      speed={speed}
      setSpeed={(next) => {
        setSpeed(next);
        if (view && active) void perform(() => simulationService.setSpeed(view.run.id, next));
      }}
      duration={duration}
      setDuration={setDuration}
      seed={seed}
      setSeed={setSeed}
      untilComplete={untilComplete}
      setUntilComplete={setUntilComplete}
      scenarioId={scenarioId}
      setScenarioId={setScenarioId}
      createScenario={createScenario}
      configure={() => {
        setDetails(false);
        setSettings(true);
      }}
    />
  );
  const notices = (
    <>
      {getSpatialView(graph).mode === '3d' && (
        <p className="simulation-notice">
          Use 2D view to see live particles, queues and capacity units. Metrics remain live in 3D.
        </p>
      )}
      {view && (!sameModel || !sameRunSettings) && (
        <p className="simulation-notice">
          The assumptions have changed. Play starts a new run; the displayed metrics belong to the
          original run.
        </p>
      )}
      {(error || view?.run.error || view?.state?.message) && (
        <p role="alert" className="error-notice">
          {error || view?.run.error || view?.state?.message}
        </p>
      )}
    </>
  );
  const metrics = view?.state && (
    <MetricsDashboard state={view.state} currency={model.currency} compact={compact} />
  );
  const results = (
    <SimulationResults
      key={graph.diagram.id}
      model={model}
      view={view}
      runs={runs}
      busy={busy}
      perform={perform}
      compact={compact}
    />
  );
  return (
    <section
      className={`simulation-feature${compact ? ' simulation-feature-compact' : ''}`}
      aria-label="Process Simulator"
    >
      {compact ? (
        <>
          <SimulationDock
            {...actions}
            seconds={view?.state?.timeSeconds ?? 0}
            status={view?.run.status ?? 'ready'}
            openDetails={() => setDetails(true)}
          />
          {!details && (error || view?.run.error || view?.state?.message) && (
            <p role="alert" className="simulation-dock-error">
              {error || view?.run.error || view?.state?.message}
            </p>
          )}
          {details && (
            <SimulationWorkbench
              close={() => setDetails(false)}
              busy={busy}
              play={play}
              runSettings={
                <>
                  <div className="simulation-run-settings">{runSettings}</div>
                  <ScenarioControls graph={graph} id={scenarioId} select={setScenarioId} />
                </>
              }
              metrics={metrics}
              results={results}
              notices={notices}
              stopActions={<SimulationStopActions {...actions} />}
            />
          )}
        </>
      ) : (
        <>
          <div className="simulation-controls">
            <strong>Process Simulator</strong>
            <SimulationActions {...actions} />
            {runSettings}
            <output aria-label="Simulated time">
              {simulationTime(view?.state?.timeSeconds ?? 0)}
            </output>
            <span className="simulation-run-status" role="status">
              {view?.run.status ?? 'ready'}
            </span>
          </div>
          <ScenarioControls graph={graph} id={scenarioId} select={setScenarioId} />
          {notices}
          {metrics}
          {results}
        </>
      )}
      {settings && (
        <ModelEditor
          graph={graph}
          scenarioId={scenarioId || undefined}
          close={() => setSettings(false)}
        />
      )}
    </section>
  );
}
