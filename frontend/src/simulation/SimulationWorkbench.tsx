import { useI18n } from '../i18n';
import { useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { Modal } from '../components/Modal';

export function SimulationWorkbench({
  close,
  runSettings,
  metrics,
  results,
  notices,
  stopActions,
  busy,
  play,
}: {
  close: () => void;
  runSettings: ReactNode;
  metrics: ReactNode;
  results: ReactNode;
  notices: ReactNode;
  stopActions: ReactNode;
  busy: boolean;
  play: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [panel, setPanel] = useState('run');
  return (
    <Modal
      title={t('simulator.workbench.title')}
      close={close}
      wide
      className="simulation-workbench-dialog"
    >
      <div className="simulation-workbench">
        <label className="simulation-panel-choice">
          {t('simulator.workbench.simulationPanel')}{' '}
          <select
            aria-label={t('simulator.workbench.simulationPanel')}
            value={panel}
            onChange={(event) => setPanel(event.target.value)}
          >
            <option value="run">{t('simulator.workbench.runSettings')}</option>
            <option value="metrics">{t('simulator.feature.metrics')}</option>
            <option value="results">{t('simulator.workbench.replayAndCompare')}</option>
          </select>
        </label>
        <div className="simulation-workbench-body">
          {notices}
          <div hidden={panel !== 'run'}>
            <h3>{t('simulator.workbench.runSettings')}</h3>
            <p>
              {t(
                'simulator.workbench.chooseAScenarioAndDurationThenWatchWorkMoveThroughTheDiagram',
              )}
            </p>
            {runSettings}
            <div className="simulation-stop-actions">{stopActions}</div>
          </div>
          <div hidden={panel !== 'metrics'}>
            <h3>{t('simulator.workbench.liveMetrics')}</h3>
            {metrics || (
              <p>
                {t('simulator.workbench.playTheSimulationToSeeQueuesThroughputAndEconomicsHere')}
              </p>
            )}
          </div>
          <div hidden={panel !== 'results'}>
            <h3>{t('simulator.workbench.replayAndCompare')}</h3>
            <p>{t('simulator.workbench.inspectASavedRunOrSelectTwoOrMoreRunsToCompare')}</p>
            {results}
          </div>
        </div>
        <footer className="simulation-sheet-actions">
          <button onClick={close}>{t('simulator.workbench.backToDiagram')}</button>
          {panel === 'run' && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                await play();
                close();
              }}
            >
              <Play size={18} />
              {t('simulator.workbench.runSimulation')}{' '}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
