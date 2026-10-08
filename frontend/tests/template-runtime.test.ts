import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTemplateDiagram } from '../src/templates/create';
import { workspaceStorage } from '../src/storage/runtime';
import { workspace } from '../src/storage/workspace';
import { blankGraph, newNode } from '../src/model/types';

vi.mock('../src/storage/runtime', () => ({
  workspaceStorage: { templates: { get: vi.fn() } },
}));
vi.mock('../src/storage/workspace', () => ({ workspace: { create: vi.fn() } }));
vi.mock('../src/storage/database', () => {
  throw new Error('Template creation must not import the legacy private database.');
});

beforeEach(() => {
  vi.mocked(workspaceStorage.templates.get).mockReset().mockResolvedValue(undefined);
  vi.mocked(workspace.create).mockReset().mockResolvedValue(undefined);
});

describe('template creation through the selected workspace backend', () => {
  it('loads a private custom template from the authoritative backend and preserves its source', async () => {
    const graph = blankGraph('Stored custom process');
    const node = newNode(graph.diagram.id, { title: 'Private custom step' });
    graph.nodes.push(node);
    const original = structuredClone(graph);
    vi.mocked(workspaceStorage.templates.get).mockResolvedValue({
      id: 'custom-process',
      name: 'Custom process',
      builtin: false,
      graph,
    });
    await createTemplateDiagram('custom-process', '  New private process  ');
    expect(workspaceStorage.templates.get).toHaveBeenCalledWith('custom-process');
    expect(workspace.create).toHaveBeenCalledOnce();
    const created = vi.mocked(workspace.create).mock.calls[0][0];
    expect(created.diagram.name).toBe('New private process');
    expect(created.diagram.id).not.toBe(graph.diagram.id);
    expect(created.nodes).toHaveLength(1);
    expect(created.nodes[0]).toMatchObject({
      title: 'Private custom step',
      diagramId: created.diagram.id,
    });
    expect(created.nodes[0].id).not.toBe(node.id);
    expect(graph).toEqual(original);
  });

  it('uses built-in templates when the selected backend has no saved override', async () => {
    await createTemplateDiagram('process-simulator-blank', 'My process');
    expect(workspaceStorage.templates.get).toHaveBeenCalledWith('process-simulator-blank');
    expect(workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        diagram: expect.objectContaining({ name: 'My process', type: 'process-simulator' }),
        simulation: expect.objectContaining({ schemaVersion: 1, nodes: [], edges: [] }),
      }),
    );
  });

  it('fails closed when the private backend cannot be read rather than opening a legacy template', async () => {
    vi.mocked(workspaceStorage.templates.get).mockRejectedValue(new Error('Workspace is locked.'));
    await expect(createTemplateDiagram('mind-map', 'Private topic')).rejects.toThrow(
      'Workspace is locked.',
    );
    expect(workspace.create).not.toHaveBeenCalled();
  });
});
