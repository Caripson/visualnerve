import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { VaultGate } from './security/VaultGate';
import { vaultSession, workspaceStorage } from './storage/runtime';
import { WorkspaceLoader } from './security/WorkspaceLoader';
import { openWorkspaceSurface } from './security/open-workspace';
import { I18nProvider } from './i18n';
import { AppUpdateBoundary } from './updates/AppUpdateBoundary';
const loadWorkspace = () =>
  import('./security/WorkspaceSurface').then((module) => ({ default: module.WorkspaceSurface }));
const openWorkspace = () => openWorkspaceSurface(workspaceStorage);
createRoot(document.getElementById('visual-nerve')!).render(
  <I18nProvider>
    <AppUpdateBoundary>
      {vaultSession ? (
        <VaultGate session={vaultSession} openWorkspace={openWorkspace}>
          <WorkspaceLoader session={vaultSession} load={loadWorkspace} />
        </VaultGate>
      ) : (
        <WorkspaceLoader load={loadWorkspace} />
      )}
    </AppUpdateBoundary>
  </I18nProvider>,
);
