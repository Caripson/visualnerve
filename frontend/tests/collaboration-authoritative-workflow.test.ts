import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { mutateCollaboration, collaborationFor } from '../src/collaboration/model';
import { CollaborationWorkflow } from '../src/collaboration/session/workflow';
import { CollaborativeDocument } from '../src/collaboration/document/document';
import { encodeCollaborationUpdate } from '../src/collaboration/document/update-envelope';
import type { RoomMember } from '../../collaboration-worker/src/protocol';
const encoder = new TextEncoder();
const instances: CollaborationWorkflow[] = [];
afterEach(() => {
  instances.forEach((instance) => instance.dispose());
  instances.length = 0;
  vi.useRealTimers();
});
function fixture() {
  let graph = blankGraph('Owner-authoritative workflow');
  graph.nodes.push(newNode(graph.diagram.id));
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Owner' } },
    { role: 'owner', source: 'ui' },
  );
  const ownerId = graph.diagram.collaboration!.profiles[0].id;
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Editor' } },
    { role: 'owner', profileId: ownerId, source: 'ui' },
  );
  const editorId = graph.diagram.collaboration!.profiles[1].id;
  const send = vi.fn(async (_kind: string, bytes: Uint8Array, _recipient?: string) => {
    responses.push(JSON.parse(new TextDecoder().decode(bytes)));
  });
  const responses: Array<{ error?: { status: number } }> = [];
  const member = { deviceId: 'editor-device', role: 'editor' } as RoomMember;
  let afterPrepare = async () => {};
  let workflow!: CollaborationWorkflow;
  workflow = new CollaborationWorkflow({
    diagramId: graph.diagram.id,
    check: () => {},
    owner: () => true,
    context: (sender) => ({
      role: sender?.role ?? 'owner',
      profileId: sender ? editorId : ownerId,
      source: 'collaboration',
    }),
    activeProfileIds: () => [ownerId, editorId],
    read: async () => graph,
    commit: async (change, authorize) => {
      const before = graph;
      const prepared = change(graph);
      await afterPrepare();
      authorize?.();
      graph = prepared;
      workflow.changed(before, graph);
      return graph;
    },
    send,
    failure: (error) => {
      throw error;
    },
  });
  instances.push(workflow);
  const request = async (
    action: unknown,
    id = crypto.randomUUID(),
    revision = workflow.checkpoint(graph).revision,
  ) => {
    await workflow.receiveRequest(
      encoder.encode(JSON.stringify({ version: 1, id, revision, action })),
      member,
    );
    await Promise.resolve();
    await Promise.resolve();
    return id;
  };
  return {
    graph: () => graph,
    set: (next: Graph) => {
      graph = next;
    },
    workflow,
    request,
    member,
    ownerId,
    editorId,
    send,
    responses,
    afterPrepare: (callback: () => Promise<void>) => {
      afterPrepare = callback;
    },
  };
}
describe('owner-authoritative protected document work', () => {
  it('rechecks an editor permission after asynchronous preparation before protected state commits', async () => {
    const f = fixture();
    const before = structuredClone(f.graph());
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.afterPrepare(async () => {
      entered();
      await barrier;
    });
    const request = f.request({ type: 'comment.create', text: 'Permission changed while pending' });
    await started;
    f.member.role = 'viewer';
    release();
    await request;
    expect(f.graph()).toEqual(before);
    expect(f.responses.some((value) => value.error?.status === 403)).toBe(true);
  });

  it('derives comment author and task creator from the authenticated device, never the request', async () => {
    const f = fixture();
    await f.request({ type: 'comment.create', text: 'Actual editor comment' });
    expect(f.graph().diagram.collaboration!.comments[0].authorId).toBe(f.editorId);
    await f.request({
      type: 'task.create',
      task: { nodeId: f.graph().nodes[0].id, title: 'Review' },
    });
    expect(f.graph().diagram.collaboration!.tasks[0].authorId).toBe(f.editorId);
    const before = structuredClone(f.graph());
    await f.request({ type: 'comment.create', text: 'Forged', authorId: f.ownerId });
    expect(f.graph()).toEqual(before);
  });
  it('rejects editing another profile, comment text, or thread resolution while preserving the accepted graph', async () => {
    const f = fixture();
    const authored = mutateCollaboration(
      f.graph(),
      { type: 'comment.create', text: 'Owner evidence' },
      { role: 'owner', profileId: f.ownerId, source: 'ui' },
    );
    f.set(authored);
    const thread = authored.diagram.collaboration!.comments[0];
    for (const action of [
      { type: 'profile.update', id: f.ownerId, patch: { name: 'Forged owner' } },
      {
        type: 'comment.edit',
        id: thread.id,
        messageId: thread.messages[0].id,
        text: 'Forged text',
      },
      { type: 'comment.resolve', id: thread.id, resolved: true },
    ]) {
      await f.request(action);
      expect(f.graph()).toEqual(authored);
    }
    const errors = f.responses.filter((value) => value.error);
    expect(errors).toHaveLength(3);
    expect(errors.every((value) => value.error?.status === 403)).toBe(true);
  });
  it('deduplicates one request and rejects stale workflow revisions', async () => {
    const f = fixture();
    const id = await f.request({ type: 'comment.create', text: 'Once' });
    await f.request({ type: 'comment.create', text: 'Once' }, id, 0);
    expect(f.graph().diagram.collaboration!.comments).toHaveLength(1);
    const before = structuredClone(f.graph());
    await f.request({ type: 'comment.create', text: 'Stale' }, crypto.randomUUID(), 0);
    expect(f.graph()).toEqual(before);
  });
  it('does not accept owner checkpoints from an editor or actor fields inside raw CRDT updates', async () => {
    const f = fixture();
    await expect(
      f.workflow.receiveState(
        encoder.encode(JSON.stringify({ version: 1, ...f.workflow.checkpoint(f.graph()) })),
        f.member,
      ),
    ).rejects.toThrow('authenticated owner');
    const document = new CollaborativeDocument(f.graph(), undefined, undefined, true);
    const raw = new Y.Doc();
    Y.applyUpdate(raw, document.encodedState());
    const base = document.stateVector();
    raw
      .getMap('fields')
      .set('["diagram","collaboration","profiles","forged","name"]', ['value', 'Forged']);
    await expect(async () =>
      document.prepareRemote(
        encodeCollaborationUpdate(base, Y.encodeStateAsUpdate(raw, base)),
        f.graph(),
      ),
    ).rejects.toThrow('private field');
    expect(document.graph(f.graph()).diagram.collaboration).toEqual(
      f.graph().diagram.collaboration,
    );
    raw.destroy();
    document.destroy();
  });
  it('keeps the protected namespace out of normal deltas and requires the version-2 CRDT contract', () => {
    const f = fixture();
    const document = new CollaborativeDocument(f.graph(), undefined, undefined, true);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, document.encodedState());
    expect(decoded.getMap('contract').get('workflowAuthority')).toBe('owner');
    expect([...decoded.getMap('fields').keys()].some((key) => key.includes('collaboration'))).toBe(
      false,
    );
    expect(
      () => new CollaborativeDocument(f.graph(), document.scope, document.encodedState()),
    ).toThrow('sharing scope');
    document.destroy();
    decoded.destroy();
  });
  it('reports unknown outcome on missing owner acknowledgement without retrying or optimistic writes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const send = vi.fn(async () => {});
    const before = structuredClone(f.graph());
    const editor = new CollaborationWorkflow({
      diagramId: before.diagram.id,
      check: () => {},
      owner: () => false,
      context: () => ({ role: 'editor', profileId: f.editorId, source: 'ui' }),
      activeProfileIds: () => [],
      read: async () => before,
      commit: async () => {
        throw new Error('Must await owner');
      },
      send,
      failure: () => {},
    });
    instances.push(editor);
    const pending = editor.action(
      { type: 'comment.create', text: 'Pending' },
      { role: 'editor', profileId: f.editorId, source: 'ui' },
      async () => {},
    );
    const assertion = expect(pending).rejects.toThrow('outcome is unknown');
    await vi.advanceTimersByTimeAsync(25_001);
    await assertion;
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.graph()).toEqual(before);
  });
});
