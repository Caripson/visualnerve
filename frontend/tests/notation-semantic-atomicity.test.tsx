import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotationNodeProperties } from '../src/notation/Controls';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

let db: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`notation-atomicity-${crypto.randomUUID()}`);
  await db.initialize();
  repo = new Repository(db);
});
afterEach(async () => {
  cleanup();
  await db.delete();
});

it('rejects removing or reversing an occupied custom port equally in Properties and API', async () => {
  const source = blankGraph('Occupied port');
  source.nodes = [
    newNode(source.diagram.id, {
      title: 'Source',
      notation: {
        collection: 'uml',
        symbol: 'class',
        ports: [{ id: 'output', side: 'right', direction: 'out', offset: 0.75 }],
      },
    }),
    newNode(source.diagram.id, {
      title: 'Target',
      notation: { collection: 'uml', symbol: 'object' },
    }),
  ];
  source.edges = [
    newEdge(source.diagram.id, source.nodes[0].id, source.nodes[1].id, {
      notation: { collection: 'uml', symbol: 'association', sourcePort: 'output' },
    }),
  ];
  const graph = await repo.saveGraph(source, 0),
    node = graph.nodes[0],
    update = vi.fn();
  render(<NotationNodeProperties graph={graph} node={node} update={update} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove port' }));
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('port');
  fireEvent.change(screen.getByLabelText('Port 1 direction'), { target: { value: 'in' } });
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('direction');
  for (const ports of [[], [{ id: 'output', side: 'right', direction: 'in' }]]) {
    await expect(
      repo.request(`/nodes/${node.id}`, 'PATCH', {
        version: node.version,
        notation: { ...node.notation, ports },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_NOTATION' });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  }
  const field = screen.getByLabelText('Port 1 position');
  fireEvent.change(field, { target: { value: '0.25' } });
  fireEvent.blur(field);
  const patch = update.mock.calls.at(-1)![0];
  expect(patch.notation.ports[0].offset).toBe(0.25);
  const changed = await repo.request(`/nodes/${node.id}`, 'PATCH', {
    ...patch,
    version: node.version,
  });
  expect(changed).toMatchObject({ notation: patch.notation });
  validateGraph(await repo.getGraph(graph.diagram.id));
});

it('rejects changing an attached BPMN activity into a gateway equally in Properties and API', async () => {
  const source = blankGraph('Attached boundary event');
  const task = newNode(source.diagram.id, {
    title: 'Approve',
    notation: { collection: 'bpmn', symbol: 'task' },
  });
  source.nodes = [
    task,
    newNode(source.diagram.id, {
      title: 'Timeout',
      notation: {
        collection: 'bpmn',
        symbol: 'boundary-event',
        attachmentId: task.id,
        properties: { eventDefinition: 'timer' },
      },
    }),
  ];
  const graph = await repo.saveGraph(source, 0),
    node = graph.nodes[0],
    update = vi.fn();
  render(<NotationNodeProperties graph={graph} node={node} update={update} />);
  fireEvent.change(screen.getByLabelText('Notation symbol'), {
    target: { value: 'exclusive-gateway' },
  });
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('attachmentId');
  await expect(
    repo.request(`/nodes/${node.id}`, 'PATCH', {
      version: node.version,
      notation: { collection: 'bpmn', symbol: 'exclusive-gateway' },
    }),
  ).rejects.toMatchObject({ status: 422, code: 'INVALID_NOTATION' });
  expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
});
