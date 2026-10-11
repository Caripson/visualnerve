import { describe, expect, it } from 'vitest';
import { base, blankGraph, newEdge, newNode } from '../src/model/types';
import {
  appendSemanticActivity,
  collaborationFor,
  collaborationLimits,
  emptyCollaboration,
  defaultParticipantColor,
  participantProfilePalette,
  rasterDimensions,
  mutateCollaboration,
  remapCollaboration,
  retainCollaborationNodeTitles,
  summarizeGraphActivity,
  validateAvatarDataUrl,
  validateCollaboration,
  type ActivityEvent,
  type CollaborationAction,
  type CollaborationActionContext,
  type CollaborationDocument,
  type CollaborationGraph,
} from '../src/collaboration/model';

const now = '2026-10-11T12:00:00.000Z';
const later = '2026-10-11T13:00:00.000Z';
const owner: CollaborationActionContext = { role: 'owner', source: 'ui', now };
const identifier = (number: number) =>
  `11111111-1111-4111-8111-${number.toString(16).padStart(12, '0')}`;
function fixture() {
  let graph: CollaborationGraph = blankGraph('Collaboration test');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Review node' }),
    newNode(graph.diagram.id, { title: 'Next node' }),
  ];
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Alice', color: '#31766c' } },
    owner,
  );
  const alice = collaborationFor(graph).profiles[0].id;
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Bob' } },
    { ...owner, profileId: alice },
  );
  const bob = collaborationFor(graph).profiles[1].id;
  return {
    graph,
    alice,
    bob,
    actor: { ...owner, profileId: alice },
    editor: { ...owner, role: 'editor' as const, profileId: bob },
  };
}
const documentOf = (graph: CollaborationGraph) => graph.diagram.collaboration!;

it('leaves old documents unchanged until first use, with independent per-document public profiles', () => {
  const graph = blankGraph('Old document');
  expect(collaborationFor(graph)).toEqual(emptyCollaboration());
  expect(graph.diagram).not.toHaveProperty('collaboration');
  const { graph: active } = fixture();
  expect(documentOf(active).profiles).toHaveLength(2);
  expect(active.owners).toEqual([]);
  expect(documentOf(active).profiles[0]).not.toHaveProperty('deviceId');
});

it('assigns distinct palette colors before balancing reuse and preserves explicit color choices', () => {
  let graph = blankGraph('Palette');
  for (let index = 0; index < 10; index++) {
    graph = mutateCollaboration(
      graph,
      {
        type: 'profile.create',
        profile: { name: `Participant ${index + 1}`, ...(index === 1 ? { color: null } : {}) },
      },
      owner,
    );
  }
  expect(
    documentOf(graph)
      .profiles.slice(0, 8)
      .map((profile) => profile.color),
  ).toEqual(participantProfilePalette);
  expect(
    documentOf(graph)
      .profiles.slice(8)
      .map((profile) => profile.color),
  ).toEqual(participantProfilePalette.slice(0, 2));
  expect(defaultParticipantColor([{ color: '#2563EB' }])).toBe(participantProfilePalette[1]);
  graph = mutateCollaboration(
    graph,
    { type: 'profile.create', profile: { name: 'Custom', color: '#123456' } },
    owner,
  );
  expect(documentOf(graph).profiles.at(-1)?.color).toBe('#123456');
  graph = mutateCollaboration(
    graph,
    { type: 'profile.update', id: documentOf(graph).profiles[0].id, patch: { color: null } },
    owner,
  );
  expect(documentOf(graph).profiles[0]).not.toHaveProperty('color');
});

it('binds author IDs to the supplied actor context and does not mutate the input graph', () => {
  const { graph, alice, actor } = fixture();
  const before = structuredClone(graph);
  const changed = mutateCollaboration(
    graph,
    { type: 'comment.create', nodeId: graph.nodes[0].id, text: 'Review this.' },
    actor,
  );
  expect(graph).toEqual(before);
  expect(documentOf(changed).comments[0]).toMatchObject({
    authorId: alice,
    nodeTitle: 'Review node',
    resolved: false,
    messages: [{ authorId: alice, text: 'Review this.' }],
  });
  const forged = {
    type: 'comment.create',
    text: 'Fake author',
    authorId: crypto.randomUUID(),
  } as unknown as CollaborationAction;
  expect(() => mutateCollaboration(graph, forged, actor)).toThrow(
    'Unsupported collaboration action field',
  );
  expect(() =>
    mutateCollaboration(graph, { type: 'comment.create', text: 'Anonymous' }, owner),
  ).toThrow('Choose an acting participant');
});

it('rejects malformed or missing action UUID scalars before entity lookup', () => {
  const { graph, actor } = fixture();
  for (const action of [
    { type: 'profile.remove' },
    { type: 'profile.remove', id: null },
    { type: 'comment.create', text: 'Question', nodeId: null },
    { type: 'comment.edit', id: crypto.randomUUID(), text: 'Edit' },
    { type: 'comment.remove', id: crypto.randomUUID(), messageId: [] },
    { type: 'task.create', task: { title: 'Task', nodeId: false } },
  ])
    expect(() => mutateCollaboration(graph, action as never, actor)).toThrow('UUID');
});

it('requires owner provisioning and limits editor profile changes to their own display fields', () => {
  const { graph, alice, bob, editor } = fixture();
  expect(() =>
    mutateCollaboration(graph, { type: 'profile.create', profile: { name: 'Charlie' } }, editor),
  ).toThrow('Only the document owner');
  expect(() =>
    mutateCollaboration(
      graph,
      { type: 'profile.update', id: alice, patch: { name: 'Impersonation' } },
      editor,
    ),
  ).toThrow('only their own');
  const changed = mutateCollaboration(
    graph,
    { type: 'profile.update', id: bob, patch: { name: 'Robert', color: '#aabbcc' } },
    editor,
  );
  expect(documentOf(changed).profiles[1]).toMatchObject({
    id: bob,
    name: 'Robert',
    color: '#aabbcc',
  });
  expect(() =>
    mutateCollaboration(
      graph,
      { type: 'profile.update', id: bob, patch: { name: 'x'.repeat(81) } },
      editor,
    ),
  ).toThrow('80 characters');
  expect(() =>
    mutateCollaboration(
      graph,
      { type: 'profile.update', id: bob, patch: { color: 'red;url(evil)' } },
      editor,
    ),
  ).toThrow('hex color');
});

it('enforces own comment editing, preserves replies during moderation, and resolves author threads', () => {
  const { graph, alice, actor, editor } = fixture();
  let changed = mutateCollaboration(graph, { type: 'comment.create', text: 'Question' }, actor);
  const id = documentOf(changed).comments[0].id;
  const messageId = documentOf(changed).comments[0].messages[0].id;
  changed = mutateCollaboration(changed, { type: 'comment.reply', id, text: 'Answer' }, editor);
  expect(() =>
    mutateCollaboration(changed, { type: 'comment.edit', id, messageId, text: 'Forged' }, editor),
  ).toThrow('Only the comment author');
  expect(() =>
    mutateCollaboration(changed, { type: 'comment.remove', id }, { ...actor, role: 'editor' }),
  ).toThrow('containing other participants');
  expect(() =>
    mutateCollaboration(changed, { type: 'comment.resolve', id, resolved: true }, editor),
  ).toThrow('thread author or owner');
  changed = mutateCollaboration(
    changed,
    { type: 'comment.resolve', id, resolved: true },
    { ...actor, role: 'editor', now: later },
  );
  expect(documentOf(changed).comments[0]).toMatchObject({
    resolved: true,
    resolvedBy: alice,
    resolvedAt: later,
  });
  expect(() =>
    mutateCollaboration(changed, { type: 'comment.reply', id, text: 'Blocked' }, editor),
  ).toThrow('Reopen');
  changed = mutateCollaboration(changed, { type: 'comment.resolve', id, resolved: false }, actor);
  expect(documentOf(changed).comments[0]).not.toHaveProperty('resolvedBy');
  changed = mutateCollaboration(changed, { type: 'comment.remove', id, messageId }, actor);
  expect(documentOf(changed).comments[0].messages.map((message) => message.text)).toEqual([
    'Answer',
  ]);
  validateCollaboration(documentOf(changed));
});

it('prevents an owner from replacing another participant’s words while permitting moderation deletion', () => {
  const { graph, actor, editor } = fixture();
  const changed = mutateCollaboration(
    graph,
    { type: 'comment.create', text: 'Bob wrote this' },
    editor,
  );
  const thread = documentOf(changed).comments[0];
  expect(() =>
    mutateCollaboration(
      changed,
      {
        type: 'comment.edit',
        id: thread.id,
        messageId: thread.messages[0].id,
        text: 'Alice rewrite',
      },
      actor,
    ),
  ).toThrow('Only the comment author');
  expect(
    documentOf(mutateCollaboration(changed, { type: 'comment.remove', id: thread.id }, actor))
      .comments,
  ).toEqual([]);
});

it('validates task references and dates, supports explicit clearing, and leaves process owners independent', () => {
  const { graph, bob, actor, editor } = fixture();
  let changed = mutateCollaboration(
    graph,
    {
      type: 'task.create',
      task: {
        nodeId: graph.nodes[0].id,
        title: 'Check mapping',
        assigneeId: bob,
        dueDate: '2026-10-20',
      },
    },
    actor,
  );
  const id = documentOf(changed).tasks[0].id;
  expect(documentOf(changed).tasks[0]).toMatchObject({
    status: 'todo',
    nodeTitle: 'Review node',
    assigneeId: bob,
  });
  expect(() =>
    mutateCollaboration(
      changed,
      { type: 'task.update', id, patch: { dueDate: '2026-02-30' } },
      editor,
    ),
  ).toThrow('valid YYYY-MM-DD');
  expect(() =>
    mutateCollaboration(
      changed,
      { type: 'task.update', id, patch: { assigneeId: crypto.randomUUID() } },
      editor,
    ),
  ).toThrow('Unknown participant');
  expect(() =>
    mutateCollaboration(
      changed,
      { type: 'task.update', id, patch: { status: 'ready' } } as unknown as CollaborationAction,
      editor,
    ),
  ).toThrow('Unsupported collaboration task status');
  expect(() =>
    mutateCollaboration(
      changed,
      { type: 'task.create', task: { nodeId: crypto.randomUUID(), title: 'Missing node' } },
      actor,
    ),
  ).toThrow('Target node');
  changed = mutateCollaboration(
    changed,
    {
      type: 'task.update',
      id,
      patch: { status: 'in-progress', assigneeId: null, dueDate: null, description: null },
    },
    editor,
  );
  expect(documentOf(changed).tasks[0]).toMatchObject({ status: 'in-progress' });
  expect(documentOf(changed).tasks[0]).not.toHaveProperty('assigneeId');
  expect(documentOf(changed).tasks[0]).not.toHaveProperty('dueDate');
  expect(changed.nodes[0].ownerIds).toEqual([]);
});

it('rejects removing referenced profiles while allowing an unused provisioned profile to be removed', () => {
  const { graph, alice, bob, actor } = fixture();
  const changed = mutateCollaboration(
    graph,
    {
      type: 'task.create',
      task: { nodeId: graph.nodes[0].id, title: 'Assigned', assigneeId: bob },
    },
    actor,
  );
  expect(() => mutateCollaboration(changed, { type: 'profile.remove', id: bob }, actor)).toThrow(
    'referenced',
  );
  const unassigned = mutateCollaboration(
    changed,
    { type: 'task.update', id: documentOf(changed).tasks[0].id, patch: { assigneeId: null } },
    actor,
  );
  expect(
    documentOf(
      mutateCollaboration(unassigned, { type: 'profile.remove', id: bob }, actor),
    ).profiles.map((profile) => profile.id),
  ).toEqual([alice]);
  expect(() => mutateCollaboration(graph, { type: 'profile.remove', id: alice }, actor)).toThrow(
    'referenced',
  );
});

it('rejects every viewer mutation, including own profile changes and annotation deletion', () => {
  const { graph, bob, editor } = fixture();
  const actions: CollaborationAction[] = [
    { type: 'profile.create', profile: { name: 'x' } },
    { type: 'profile.update', id: bob, patch: { name: 'x' } },
    { type: 'profile.remove', id: bob },
    { type: 'comment.create', text: 'x' },
    { type: 'comment.reply', id: bob, text: 'x' },
    { type: 'comment.edit', id: bob, messageId: bob, text: 'x' },
    { type: 'comment.remove', id: bob },
    { type: 'comment.resolve', id: bob, resolved: true },
    { type: 'task.create', task: { nodeId: graph.nodes[0].id, title: 'x' } },
    { type: 'task.update', id: bob, patch: { title: 'x' } },
    { type: 'task.remove', id: bob },
  ];
  for (const action of actions)
    expect(() => mutateCollaboration(graph, action, { ...editor, role: 'viewer' })).toThrow(
      'Viewers cannot',
    );
});

it('preserves work and target title snapshots when a node is renamed then deleted', () => {
  const { graph, actor } = fixture();
  let changed = mutateCollaboration(
    graph,
    { type: 'comment.create', text: 'Question', nodeId: graph.nodes[0].id },
    actor,
  );
  changed = mutateCollaboration(
    changed,
    { type: 'task.create', task: { nodeId: graph.nodes[0].id, title: 'Do work' } },
    actor,
  );
  changed = retainCollaborationNodeTitles({
    ...changed,
    nodes: changed.nodes.map((node, index) => (index === 0 ? { ...node, title: 'Renamed' } : node)),
  });
  const orphaned = { ...changed, nodes: changed.nodes.slice(1) };
  validateCollaboration(documentOf(orphaned));
  expect(documentOf(orphaned).comments[0].nodeTitle).toBe('Renamed');
  expect(documentOf(orphaned).tasks[0].nodeTitle).toBe('Renamed');
  expect(
    documentOf(
      mutateCollaboration(
        orphaned,
        { type: 'task.update', id: documentOf(orphaned).tasks[0].id, patch: { status: 'done' } },
        actor,
      ),
    ).tasks[0].status,
  ).toBe('done');
});

it('keeps annotation IDs and profiles stable while remapping imported node and connection references', () => {
  const { graph, alice, actor } = fixture();
  let changed = mutateCollaboration(
    graph,
    { type: 'comment.create', text: 'Question', nodeId: graph.nodes[0].id },
    actor,
  );
  changed = mutateCollaboration(
    changed,
    { type: 'task.create', task: { nodeId: graph.nodes[0].id, title: 'Work', assigneeId: alice } },
    actor,
  );
  const destinationId = crypto.randomUUID();
  const original = structuredClone(documentOf(changed));
  const remapped = remapCollaboration(original, {
    nodeIds: new Map([[graph.nodes[0].id, destinationId]]),
  });
  expect(remapped.comments[0].nodeId).toBe(destinationId);
  expect(remapped.tasks[0].nodeId).toBe(destinationId);
  expect(remapped.activity.at(-1)?.nodeIds).toEqual([destinationId]);
  expect(remapped.profiles).toEqual(original.profiles);
  expect(remapped.comments[0].id).toBe(original.comments[0].id);
  expect(original).toEqual(documentOf(changed));
  const newAlice = crypto.randomUUID();
  const newBob = crypto.randomUUID();
  const profilesRemapped = remapCollaboration(original, {
    nodeIds: new Map(),
    profileIds: new Map([
      [alice, newAlice],
      [original.profiles[1].id, newBob],
    ]),
  });
  expect(profilesRemapped.comments[0].authorId).toBe(newAlice);
  expect(profilesRemapped.tasks[0].assigneeId).toBe(newAlice);
  expect(() =>
    remapCollaboration(original, { nodeIds: new Map(), profileIds: new Map([[alice, newAlice]]) }),
  ).toThrow('incomplete');
});

describe('bounded semantic activity', () => {
  it('ignores node 3D layout but still records title and other metadata changes', () => {
    const { graph, actor } = fixture();
    graph.nodes[0].metadata = {
      source: 'retained',
      spatial: { version: 1, position: { x: 1, y: 2, z: 3 } },
    };
    const moved = structuredClone(graph);
    moved.nodes[0].metadata.spatial = { version: 1, position: { x: 10, y: 20, z: 30 } };
    expect(summarizeGraphActivity(graph, moved)).toEqual([]);
    expect(appendSemanticActivity(graph, moved, actor)).toBe(moved);
    const titled = structuredClone(moved);
    titled.nodes[0].title = 'Content edited';
    const logged = appendSemanticActivity(moved, titled, actor);
    const events = documentOf(logged).activity.slice(documentOf(moved).activity.length);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'nodes.updated', nodeIds: [graph.nodes[0].id] });
    const metadata = structuredClone(moved);
    metadata.nodes[0].metadata.source = 'changed';
    expect(summarizeGraphActivity(moved, metadata)).toMatchObject([{ kind: 'nodes.updated' }]);
    const edge = newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id);
    const connected = { ...graph, edges: [edge] };
    const changedEdge = structuredClone(connected);
    changedEdge.edges[0].metadata.spatial = { label: 'still semantic' };
    expect(summarizeGraphActivity(connected, changedEdge)).toMatchObject([
      { kind: 'connections.updated' },
    ]);
    const assigned = structuredClone(graph);
    assigned.owners.push({
      ...base(),
      name: 'Responsibility owner',
      kind: 'person',
      color: '#123456',
      metadata: { spatial: { label: 'original owner metadata' } },
    });
    const changedOwner = structuredClone(assigned);
    changedOwner.owners[0].metadata.spatial = { label: 'still semantic' };
    expect(summarizeGraphActivity(assigned, changedOwner)).toMatchObject([
      { kind: 'owners.updated' },
    ]);
  });
  it('ignores camera, layout, object key order, versions and collaboration-only changes', () => {
    const { graph, actor } = fixture();
    const positioned = structuredClone(graph);
    positioned.diagram.version++;
    positioned.diagram.updatedAt = later;
    positioned.diagram.settings.viewport = { x: 10, y: 20, zoom: 2 };
    positioned.diagram.settings.grid = false;
    positioned.diagram.settings.entityOrder = { nodes: positioned.nodes.map((node) => node.id) };
    positioned.diagram.settings.csvDatasetOrder = [];
    positioned.nodes[0].x += 100;
    positioned.nodes[0].height += 100;
    positioned.nodes[0].collapsed = true;
    positioned.nodes[0].metadata = Object.fromEntries(
      Object.entries(positioned.nodes[0].metadata).reverse(),
    );
    expect(summarizeGraphActivity(graph, positioned)).toEqual([]);
    const comment = mutateCollaboration(
      graph,
      { type: 'comment.create', text: 'Only collaboration' },
      actor,
    );
    expect(summarizeGraphActivity(graph, comment)).toEqual([]);
    expect(appendSemanticActivity(graph, positioned, actor)).toBe(positioned);
  });

  it('summarizes each semantic collection with actor/source and writer clock, without session identity', () => {
    const { graph, alice, actor } = fixture();
    const changed = structuredClone(graph);
    changed.nodes[0].title = 'Edited';
    changed.nodes.push(newNode(graph.diagram.id, { title: 'Added' }));
    changed.edges.push(newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id));
    const logged = appendSemanticActivity(graph, changed, { ...actor, source: 'api', now: later });
    const events = documentOf(logged).activity.slice(documentOf(graph).activity.length);
    expect(events.map((event) => event.kind)).toEqual([
      'nodes.created',
      'nodes.updated',
      'connections.created',
    ]);
    expect(
      events.every(
        (event) => event.authorId === alice && event.source === 'api' && event.timestamp === later,
      ),
    ).toBe(true);
    expect(events.some((event) => 'deviceId' in event || 'credentialId' in event)).toBe(false);
    expect(() => appendSemanticActivity(graph, changed, { ...actor, role: 'viewer' })).toThrow(
      'Viewers cannot',
    );
    expect(documentOf(changed).activity).toEqual(documentOf(graph).activity);
  });

  it('retains the last 500 appended entries regardless of clock skew', () => {
    const { graph, actor } = fixture();
    const events: ActivityEvent[] = Array.from(
      { length: collaborationLimits.activity },
      (_, index) => ({
        id: identifier(index),
        sequence: index + 1,
        kind: 'diagram.updated',
        source: 'import',
        timestamp: later,
        summary: 'Imported change.',
      }),
    );
    graph.diagram.collaboration!.activity = events;
    const changed = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index ? node : { ...node, title: 'Newest append with earlier clock' },
      ),
    };
    const logged = appendSemanticActivity(graph, changed, {
      ...actor,
      now,
      createId: () => identifier(500),
    });
    expect(documentOf(logged).activity).toHaveLength(500);
    expect(documentOf(logged).activity[0].id).toBe(identifier(1));
    expect(documentOf(logged).activity.at(-1)).toMatchObject({
      id: identifier(500),
      timestamp: now,
    });
  });

  it('keeps history unchanged on no-op profile, task and resolution mutations', () => {
    const { graph, alice, actor } = fixture();
    expect(
      mutateCollaboration(
        graph,
        { type: 'profile.update', id: alice, patch: { name: 'Alice' } },
        actor,
      ),
    ).toBe(graph);
    const comment = mutateCollaboration(graph, { type: 'comment.create', text: 'Question' }, actor);
    expect(
      mutateCollaboration(
        comment,
        { type: 'comment.resolve', id: documentOf(comment).comments[0].id, resolved: false },
        actor,
      ),
    ).toBe(comment);
  });
});

describe('schema and raster boundary', () => {
  it.each(['deviceId', 'credentialId', 'privateKey', 'role', 'metadata'])(
    'rejects private or arbitrary profile field %s',
    (key) => {
      const { graph } = fixture();
      const document = structuredClone(documentOf(graph));
      Object.assign(document.profiles[0], { [key]: 'secret' });
      expect(() => validateCollaboration(document)).toThrow(
        'Unsupported participant profile field',
      );
    },
  );

  it('rejects malformed nested values, duplicate IDs, unresolved resolver fields and collection limits', () => {
    const { graph, actor } = fixture();
    const comment = mutateCollaboration(graph, { type: 'comment.create', text: 'Question' }, actor);
    for (const corrupt of [
      (document: CollaborationDocument) => {
        document.comments[0].messages = null as never;
      },
      (document: CollaborationDocument) => {
        document.comments[0].messages[0].text = 'x'.repeat(4001);
      },
      (document: CollaborationDocument) => {
        document.comments[0].resolvedBy = document.profiles[0].id;
      },
      (document: CollaborationDocument) => {
        document.profiles.push(structuredClone(document.profiles[0]));
      },
      (document: CollaborationDocument) => {
        document.activity[0].timestamp = '2030-02-30';
      },
      (document: CollaborationDocument) => {
        document.activity[0].nodeIds = Array.from({ length: 33 }, () => crypto.randomUUID());
      },
    ]) {
      const document = structuredClone(documentOf(comment));
      corrupt(document);
      expect(() => validateCollaboration(document)).toThrow();
    }
    const tooMany = emptyCollaboration();
    tooMany.profiles = Array.from({ length: 129 }, (_, index) => ({
      id: identifier(index),
      name: 'Person',
      createdAt: now,
      updatedAt: now,
    }));
    expect(() => validateCollaboration(tooMany)).toThrow('Too many');
  });

  it('accepts canonical small PNG avatars and rejects external, SVG, malformed, oversized and huge-dimension images', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
    expect(() => validateAvatarDataUrl(png)).not.toThrow();
    const bytes = Uint8Array.from(atob(png.split(',')[1]), (value) => value.charCodeAt(0));
    expect(rasterDimensions(bytes, 'png')).toEqual([1, 1]);
    const source = bytes.slice();
    const dimensions = new DataView(source.buffer);
    dimensions.setUint32(16, 16_384);
    dimensions.setUint32(20, 2_048);
    expect(rasterDimensions(source, 'png')).toEqual([16_384, 2_048]);
    expect(() =>
      validateAvatarDataUrl(`data:image/png;base64,${btoa(String.fromCharCode(...source))}`),
    ).toThrow();
    bytes[18] = 1;
    bytes[19] = 1;
    const oversizedDimensions = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    for (const bad of [
      'https://example.com/a.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png;base64,PHN2Zz48L3N2Zz4=',
      png.replace('base64,', 'base64, '),
      'data:image/png;base64,' + 'A'.repeat(90_000),
      oversizedDimensions,
    ])
      expect(() => validateAvatarDataUrl(bad)).toThrow('Avatar must');
  });

  it('bounds total messages and text across all comment threads', () => {
    const { graph, alice } = fixture();
    const document = structuredClone(documentOf(graph));
    document.comments = [
      {
        id: identifier(10_000),
        authorId: alice,
        resolved: false,
        createdAt: now,
        updatedAt: now,
        messages: Array.from({ length: 1001 }, (_, index) => ({
          id: identifier(20_000 + index),
          sequence: index + 1,
          authorId: alice,
          text: 'a'.repeat(4000),
          createdAt: now,
          updatedAt: now,
        })),
      },
    ];
    expect(() => validateCollaboration(document)).toThrow('combined document limit');
    document.comments[0].messages = Array.from({ length: 2001 }, (_, index) => ({
      id: identifier(20_000 + index),
      sequence: index + 1,
      authorId: alice,
      text: 'a',
      createdAt: now,
      updatedAt: now,
    }));
    expect(() => validateCollaboration(document)).toThrow();
  });

  it('bounds actual UTF-8 document bytes after individual fields and collections pass', () => {
    const { graph, alice } = fixture();
    const document = structuredClone(documentOf(graph));
    document.comments = [
      {
        id: identifier(10_000),
        authorId: alice,
        resolved: false,
        createdAt: now,
        updatedAt: now,
        messages: Array.from({ length: 1000 }, (_, index) => ({
          id: identifier(20_000 + index),
          sequence: index + 1,
          authorId: alice,
          text: '界'.repeat(4000),
          createdAt: now,
          updatedAt: now,
        })),
      },
    ];
    document.tasks = Array.from({ length: 1000 }, (_, index) => ({
      id: identifier(30_000 + index),
      nodeId: graph.nodes[0].id,
      title: 'Task',
      description: '界'.repeat(4000),
      authorId: alice,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    }));
    expect(() => validateCollaboration(document)).toThrow('16 MiB limit');
  });

  it('bounds combined decoded avatars at 2 MiB independently of per-image size', () => {
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
      ),
      (value) => value.charCodeAt(0),
    );
    const bytes = new Uint8Array(collaborationLimits.avatarBytes);
    const prefixLength = png.length - 12;
    bytes.set(png.subarray(0, prefixLength));
    const length = bytes.length - png.length - 12;
    new DataView(bytes.buffer).setUint32(prefixLength, length);
    bytes.set([116, 69, 88, 116], prefixLength + 4); // tEXt ancillary chunk
    bytes.fill(65, prefixLength + 8, prefixLength + 8 + length);
    bytes[prefixLength + 9] = 0; // keyword separator
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(prefixLength + 4, prefixLength + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    new DataView(bytes.buffer).setUint32(prefixLength + 8 + length, (crc ^ 0xffffffff) >>> 0);
    bytes.set(png.subarray(prefixLength), bytes.length - 12);
    const avatarDataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    expect(() => validateAvatarDataUrl(avatarDataUrl)).not.toThrow();
    const document = emptyCollaboration();
    document.profiles = Array.from({ length: 33 }, (_, index) => ({
      id: identifier(index),
      name: 'Person',
      avatarDataUrl,
      createdAt: now,
      updatedAt: now,
    }));
    expect(() => validateCollaboration(document)).toThrow('combined 2 MiB limit');
  });
});
