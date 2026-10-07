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
  const [panel, setPanel] = useState('run');
  return (
    <Modal title="Simulation details" close={close} wide className="simulation-workbench-dialog">
      <div className="simulation-workbench">
        <label className="simulation-panel-choice">
          Simulation panel
          <select
            aria-label="Simulation panel"
            value={panel}
            onChange={(event) => setPanel(event.target.value)}
          >
            <option value="run">Run settings</option>
            <option value="metrics">Metrics</option>
            <option value="results">Replay &amp; compare</option>
          </select>
        </label>
        <div className="simulation-workbench-body">
          {notices}
          <div hidden={panel !== 'run'}>
            <h3>Run settings</h3>
            <p>Choose a scenario and duration, then watch work move through the diagram.</p>
            {runSettings}
            <div className="simulation-stop-actions">{stopActions}</div>
          </div>
          <div hidden={panel !== 'metrics'}>
            <h3>Live metrics</h3>
            {metrics || <p>Play the simulation to see queues, throughput and economics here.</p>}
          </div>
          <div hidden={panel !== 'results'}>
            <h3>Replay &amp; compare</h3>
            <p>Inspect a saved run or select two or more runs to compare their outcomes.</p>
            {results}
          </div>
        </div>
        <footer className="simulation-sheet-actions">
          <button onClick={close}>Back to diagram</button>
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
              Run simulation
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
