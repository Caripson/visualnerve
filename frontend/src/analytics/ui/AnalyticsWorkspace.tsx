import { useState } from 'react';
import { Activity, ArrowRight, Upload } from 'lucide-react';
import type { AnalyticsMeasurement, AnalyticsSignal } from '../types';
import { AnalyticsImportDialog } from './AnalyticsImportDialog';
import { DatasetPanel } from './DatasetPanel';
import { ExplorePanel } from './ExplorePanel';
import { MeasurementsPanel } from './MeasurementsPanel';
import { SignalsPanel } from './SignalsPanel';
import { SignalLabPanel } from './SignalLabPanel';
import { ScenariosPanel } from './ScenariosPanel';
import { errorMessage } from './display';
import { useAnalysis } from './use-analysis';
import type {
  AnalyticsWorkspaceProps,
  ChartSelection,
  MeasurementFitOverlay,
  PanelProps,
} from './types';
import './analytics.css';

const stages = ['Import', 'Explore', 'Measure', 'Detect', 'Validate', 'Simulate'] as const;
type Stage = (typeof stages)[number];

export function AnalyticsWorkspace(props: AnalyticsWorkspaceProps) {
  const analysis = useAnalysis(props);
  const [stage, setStage] = useState<Stage>(props.analytics.datasets.length ? 'Explore' : 'Import');
  const [importing, setImporting] = useState<{ target?: string }>();
  const [selection, setSelection] = useState<ChartSelection>();
  const [measurement, setMeasurement] = useState<AnalyticsMeasurement>();
  const [measurementFit, setMeasurementFit] = useState<MeasurementFitOverlay>();
  const [signal, setSignal] = useState<AnalyticsSignal>();
  const [scenarioSignal, setScenarioSignal] = useState<AnalyticsSignal>();
  const [pendingThreshold, setPendingThreshold] = useState<{ seriesId: string; value: number }>();
  const [exampleBusy, setExampleBusy] = useState(false);
  const panel: PanelProps = {
    model: props.analytics,
    save: analysis.save,
    run: analysis.run,
    archive: analysis.archive,
    busy: analysis.busy || props.disabled === true,
    nodes: props.nodes,
    processTargets: props.processTargets,
    loadProcessTarget: props.loadProcessTarget,
  };
  const example = async () => {
    setExampleBusy(true);
    analysis.setError('');
    try {
      if (props.useExample) await props.useExample();
      else {
        const { createAnalyticsExample } = await import('../example');
        analysis.signal.throwIfAborted();
        await analysis.save(await createAnalyticsExample(analysis.signal));
      }
      setStage('Explore');
    } catch (error) {
      analysis.setError(errorMessage(error));
    } finally {
      setExampleBusy(false);
    }
  };
  const focus = (signal: AnalyticsSignal) => {
    setSignal(signal);
    setStage('Explore');
  };
  const scenario = (signal: AnalyticsSignal) => {
    setScenarioSignal(signal);
    setStage('Simulate');
  };
  return (
    <main
      className="analytics-workspace"
      aria-label="Time Series & Signal Analysis"
      aria-busy={analysis.busy || exampleBusy}
    >
      <header className="analytics-heading">
        <div>
          <div className="analytics-kicker">Time Series & Signal Analysis</div>
          <h1>Turn data into signals</h1>
          <p className="muted">Measure change. Spot patterns. Explore what could happen next.</p>
        </div>
        <a
          className="analytics-link"
          href="https://www.visualnerve.com/help/time-series-analysis/"
          target="_blank"
          rel="noreferrer"
        >
          Read the guide <ArrowRight size={13} style={{ verticalAlign: 'middle' }} />
        </a>
      </header>
      <nav className="analytics-tabs" role="tablist" aria-label="Analysis workflow">
        {stages.map((item, index) => (
          <button
            key={item}
            role="tab"
            id={`analytics-tab-${item.toLowerCase()}`}
            aria-selected={stage === item}
            aria-controls={`analytics-stage-${item.toLowerCase()}`}
            tabIndex={stage === item ? 0 : -1}
            disabled={item !== 'Import' && !props.analytics.datasets.length}
            onClick={() => setStage(item)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next =
                  stages[
                    (index + (event.key === 'ArrowRight' ? 1 : -1) + stages.length) % stages.length
                  ];
                if (next === 'Import' || props.analytics.datasets.length) {
                  setStage(next);
                  document.getElementById(`analytics-tab-${next.toLowerCase()}`)?.focus();
                }
              }
            }}
          >
            {index + 1} · {item}
          </button>
        ))}
      </nav>
      {analysis.analyzing && (
        <div className="analytics-progress" role="status">
          <progress value={analysis.progress} max={1} />
          <span>Local analysis · {Math.round(analysis.progress * 100)}%</span>
          <button onClick={analysis.cancel}>Cancel analysis</button>
        </div>
      )}
      {props.analytics.results.some((result) => result.stale) && (
        <p className="analytics-note">
          Some saved results refer to earlier data or definitions. Recalculate current definitions
          when needed; retained historical inputs and locked results remain available.
        </p>
      )}
      {analysis.saving && (
        <p role="status" className="analytics-note">
          Saving in your encrypted workspace…
        </p>
      )}
      {analysis.error && (
        <p role="alert" className="analytics-note analytics-error">
          {analysis.error}
        </p>
      )}
      {analysis.notice && (
        <p role="status" className="analytics-note analytics-success">
          {analysis.notice}
        </p>
      )}
      {!props.analytics.datasets.length ? (
        <section className="analytics-panel analytics-empty">
          <Activity size={42} strokeWidth={1.4} />
          <h2>Your data, from history to what-if</h2>
          <p>
            Start with a fully configured Growth & Churn example or map your own local CSV, XLSX or
            JSON file. No AI or account is needed.
          </p>
          <div className="analytics-grid">
            <button
              className="analytics-choice"
              disabled={exampleBusy || props.disabled}
              onClick={() => void example()}
            >
              <Activity size={22} />
              <strong>{exampleBusy ? 'Preparing example…' : 'Use example data'}</strong>
              <span>
                At least five years of reconciled customer and MRC history, daily snapshots, saved
                measurements, signal rules and three scenarios.
              </span>
              <span className="analytics-example-label">Illustrative example data</span>
            </button>
            <button
              className="analytics-choice"
              disabled={exampleBusy || props.disabled}
              onClick={() => setImporting({})}
            >
              <Upload size={22} />
              <strong>Import your data</strong>
              <span>
                Preview the file, choose time and value columns, define semantics, and confirm a
                validation report before saving.
              </span>
            </button>
          </div>
          <p className="analytics-note" style={{ marginTop: 22 }}>
            Your document is protected by the same encrypted workspace. Exports and authorized
            API/MCP responses can share content when you choose them. Live collaboration rooms do
            not yet support analytics documents.
          </p>
        </section>
      ) : (
        <section
          role="tabpanel"
          id={`analytics-stage-${stage.toLowerCase()}`}
          aria-labelledby={`analytics-tab-${stage.toLowerCase()}`}
        >
          {stage === 'Import' && (
            <DatasetPanel {...panel} onImport={(target) => setImporting({ target })} />
          )}
          {stage === 'Explore' && (
            <ExplorePanel
              {...panel}
              selection={selection}
              onSelection={setSelection}
              focusedSignal={signal}
              onSignalFocus={focus}
              onThreshold={(seriesId, value) => {
                setPendingThreshold({ seriesId, value });
                setStage('Detect');
              }}
            />
          )}
          {stage === 'Measure' && (
            <>
              <ExplorePanel
                {...panel}
                compact
                selection={selection}
                onSelection={setSelection}
                measurement={measurement}
                measurementFit={measurementFit}
                onMeasurementPoints={(points) => {
                  if (measurement) setMeasurement({ ...measurement, points });
                }}
                focusedSignal={signal}
                onSignalFocus={focus}
                onThreshold={(seriesId, value) => {
                  setPendingThreshold({ seriesId, value });
                  setStage('Detect');
                }}
              />
              <MeasurementsPanel
                {...panel}
                selection={selection}
                draft={measurement}
                onDraft={setMeasurement}
                onFit={setMeasurementFit}
              />
            </>
          )}
          {stage === 'Detect' && (
            <SignalsPanel
              {...panel}
              pendingThreshold={pendingThreshold}
              onFocus={focus}
              onScenario={scenario}
            />
          )}
          {stage === 'Validate' && <SignalLabPanel {...panel} />}
          {stage === 'Simulate' && <ScenariosPanel {...panel} sourceSignal={scenarioSignal} />}
        </section>
      )}
      {importing && (
        <AnalyticsImportDialog
          model={props.analytics}
          targetDatasetId={importing.target}
          close={() => setImporting(undefined)}
          apply={async (preview, mode, target) => {
            const prepared = await analysis.run({
              kind: 'commit-import',
              model: props.analytics,
              preview,
              mode,
              targetDatasetId: target,
            });
            if (!('schemaVersion' in prepared) || prepared.schemaVersion !== 1)
              throw new Error('Unexpected import preparation result.');
            await analysis.save(prepared);
            setStage('Explore');
          }}
        />
      )}
    </main>
  );
}
