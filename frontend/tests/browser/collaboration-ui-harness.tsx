/** Test-only component fixture. Never imported by the product entry point. */
import { createRoot } from 'react-dom/client';
import { CollaborationPanel } from '../../src/collaboration/ui';
import type {
  CollaborationSnapshot,
  CollaborationUiController,
} from '../../src/collaboration/types';
import { appLocaleController } from '../../src/i18n/runtime';
import '../../src/styles.css';

let snapshot: Readonly<CollaborationSnapshot> = {
  configured: true,
  status: 'idle',
  diagramId: 'review-diagram',
  displayName: 'Casey Morgan',
  scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
  participants: [],
  pendingJoins: [],
};
const listeners = new Set<() => void>();
const actions: string[] = [];
const record = (name: string) => async () => {
  actions.push(name);
};
const controller: CollaborationUiController = {
  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
  create: record('create'),
  join: record('join'),
  createInvitation: record('invite'),
  approve: record('approve'),
  reject: record('reject'),
  changeRole: record('role'),
  remove: record('remove'),
  reconnect: record('reconnect'),
  leave: record('leave'),
  closeRoom: record('close'),
};
declare global {
  interface Window {
    collaborationUiTest: { actions: string[]; emit(value: Partial<CollaborationSnapshot>): void };
  }
}
window.collaborationUiTest = {
  actions,
  emit(value) {
    snapshot = { ...snapshot, ...value };
    for (const listener of listeners) listener();
  },
};
await appLocaleController.start();
createRoot(document.getElementById('root')!).render(
  <CollaborationPanel
    controller={controller}
    close={() => {
      actions.push('dismiss');
    }}
  />,
);
