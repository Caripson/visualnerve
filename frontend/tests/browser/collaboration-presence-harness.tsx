/** Real canvas/control styles with bounded test-only presence, no room transport. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Controls, ControlButton, Panel, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { PresenceBar, PresenceCanvasLayer } from '../../src/collaboration/ui';
import type { CollaborationSnapshot } from '../../src/collaboration/types';
import { appLocaleController } from '../../src/i18n/runtime';
import '@xyflow/react/dist/style.css';
import '../../src/styles.css';
import '../../src/canvas/canvas-tools.css';
import '../../src/spatial/spatial.css';
import '../../src/presentation/presentation.css';
import '../../src/updates/app-updates.css';

type Scenario = '2d' | 'drawer' | 'player' | 'expanded-player' | 'update' | '3d' | 'layers';
const actions: string[] = [];
let setScenario: (scenario: Scenario) => void;
const participants = Array.from({ length: 128 }, (_, index) => ({
  deviceId: `device-${index}`,
  profileId: `profile-${index}`,
  name: index ? `Long participant ${index} ${'name '.repeat(14)}` : 'Pat Lee',
  color: index ? undefined : '#2563eb',
  role: 'editor' as const,
  credentialId: 'a'.repeat(64),
  selectedNodeIds: index === 0 ? ['business-node'] : [],
  pointer: index === 0 ? { x: 200, y: 160 } : undefined,
  connected: true,
  lastSeen: Date.now(),
}));
const snapshot: CollaborationSnapshot = {
  configured: true,
  status: 'live',
  roomId: 'fixture-room',
  selfDeviceId: 'self',
  displayName: 'Self',
  scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
  participants,
  pendingJoins: [],
};
Object.assign(window, {
  collaborationPresenceTest: {
    actions,
    scenario: (scenario: Scenario) => setScenario(scenario),
  },
});
function Canvas({ scenario }: { scenario: Scenario }) {
  if (scenario === '3d' || scenario === 'layers')
    return (
      <div className="canvas-shell spatial-canvas">
        <div className="spatial-stage" />
        <div className="spatial-hud">
          <div className="spatial-toolbar">
            {['2D', 'Fit', 'Move', 'View'].map((label) => (
              <button key={label} onClick={() => actions.push(label)}>
                {label}
              </button>
            ))}
          </div>
          <div className="spatial-caption">
            <strong>3D view</strong>
            <small>Orbit and zoom</small>
          </div>
          {scenario === 'layers' && (
            <details className="spatial-object-list" open>
              <summary>Objects and layers</summary>
              <div className="spatial-list-content">
                {Array.from({ length: 8 }, (_, index) => (
                  <div role="listitem" key={index}>
                    <button onClick={() => actions.push('layer')}>Layer {index + 1}</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  return (
    <div className="canvas-shell">
      <ReactFlow
        defaultNodes={[
          {
            id: 'business-node',
            position: { x: 80, y: 100 },
            data: { label: 'Business status color' },
            style: { background: '#ffcc44' },
          },
        ]}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      >
        <Controls showInteractive={false} showFitView={false}>
          <ControlButton aria-label="Fit view" onClick={() => actions.push('fit')}>
            Fit
          </ControlButton>
        </Controls>
        <Panel position="bottom-center" className="canvas-tools-panel">
          <div className="canvas-toggles">
            {['Grid', 'Draw', 'Map', 'Layers'].map((label) => (
              <button key={label} onClick={() => actions.push(label)}>
                {label}
              </button>
            ))}
          </div>
        </Panel>
        {scenario === 'drawer' && (
          <Panel position="top-center" className="selection-panel">
            <div className="context-toolbar">
              <div className="selection-tools">
                {Array.from({ length: 8 }, (_, index) => (
                  <button
                    aria-label={`Selection action ${index + 1}`}
                    key={index}
                    onClick={() => actions.push('selection')}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
function Fixture() {
  const [scenario, update] = useState<Scenario>('2d');
  setScenario = update;
  return (
    <ReactFlowProvider>
      <div className="application" data-has-document="true">
        <aside className="projects-shell" />
        <main className="main-workspace">
          <div className="document-bar">
            <h1>Presence layout</h1>
            <button onClick={() => actions.push('presence')}>Participants</button>
          </div>
          <Canvas scenario={scenario} />
          <div className="canvas-statusbar">Local workspace</div>
          {(scenario === 'player' || scenario === 'expanded-player') && (
            <section
              className="presentation-player"
              data-minimized={scenario === 'player' ? 'true' : 'false'}
              style={{ minHeight: scenario === 'player' ? 90 : 280 }}
            >
              <button onClick={() => actions.push('play')}>Play</button>
              <button onClick={() => actions.push('close-player')}>Close player</button>
            </section>
          )}
        </main>
        <aside className="properties-shell" />
      </div>
      <div className="collaboration-live-overlay">
        <PresenceBar snapshot={snapshot} onOpen={() => actions.push('presence')} />
      </div>
      <PresenceCanvasLayer snapshot={snapshot} />
      {scenario === 'update' && (
        <aside className="app-update-notice">
          <strong>An update is available</strong>
          <p>A deliberately tall update notice reserves its existing controls.</p>
          <div className="app-update-actions">
            <button onClick={() => actions.push('update')}>Update now</button>
          </div>
        </aside>
      )}
    </ReactFlowProvider>
  );
}
await appLocaleController.start();
createRoot(document.getElementById('root')!).render(<Fixture />);
