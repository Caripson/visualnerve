import { projectCanonicalOverview } from '../overview/projection';
import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { askDiagram } from '../questions/client';
import { diagramSourceEvidence } from '../questions/source';
import { buildLovablePrompt, type LovableScope } from '../export/lovable';
import { getBuildSpecification, setBuildSpecification } from '../export/build-specification';
import { getOverviewConfig, setOverviewConfig } from '../overview/types';
import { getStoryboard, setStoryboard } from '../presentation/storyboard';
import type { HistoryStore } from '../history/store';

export interface UnderstandingRepository {
  getGraph(id: string): Promise<Graph>;
  saveGraph(graph: Graph, baseVersion: number): Promise<Graph>;
  history: HistoryStore;
}
export const understandingActions = [
  'overview',
  'questions',
  'evidence',
  'build-specification',
  'build-brief',
  'storyboard',
  'history',
];
const object = (value: unknown, keys: string[]) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new StorageError(422, `Expected an object containing only ${keys.join(', ')}.`);
  return value as Record<string, unknown>;
};
const version = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new StorageError(422, 'Provide the current baseVersion.');
  return value as number;
};
export async function understandingCommand(
  repo: UnderstandingRepository,
  id: string,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  beforeHistoryWrite?: () => Promise<void>,
): Promise<unknown> {
  const action = parts[2];
  if (action === 'history')
    return historyCommand(repo, id, parts, url, method, payload, beforeHistoryWrite);
  if (
    parts.length !== 3 &&
    !(action === 'overview' && parts.length === 4 && parts[3] === 'projection')
  )
    throw new StorageError(404, 'Unknown understanding endpoint.');
  const graph = await repo.getGraph(id);
  if (action === 'overview') {
    if (parts.length === 4) {
      if (method !== 'GET') throw new StorageError(405, 'Overview projection requires GET.');
      if (
        [...url.searchParams.keys()].some((key) => key !== 'zoom') ||
        url.searchParams.getAll('zoom').length > 1
      )
        throw new StorageError(422, 'Overview projection accepts only an optional zoom.');
      return projectCanonicalOverview(graph, { zoom: Number(url.searchParams.get('zoom') ?? 0.1) });
    }
    if (method === 'GET') return getOverviewConfig(graph);
    if (method !== 'PUT') throw new StorageError(405, 'Use GET or PUT for semantic overview.');
    const data = object(payload, ['baseVersion', 'overview']);
    return repo.saveGraph(
      setOverviewConfig(graph, data.overview as ReturnType<typeof getOverviewConfig>),
      version(data.baseVersion),
    );
  }
  if (action === 'questions') {
    if (method !== 'POST')
      throw new StorageError(405, 'Questions require POST and do not save data.');
    return askDiagram(graph, payload);
  }
  if (action === 'evidence') {
    if (method !== 'GET') throw new StorageError(405, 'Source evidence requires GET.');
    return diagramSourceEvidence(graph, url.searchParams);
  }
  if (action === 'build-brief') {
    if (method !== 'POST') throw new StorageError(405, 'Build brief preview requires POST.');
    const data = object(payload, ['scope', 'selectedIds', 'instructions']);
    const scope = (data.scope ?? 'diagram') as LovableScope;
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    if (
      !['diagram', 'selected', 'csv-view'].includes(scope) ||
      (data.instructions !== undefined &&
        (typeof data.instructions !== 'string' || data.instructions.length > 30_000)) ||
      (data.selectedIds !== undefined &&
        (!Array.isArray(data.selectedIds) ||
          data.selectedIds.length > 20_000 ||
          data.selectedIds.some((nodeId) => typeof nodeId !== 'string' || !nodeIds.has(nodeId))))
    )
      throw new StorageError(
        422,
        'Choose a build scope, existing selected IDs and optional instructions of at most 30,000 characters.',
      );
    if (scope === 'selected' && (!Array.isArray(data.selectedIds) || !data.selectedIds.length))
      throw new StorageError(422, 'Selected scope requires at least one existing object.');
    return buildLovablePrompt(graph, String(data.instructions ?? ''), {
      scope,
      selectedIds: data.selectedIds as string[] | undefined,
    });
  }
  if (action === 'build-specification') {
    if (method === 'GET') return getBuildSpecification(graph);
    if (method !== 'PUT') throw new StorageError(405, 'Use GET or PUT for an app specification.');
    const data = object(payload, ['baseVersion', 'specification']);
    return repo.saveGraph(
      setBuildSpecification(graph, data.specification),
      version(data.baseVersion),
    );
  }
  if (action === 'storyboard') {
    if (method === 'GET') return getStoryboard(graph);
    if (method !== 'PUT') throw new StorageError(405, 'Use GET or PUT for a storyboard.');
    const data = object(payload, ['baseVersion', 'storyboard']);
    return repo.saveGraph(
      setStoryboard(graph, data.storyboard as ReturnType<typeof getStoryboard>),
      version(data.baseVersion),
    );
  }
  throw new StorageError(404, 'Unknown understanding endpoint.');
}
async function historyCommand(
  repo: UnderstandingRepository,
  id: string,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  beforeWrite?: () => Promise<void>,
) {
  if (parts.length === 3) {
    if (method === 'GET') return repo.history.list(id);
    if (method !== 'POST') throw new StorageError(405, 'Use GET or POST for diagram history.');
    const data = object(payload, ['baseVersion', 'name']);
    return repo.history.create(id, {
      baseVersion: version(data.baseVersion),
      name: data.name as string,
      beforeWrite,
    });
  }
  if (parts.length === 4) {
    if (method === 'GET') return repo.history.read(id, parts[3]);
    if (method === 'DELETE') return repo.history.remove(id, parts[3]);
  }
  if (parts.length === 5 && parts[4] === 'compare' && method === 'GET') {
    if (
      [...url.searchParams.keys()].some((key) => key !== 'to') ||
      url.searchParams.getAll('to').length > 1
    )
      throw new StorageError(422, 'Comparison accepts only an optional to snapshot ID or current.');
    return repo.history.compare(id, parts[3], url.searchParams.get('to') ?? 'current');
  }
  if (parts.length === 5 && parts[4] === 'restore' && method === 'POST') {
    const data = object(payload, ['baseVersion']);
    return repo.history.restore(id, parts[3], {
      baseVersion: version(data.baseVersion),
      beforeWrite,
    });
  }
  throw new StorageError(404, 'Unknown history endpoint.');
}
