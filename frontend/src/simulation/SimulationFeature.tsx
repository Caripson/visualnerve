import { useEffect, useMemo, useRef, useState } from 'react';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { getSpatialView } from '../spatial/types';
import { setSimulationModel } from './document';
import { simulationService } from './service';
import { useSimulationCanvasLifecycle } from './useSimulationCanvasLifecycle';
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
import { ProcessWizard, simulationSetupEvent } from './ProcessWizard';
import './simulation.css';

export { simulationTime } from './SimulationControls';
export function SimulationFeature() {
  const graph = useEditor((state) => state.graph);
  const {
    view,
    resultsView,
    topologyChanged,
    error: topologyError,
  } = useSimulationCanvasLifecycle(
    graph?.simulation ? graph.diagram.id : undefined,
    graph?.simulation,
  );
  const compact = useCompactLayout();
  const [settings, setSettings] = useState(false);
  const [details, setDetails] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [setup, setSetup] = useState(false);
  const offeredSetup = useRef(new Set<string>());
  const [scenarioId, setScenarioId] = useState('');
  const [speed, setSpeed] = useState<SimulationSpeed>(10);
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
    setMetricsOpen(true);
    setSetup(false);
    setUntilComplete(false);
    if (graph?.simulation) {
      setDuration(graph.simulation.defaults.durationSeconds);
      setSeed(graph.simulation.defaults.seed);
    }
  }, [graph?.diagram.id]);
  useEffect(() => {
    if (!graph?.simulation) return;
    const empty = graph.simulation.nodes.length === 0;
    if (empty && !offeredSetup.current.has(graph.diagram.id)) {
      offeredSetup.current.add(graph.diagram.id);
      setSetup(true);
    }
    const openSetup = () => {
      if (!useEditor.getState().graph?.simulation?.nodes.length) setSetup(true);
    };
    window.addEventListener(simulationSetupEvent, openSetup);
    return () => window.removeEventListener(simulationSetupEvent, openSetup);
  }, [graph?.diagram.id, graph?.simulation?.nodes.length]);
  useEffect(() => {
    if (graph?.simulation)
      void simulationService
        .list(graph.diagram.id)
        .then(setRuns)
        .catch((failure) => setError(failure.message));
  }, [graph?.diagram.id, resultsView?.run.status, resultsView?.run.id]);
  if (!graph?.simulation || graph.diagram.type !== 'process-simulator') return null;
  const model = graph.simulation;
  const visibleError = error || topologyError;
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
      if (!useEditor.getState().graph?.simulation?.nodes.length) {
        setSetup(true);
        return;
      }
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
      {topologyChanged && (
        <p className="simulation-notice" role="status">
          The process structure has changed. The previous run is kept in Results and is no longer
          overlaid on this diagram. Play starts a run with the new structure.
        </p>
      )}
      {view && (!sameModel || !sameRunSettings) && (
        <p className="simulation-notice">
          The assumptions have changed. Play starts a new run; the displayed metrics belong to the
          original run.
        </p>
      )}
      {(visibleError || view?.run.error || view?.state?.message) && (
        <p role="alert" className="error-notice">
          {visibleError || view?.run.error || view?.state?.message}
        </p>
      )}
    </>
  );
  const metrics = view?.state && (
    <MetricsDashboard state={view.state} currency={view.run.model.currency} compact={compact} />
  );
  const results = (
    <SimulationResults
      key={graph.diagram.id}
      model={model}
      view={resultsView}
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
          {!details && topologyChanged && (
            <p className="simulation-notice" role="status">
              Process structure changed. Previous run kept in Results. Play to run the new
              structure.
            </p>
          )}
          {!details && (visibleError || view?.run.error || view?.state?.message) && (
            <p role="alert" className="simulation-dock-error">
              {visibleError || view?.run.error || view?.state?.message}
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
            <div className="simulation-transport">
              <strong>Process Simulator</strong>
              {view?.state && (
                <button
                  aria-label={`${metricsOpen ? 'Hide' : 'Show'} simulation metrics`}
                  aria-pressed={metricsOpen}
                  title="Show or hide live metrics to give the process canvas more space"
                  onClick={() => setMetricsOpen((open) => !open)}
                >
                  Metrics
                </button>
              )}
              <div className="simulation-playback">
                <SimulationActions {...actions} />
              </div>
              <div className="simulation-time">
                <output aria-label="Simulated time">
                  {simulationTime(view?.state?.timeSeconds ?? 0)}
                </output>
                <span className="simulation-run-status" role="status">
                  {view?.run.status ?? 'ready'}
                </span>
              </div>
            </div>
            <div className="simulation-desktop-settings">{runSettings}</div>
          </div>
          <ScenarioControls graph={graph} id={scenarioId} select={setScenarioId} />
          {notices}
          {metricsOpen && metrics}
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
      {setup && graph.simulation.nodes.length === 0 && (
        <ProcessWizard
          graph={graph}
          close={() => setSetup(false)}
          created={(options) => {
            setDuration(options.durationSeconds);
            setSeed(graph.simulation!.defaults.seed);
            setUntilComplete(options.untilComplete);
            useEditor.setState((state) => ({ viewportRequest: state.viewportRequest + 1 }));
          }}
        />
      )}
    </section>
  );
}
