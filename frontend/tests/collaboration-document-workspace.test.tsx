import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import {
  mutateCollaboration,
  type CollaborationAction,
  type CollaborationActionContext,
} from '../src/collaboration/model';
import type { CollaborationSnapshot, CollaborationUiController } from '../src/collaboration/types';
import { DocumentWorkspace } from '../src/collaboration/ui/DocumentWorkspace';

function fixture(role: CollaborationActionContext['role'] = 'owner') {
  let graph = blankGraph('Document work');
  graph.nodes.push(newNode(graph.diagram.id));
  graph.nodes[0].title = 'Delivery node';
  const initial = {
    role: 'owner' as const,
    source: 'ui' as const,
    now: '2026-10-01T12:00:00.000Z',
  };
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Pat Lee', color: '#2563eb' } },
    initial,
  );
  const own = graph.diagram.collaboration!.profiles.find(
    (profile) => profile.name === 'Pat Lee',
  )!.id;
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Jamie', color: '#047857' } },
    { ...initial, profileId: own },
  );
  const context: CollaborationActionContext = { ...initial, role, profileId: own };
  const snapshot: CollaborationSnapshot = {
    configured: true,
    status: 'idle',
    displayName: 'Pat',
    participants: [],
    pendingJoins: [],
    scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
  };
  let update: (value: Graph) => void;
  const apply = vi.fn(async (_id: string, action: CollaborationAction, baseVersion: number) => {
    expect(baseVersion).toBe(graph.diagram.version);
    graph = mutateCollaboration(graph, action, context);
    graph = { ...graph, diagram: { ...graph.diagram, version: graph.diagram.version + 1 } };
    update(graph);
    return graph;
  });
  const controller: CollaborationUiController = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    create: vi.fn(),
    join: vi.fn(),
    createInvitation: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    changeRole: vi.fn(),
    remove: vi.fn(),
    reconnect: vi.fn(),
    leave: vi.fn(),
    closeRoom: vi.fn(),
    documentContext: () => context,
    selectDocumentProfile: vi.fn(async (_id, id) => {
      context.profileId = id;
    }),
    applyDocumentAction: apply,
  };
  function Harness() {
    const [current, setCurrent] = useState(graph);
    update = setCurrent;
    return (
      <DocumentWorkspace
        graph={current}
        snapshot={snapshot}
        controller={controller}
        selectedNodeId={current.nodes[0]?.id}
      />
    );
  }
  render(<Harness />);
  return {
    graph: () => graph,
    apply,
    controller,
    own,
    context,
    advance(action: CollaborationAction) {
      act(() => {
        graph = mutateCollaboration(graph, action, { ...context, role: 'owner' });
        graph = { ...graph, diagram: { ...graph.diagram, version: graph.diagram.version + 1 } };
        update(graph);
      });
    },
    removeNodes() {
      act(() => {
        graph = {
          ...graph,
          nodes: [],
          edges: [],
          diagram: { ...graph.diagram, version: graph.diagram.version + 1 },
        };
        update(graph);
      });
    },
    role(next: CollaborationActionContext['role']) {
      act(() => {
        context.role = next;
        update({ ...graph });
      });
    },
  };
}
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });

describe('versioned document workflow UI', () => {
  it('creates a text-safe profile, saves its color and selects its document identity separately from devices', async () => {
    const test = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    fill('Profile name', '<img src=x> Casey');
    fill('Color', '#ffffff');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('<img src=x> Casey', { selector: 'strong' });
    const created = test
      .graph()
      .diagram.collaboration!.profiles.find((profile) => profile.name === '<img src=x> Casey')!;
    expect(created.color).toBe('#ffffff');
    expect(document.querySelector('img')).toBeNull();
    fill('Acting document profile', created.id);
    await waitFor(() =>
      expect(test.controller.selectDocumentProfile).toHaveBeenCalledWith(
        test.graph().diagram.id,
        created.id,
      ),
    );
    expect(screen.getByText(/separate from room devices/)).toBeVisible();
  });

  it('creates, replies to, edits and resolves comments using current graph versions and own authorship', async () => {
    const test = fixture('editor');
    tab('Comments');
    fill('Comment text', 'Review this delivery.');
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await screen.findByText('Review this delivery.');
    expect(test.graph().diagram.collaboration!.comments[0].nodeId).toBe(test.graph().nodes[0].id);
    fill('Reply', 'Ready for review.');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await screen.findByText('Ready for review.');
    const message = screen.getByText('Review this delivery.').closest('.document-comment-message')!;
    fireEvent.click(within(message as HTMLElement).getByRole('button', { name: 'Edit' }));
    const editing = within(message as HTMLElement);
    fireEvent.change(editing.getByLabelText('Comment text'), {
      target: { value: 'Reviewed delivery.' },
    });
    fireEvent.click(editing.getByRole('button', { name: 'Save' }));
    await screen.findByText('Reviewed delivery.');
    fireEvent.click(screen.getByRole('button', { name: 'Resolve thread' }));
    await screen.findByText('Resolved');
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
    expect(test.apply.mock.calls.map(([, action]) => action.type)).toEqual([
      'comment.create',
      'comment.reply',
      'comment.edit',
      'comment.resolve',
    ]);
  });

  it('creates and updates node tasks with assignment, status and due date without changing node colors', async () => {
    const test = fixture('editor');
    const original = structuredClone(test.graph().nodes[0]);
    tab('Tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    fill('Task title', 'Ship delivery');
    fill('Assigned profile', test.own);
    fill('Status', 'in-progress');
    fill('Due date', '2026-12-01');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Ship delivery');
    expect(test.graph().diagram.collaboration!.tasks[0]).toMatchObject({
      nodeId: original.id,
      assigneeId: test.own,
      status: 'in-progress',
      dueDate: '2026-12-01',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fill('Status', 'done');
    fill('Assigned profile', '');
    fill('Due date', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Done');
    expect(test.graph().diagram.collaboration!.tasks[0].assigneeId).toBeUndefined();
    expect(test.graph().diagram.collaboration!.tasks[0].dueDate).toBeUndefined();
    expect(test.graph().nodes[0]).toEqual(original);
  });

  it('retains unsaved text on a stale-version failure and never sends duplicate in-flight actions', async () => {
    const test = fixture();
    tab('Comments');
    fill('Comment text', 'Keep this draft.');
    test.apply.mockRejectedValueOnce(new Error('Version conflict. Refresh and review.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Comment text')).toHaveValue('Keep this draft.');
    let release!: (value: Graph) => void;
    test.apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const form = screen.getByRole('button', { name: 'Add comment' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(test.apply).toHaveBeenCalledTimes(2);
    await act(async () => release(test.graph()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('allows status edits on a task after its linked node is removed, retaining the saved node title', async () => {
    const test = fixture('editor');
    tab('Tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    fill('Task title', 'Finish removed delivery');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Finish removed delivery');
    const nodeId = test.graph().nodes[0].id;
    test.removeNodes();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      screen.getByRole('option', { name: 'Delivery node · Node removed' }),
    ).toBeInTheDocument();
    fill('Status', 'done');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Done');
    expect(test.apply.mock.calls[1][1]).toMatchObject({
      type: 'task.update',
      patch: { status: 'done' },
    });
    expect((test.apply.mock.calls[1][1] as { patch: object }).patch).not.toHaveProperty('nodeId');
    expect(test.graph().diagram.collaboration!.tasks[0]).toMatchObject({
      nodeId,
      nodeTitle: 'Delivery node',
      status: 'done',
    });
  });

  it('keeps the edit draft version when a peer changes the document before saving', async () => {
    const test = fixture();
    const own = screen.getByText('Pat Lee', { selector: 'strong' }).closest('article')!;
    fireEvent.click(within(own).getByRole('button', { name: 'Edit' }));
    const baseVersion = test.graph().diagram.version;
    fill('Profile name', 'My unsaved profile');
    test.advance({ type: 'profile.update', id: test.own, patch: { name: 'Peer profile edit' } });
    test.apply.mockRejectedValueOnce(new Error('Version conflict. Review the newer profile.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(test.apply.mock.calls[0][2]).toBe(baseVersion);
    expect(test.graph().diagram.version).toBe(baseVersion + 1);
    expect(
      test.graph().diagram.collaboration!.profiles.find((profile) => profile.id === test.own)?.name,
    ).toBe('Peer profile edit');
    expect(screen.getByLabelText('Profile name')).toHaveValue('My unsaved profile');
  });

  it('removes write forms immediately when an editor becomes a viewer, while tabs and history stay readable', async () => {
    const test = fixture('editor');
    tab('Tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    fill('Task title', 'Unsaved draft');
    test.role('viewer');
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    for (const name of ['Profiles', 'Comments', 'Tasks', 'Activity']) {
      tab(name);
      expect(screen.getByText('You have read-only access to this document work.')).toBeVisible();
      expect(
        screen.queryByRole('button', {
          name: /Create profile|Create task|Add comment|Edit|Resolve thread/,
        }),
      ).not.toBeInTheDocument();
    }
    expect(screen.getByText(/this is not an audit log/)).toBeVisible();
    expect(test.apply).not.toHaveBeenCalled();
  });

  it('supports keyboard navigation among all four document tabs', () => {
    fixture();
    const profiles = screen.getByRole('tab', { name: 'Profiles' });
    profiles.focus();
    fireEvent.keyDown(profiles, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Comments' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus();
  });

  it('confirms cleanup of an unused profile, own comment and task before shared removal', async () => {
    const test = fixture();
    const profile = screen.getByText('Jamie', { selector: 'strong' }).closest('article')!;
    fireEvent.click(within(profile).getByRole('button', { name: 'Remove' }));
    expect(test.apply).not.toHaveBeenCalled();
    fireEvent.click(within(profile).getByRole('button', { name: 'Cancel' }));
    expect(
      test.graph().diagram.collaboration!.profiles.some((profile) => profile.name === 'Jamie'),
    ).toBe(true);
    fireEvent.click(within(profile).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(profile).getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() =>
      expect(screen.queryByText('Jamie', { selector: 'strong' })).not.toBeInTheDocument(),
    );
    tab('Comments');
    fill('Comment text', 'Mistaken comment');
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    const message = (await screen.findByText('Mistaken comment')).closest(
      '.document-comment-message',
    )!;
    fireEvent.click(within(message as HTMLElement).getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(message as HTMLElement).getByRole('button', { name: 'Confirm removal' }),
    );
    await waitFor(() => expect(test.graph().diagram.collaboration!.comments).toHaveLength(0));
    tab('Tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    fill('Task title', 'Mistaken task');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Mistaken task');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() => expect(test.graph().diagram.collaboration!.tasks).toHaveLength(0));
    expect(test.apply.mock.calls.map(([, action]) => action.type)).toEqual([
      'profile.remove',
      'comment.create',
      'comment.remove',
      'task.create',
      'task.remove',
    ]);
  });
});
