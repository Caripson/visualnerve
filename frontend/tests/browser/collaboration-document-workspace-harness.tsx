/** Real document model, forms, modal and native image processing; no room/relay. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../src/components/Modal';
import { DocumentWorkspace } from '../../src/collaboration/ui/DocumentWorkspace';
import {
  mutateCollaboration,
  type CollaborationAction,
  type CollaborationActionContext,
} from '../../src/collaboration/model';
import type {
  CollaborationSnapshot,
  CollaborationUiController,
} from '../../src/collaboration/types';
import { blankGraph, newNode, type Graph } from '../../src/model/types';
import { appLocaleController } from '../../src/i18n/runtime';
import { useI18n } from '../../src/i18n';
import '../../src/styles.css';
import '../../src/collaboration/ui/collaboration.css';

let graph = blankGraph('Document workflow browser fixture');
graph.nodes.push(newNode(graph.diagram.id));
graph.nodes[0].title = 'A delivery node with a long title that must wrap in cards';
const initial = { role: 'owner' as const, source: 'ui' as const, now: '2026-10-01T12:00:00.000Z' };
graph = mutateCollaboration(
  graph,
  { type: 'profile.create', profile: { name: 'Pat Lee', color: '#2563eb' } },
  initial,
);
const own = graph.diagram.collaboration!.profiles.find((profile) => profile.name === 'Pat Lee')!.id;
graph = mutateCollaboration(
  graph,
  { type: 'profile.create', profile: { name: 'Long profile '.repeat(6).trim(), color: '#ffffff' } },
  { ...initial, profileId: own },
);
const context: CollaborationActionContext = { ...initial, profileId: own };
graph = mutateCollaboration(
  graph,
  {
    type: 'comment.create',
    nodeId: graph.nodes[0].id,
    text: 'Review the delivery plan.\n' + 'A long comment line '.repeat(20),
  },
  context,
);
graph = mutateCollaboration(
  graph,
  {
    type: 'task.create',
    task: {
      nodeId: graph.nodes[0].id,
      title: 'Review the delivery milestone '.repeat(8).trim(),
      description: 'Prepare delivery evidence.\n' + 'Detailed description '.repeat(20),
      assigneeId: own,
      dueDate: '2026-12-01',
      status: 'in-progress',
    },
  },
  context,
);
let update: (value: Graph) => void;
let updateRole: (value: CollaborationActionContext['role']) => void;
const actions: CollaborationAction[] = [];
const snapshot: CollaborationSnapshot = {
  configured: true,
  status: 'idle',
  displayName: 'Pat',
  participants: [],
  pendingJoins: [],
  scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
};
const controller: CollaborationUiController = {
  subscribe: () => () => {},
  getSnapshot: () => snapshot,
  create: async () => {},
  join: async () => {},
  createInvitation: async () => {},
  approve: async () => {},
  reject: async () => {},
  changeRole: async () => {},
  remove: async () => {},
  reconnect: async () => {},
  leave: async () => {},
  closeRoom: async () => {},
  documentContext: () => context,
  selectDocumentProfile: async (_diagramId, profileId) => {
    context.profileId = profileId;
  },
  applyDocumentAction: async (_diagramId, action, baseVersion) => {
    if (baseVersion !== graph.diagram.version) throw new Error('Fixture version conflict.');
    actions.push(action);
    graph = mutateCollaboration(graph, action, context);
    graph = { ...graph, diagram: { ...graph.diagram, version: graph.diagram.version + 1 } };
    update(graph);
    return graph;
  },
};
Object.assign(window, {
  collaborationDocumentUiTest: {
    graph: () => structuredClone(graph),
    actions,
    role: (role: CollaborationActionContext['role']) => updateRole(role),
  },
});
function Fixture() {
  const { t } = useI18n();
  const [current, setCurrent] = useState(graph);
  const [role, setRole] = useState(context.role);
  context.role = role;
  update = setCurrent;
  updateRole = setRole;
  return (
    <Modal title={t('collaboration.documentTab')} close={() => {}} className="collaboration-panel">
      <DocumentWorkspace
        graph={current}
        snapshot={snapshot}
        controller={controller}
        selectedNodeId={current.nodes[0].id}
      />
    </Modal>
  );
}
await appLocaleController.start();
createRoot(document.getElementById('root')!).render(<Fixture />);
