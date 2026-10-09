import { runStatusLabel } from './display';
import { useI18n } from '../i18n';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { getSpatialView } from '../spatial/types';
import { setSimulationModel } from './document';
import { simulationService } from './service';
import { useSimulationCanvasLifecycle } from './useSimulationCanvasLifecycle';
import { SimulationModelDialogs } from './SimulationModelDialogs';
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
import { simulationSetupEvent } from './setup-event';
import { SimulationUIActions, type SimulationUIAction } from './ui-action';
import './simulation.css';

const MetricsDashboard = lazy(() =>
  import('./MetricsDashboard').then((module) => ({ default: module.MetricsDashboard })),
);
const SimulationWorkbench = lazy(() =>
  import('./SimulationWorkbench').then((module) => ({ default: module.SimulationWorkbench })),
);

const SimulationResults = lazy(() =>
  import('./SimulationResults').then((module) => ({ default: module.SimulationResults })),
);

export { simulationTime } from './SimulationControls';
export function SimulationFeature() {
  const { t } = useI18n();
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
  const [, setControlsRevision] = useState(0);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof simulationService.list>>>([]);
  const uiActions = useMemo(
    () =>
      new SimulationUIActions(
        () => workspace.repo.db,
        () => useEditor.getState().graph?.diagram.id,
      ),
    [],
  );
  useLayoutEffect(() => {
    const unmount = uiActions.mount();
    // Observe intermediate navigation/lock states even if React batches a same-ID reopen.
    const unsubscribe = useEditor.subscribe(() => {
      const previous = uiActions.revision;
      uiActions.observeDiagram();
      if (uiActions.revision !== previous) setControlsRevision(uiActions.revision);
    });
    return () => {
      unsubscribe();
      unmount();
    };
  }, [uiActions]);
  const sameModel = useMemo(
    () => !view || JSON.stringify(graph?.simulation) === JSON.stringify(view.run.model),
    [graph?.simulation, view?.run.model],
  );
  useEffect(() => {
    setSettings(false);
    setScenarioId('');
    setError('');
    setBusy(false);
    setRuns([]);
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
    if (!graph?.simulation || !uiActions.isCurrent(graph.diagram.id)) return;
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
    if (!graph?.simulation || !uiActions.isCurrent(graph.diagram.id)) return;
    const action = uiActions.begin(graph.diagram.id, false);
    void (async () => {
      await action.check();
      const saved = await simulationService.list(graph.diagram.id);
      await action.check();
      setRuns(saved);
    })()
      .catch((failure) => {
        if (action.isCurrent()) setError((failure as Error).message);
      })
      .finally(action.dispose);
    return action.dispose;
  }, [graph?.diagram.id, resultsView?.run.status, resultsView?.run.id]);
  if (!graph?.simulation || graph.diagram.type !== 'process-simulator') return null;
  const diagramId = graph.diagram.id;
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
  const revision = uiActions.revision;
  const changeControls = (change: () => void) => {
    if (!uiActions.isCurrent(graph.diagram.id, revision)) return false;
    uiActions.cancelPending();
    // Selecting the same value can make every assumption setter a React no-op.
    // The rendered callbacks must still receive the newly invalidated revision.
    setControlsRevision(uiActions.revision);
    setBusy(false);
    change();
    return true;
  };
  async function perform(
    action: (job: SimulationUIAction) => Promise<unknown>,
    actionRevision = revision,
  ) {
    if (!uiActions.isCurrent(diagramId, actionRevision)) return;
    const job = uiActions.begin(diagramId);
    setError('');
    setBusy(true);
    try {
      await job.check();
      await action(job);
      await job.check();
    } catch (failure) {
      if (job.isCurrent()) setError((failure as Error).message);
    } finally {
      if (job.isCurrent()) setBusy(false);
      job.dispose();
    }
  }
  const play = () =>
    perform(async (job) => {
      if (!useEditor.getState().graph?.simulation?.nodes.length) {
        setSetup(true);
        return;
      }
      await workspace.settled();
      await job.check();
      if (
        canResume &&
        view &&
        JSON.stringify(useEditor.getState().graph?.simulation) === JSON.stringify(view.run.model)
      ) {
        await simulationService.control(view.run.id, 'resume', { beforeWrite: job.check });
        return;
      }
      if (active && view) {
        await simulationService.control(view.run.id, 'stop', { beforeWrite: job.check });
        await job.check();
      }
      const saved = useEditor.getState().graph!;
      await simulationService.start(saved.diagram.id, saved.simulation!, {
        durationSeconds: duration,
        seed,
        scenarioId: scenarioId || undefined,
        untilComplete,
        speed,
        animated: speed !== 'max',
        origin: 'ui',
        beforeWrite: job.check,
      });
    });
  const createScenario = () => {
    if (!changeControls(() => {})) return;
    const name = window
      .prompt(
        t('simulator.scenario.scenarioName'),
        `Scenario ${String.fromCharCode(65 + model.scenarios.length)}`,
      )
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
    pause: () =>
      view &&
      void perform((job) =>
        simulationService.control(view.run.id, 'pause', { beforeWrite: job.check }),
      ),
    stop: () =>
      view &&
      void perform((job) =>
        simulationService.control(view.run.id, 'stop', { beforeWrite: job.check }),
      ),
    reset: () =>
      view &&
      void perform((job) =>
        simulationService.control(view.run.id, 'reset', { beforeWrite: job.check }),
      ),
  };
  const runSettings = (
    <SimulationRunSettings
      model={model}
      speed={speed}
      setSpeed={(next) => {
        if (!changeControls(() => setSpeed(next))) return;
        if (view && active)
          void perform(
            (job) => simulationService.setSpeed(view.run.id, next, job.check),
            uiActions.revision,
          );
      }}
      duration={duration}
      setDuration={(next) => changeControls(() => setDuration(next))}
      seed={seed}
      setSeed={(next) => changeControls(() => setSeed(next))}
      untilComplete={untilComplete}
      setUntilComplete={(next) => changeControls(() => setUntilComplete(next))}
      scenarioId={scenarioId}
      setScenarioId={(next) => changeControls(() => setScenarioId(next))}
      createScenario={createScenario}
      configure={() => {
        changeControls(() => {
          setDetails(false);
          setSettings(true);
        });
      }}
    />
  );
  const notices = (
    <>
      {getSpatialView(graph).mode === '3d' && (
        <p className="simulation-notice">
          {t('simulator.feature.use2dViewToSeeLiveParticlesQueuesAndCapacityUnitsMetrics')}
        </p>
      )}
      {topologyChanged && (
        <p className="simulation-notice" role="status">
          {t('simulator.feature.theProcessStructureHasChangedThePreviousRunIsKeptInResults')}
        </p>
      )}
      {view && (!sameModel || !sameRunSettings) && (
        <p className="simulation-notice">
          {t('simulator.feature.theAssumptionsHaveChangedPlayStartsANewRunTheDisplayedMetrics')}
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
    <Suspense
      fallback={
        <p className="simulation-notice" role="status">
          {t('simulator.feature.loadingMetrics')}
        </p>
      }
    >
      <MetricsDashboard state={view.state} currency={view.run.model.currency} compact={compact} />
    </Suspense>
  );
  const results = (
    <Suspense
      fallback={
        <p className="simulation-notice" role="status">
          {t('simulator.feature.loadingReplayAndComparisonControls')}
        </p>
      }
    >
      <SimulationResults
        key={graph.diagram.id}
        model={model}
        view={resultsView}
        runs={runs}
        busy={busy}
        perform={perform}
        compact={compact}
      />
    </Suspense>
  );
  return (
    <section
      className={`simulation-feature${compact ? ' simulation-feature-compact' : ''}`}
      aria-label={t('simulator.feature.processSimulator')}
    >
      {compact ? (
        <>
          <SimulationDock
            {...actions}
            seconds={view?.state?.timeSeconds ?? 0}
            status={view?.run.status ?? 'ready'}
            openDetails={() => changeControls(() => setDetails(true))}
          />
          {!details && topologyChanged && (
            <p className="simulation-notice" role="status">
              {t('simulator.feature.processStructureChangedPreviousRunKeptInResultsPlayToRunThe')}
            </p>
          )}
          {!details && (visibleError || view?.run.error || view?.state?.message) && (
            <p role="alert" className="simulation-dock-error">
              {visibleError || view?.run.error || view?.state?.message}
            </p>
          )}
          {details && (
            <Suspense
              fallback={
                <p className="simulation-notice" role="status">
                  {t('simulator.feature.loadingDetails')}
                </p>
              }
            >
              <SimulationWorkbench
                close={() => changeControls(() => setDetails(false))}
                busy={busy}
                play={play}
                runSettings={
                  <>
                    <div className="simulation-run-settings">{runSettings}</div>
                    <ScenarioControls
                      graph={graph}
                      id={scenarioId}
                      select={(next) => changeControls(() => setScenarioId(next))}
                    />
                  </>
                }
                metrics={metrics}
                results={results}
                notices={notices}
                stopActions={<SimulationStopActions {...actions} />}
              />
            </Suspense>
          )}
        </>
      ) : (
        <>
          <div className="simulation-controls">
            <div className="simulation-transport">
              <strong>{t('simulator.feature.processSimulator')}</strong>
              {view?.state && (
                <button
                  aria-label={t(
                    metricsOpen ? 'simulator.run.metrics.hide' : 'simulator.run.metrics.show',
                  )}
                  aria-pressed={metricsOpen}
                  title={t(
                    'simulator.feature.showOrHideLiveMetricsToGiveTheProcessCanvasMoreSpace',
                  )}
                  onClick={() => setMetricsOpen((open) => !open)}
                >
                  {t('simulator.feature.metrics')}
                </button>
              )}
              <div className="simulation-playback">
                <SimulationActions {...actions} />
              </div>
              <div className="simulation-time">
                <output aria-label={t('simulator.run.simulatedTime')}>
                  {simulationTime(view?.state?.timeSeconds ?? 0)}
                </output>
                <span className="simulation-run-status" role="status">
                  {runStatusLabel(t, view?.run.status ?? 'ready')}
                </span>
              </div>
            </div>
            <div className="simulation-desktop-settings">{runSettings}</div>
          </div>
          <ScenarioControls
            graph={graph}
            id={scenarioId}
            select={(next) => changeControls(() => setScenarioId(next))}
          />
          {notices}
          {metricsOpen && metrics}
          {results}
        </>
      )}
      {settings && (
        <SimulationModelDialogs
          kind="settings"
          graph={graph}
          scenarioId={scenarioId || undefined}
          close={() => changeControls(() => setSettings(false))}
        />
      )}
      {setup && graph.simulation.nodes.length === 0 && (
        <SimulationModelDialogs
          kind="setup"
          graph={graph}
          close={() => changeControls(() => setSetup(false))}
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
