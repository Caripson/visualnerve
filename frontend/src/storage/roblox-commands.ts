import type { Graph } from '../model/types';
import type { GameDefinition } from '../roblox/types';
import { RobloxError } from '../roblox/errors';
import { setGameDefinition } from '../roblox/document';
import { validateGameDefinition } from '../roblox/validate';
import { gameCollections, type GameCollection } from '../roblox/references';
import { robloxBuildLimits } from '../roblox/build-service';
import type { AnalyticsCommandOptions, AnalyticsRepository } from './analytics-commands';
import { robloxApiJobs, type RobloxApiJobs } from './roblox-api-jobs';
import {
  boundedGameResponse,
  gameObject,
  gameQuery,
  gameVersion,
  gameInteger,
  mergeGameValue,
} from './roblox-api-input';

async function guard(options: AnalyticsCommandOptions) {
  options.signal?.throwIfAborted();
  await options.authorize?.();
  options.signal?.throwIfAborted();
}
function model(graph: Graph) {
  if (!graph.diagram.game)
    throw new RobloxError(
      422,
      'This diagram has no Roblox Game Builder model.',
      'ROBLOX_DOCUMENT_REQUIRED',
    );
  return graph.diagram.game;
}
function currentVersion(graph: Graph, value: unknown) {
  const version = gameVersion(value);
  if (version !== graph.diagram.version)
    throw new RobloxError(
      409,
      'The game changed. Read its current baseVersion before editing or building.',
      'VERSION_CONFLICT',
    );
  return version;
}
/** UI, REST and MCP edit the same canonical game. Publication is intentionally absent. */
export async function robloxCommand(
  repo: AnalyticsRepository,
  diagramId: string,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  options: AnalyticsCommandOptions = {},
  jobs: RobloxApiJobs = robloxApiJobs,
): Promise<unknown> {
  try {
    const value = await dispatch(repo, diagramId, parts, url, method, payload, options, jobs);
    await guard(options);
    return boundedGameResponse(value);
  } catch (error) {
    await guard(options);
    throw error;
  }
}
async function dispatch(
  repo: AnalyticsRepository,
  diagramId: string,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  options: AnalyticsCommandOptions,
  jobs: RobloxApiJobs,
): Promise<unknown> {
  await guard(options);
  const graph = await repo.getGraph(diagramId);
  const game = model(graph);
  const action = parts[3];
  const save = async (next: GameDefinition, value: unknown) => {
    const version = currentVersion(graph, value);
    const nextGraph = setGameDefinition(graph, next);
    await guard(options);
    const saved = await repo.saveGraph(nextGraph, version, options.beforeWrite);
    return {
      diagramId,
      baseVersion: saved.diagram.version,
      summary: Object.fromEntries(
        gameCollections.map((key) => [key, saved.diagram.game![key].length]),
      ),
    };
  };
  if (parts.length === 3) {
    gameQuery(url);
    if (method === 'GET') return { diagramId, baseVersion: graph.diagram.version, game };
    if (method !== 'PUT')
      throw new RobloxError(
        405,
        'Use GET or PUT for the complete game model.',
        'ROBLOX_METHOD_NOT_ALLOWED',
      );
    const data = gameObject(payload, ['baseVersion', 'game']);
    return save(data.game as GameDefinition, data.baseVersion);
  }
  if (action === 'configuration' && parts.length === 4) {
    gameQuery(url);
    if (method === 'GET') {
      const { schemaVersion, id, name, description, settings } = game;
      return {
        diagramId,
        baseVersion: graph.diagram.version,
        configuration: { schemaVersion, id, name, description, settings },
      };
    }
    if (method === 'PATCH') {
      const data = gameObject(payload, ['baseVersion', 'value']);
      currentVersion(graph, data.baseVersion);
      const patch = gameObject(data.value, ['name', 'description', 'settings']);
      const settings =
        patch.settings === undefined
          ? game.settings
          : { ...game.settings, ...gameObject(patch.settings, Object.keys(game.settings)) };
      return save({ ...game, ...patch, settings } as GameDefinition, data.baseVersion);
    }
    throw new RobloxError(
      405,
      'Use GET or PATCH for game configuration.',
      'ROBLOX_METHOD_NOT_ALLOWED',
    );
  }
  if (action === 'validate' && parts.length === 4) {
    gameQuery(url);
    if (method !== 'POST')
      throw new RobloxError(405, 'Game validation requires POST.', 'ROBLOX_METHOD_NOT_ALLOWED');
    const data = gameObject(payload === undefined ? {} : payload, ['game']);
    return {
      diagramId,
      baseVersion: graph.diagram.version,
      ...validateGameDefinition(Object.hasOwn(data, 'game') ? data.game : game, { playable: true }),
    };
  }
  if (action === 'preview' && parts.length === 4) {
    gameQuery(url);
    if (method !== 'POST')
      throw new RobloxError(405, 'Rule preview requires POST.', 'ROBLOX_METHOD_NOT_ALLOWED');
    const data = gameObject(payload, ['steps', 'history']);
    if (data.history !== undefined && typeof data.history !== 'boolean')
      throw new RobloxError(422, 'history must be true or false.', 'ROBLOX_INVALID_REQUEST');
    const { executeRobloxPreview } = await import('../roblox/preview-service');
    const { validateRobloxPreviewSteps } = await import('../roblox/preview');
    await guard(options);
    if (!options.createAuthority)
      throw new RobloxError(
        403,
        'A rule preview requires its originating workspace authority.',
        'ROBLOX_AUTHORITY_REQUIRED',
      );
    const authority = await options.createAuthority();
    try {
      const value = await executeRobloxPreview(game, validateRobloxPreviewSteps(game, data.steps), {
        guard: authority.guard,
        signal: options.signal,
        history: data.history as boolean | undefined,
      });
      await guard(options);
      return { diagramId, baseVersion: graph.diagram.version, ...value };
    } finally {
      authority.dispose();
    }
  }
  if (action === 'builds') {
    const jobId = parts[4],
      sub = parts[5];
    if (parts.length === 4) {
      gameQuery(url);
      if (method !== 'POST')
        throw new RobloxError(405, 'Start a build with POST.', 'ROBLOX_METHOD_NOT_ALLOWED');
      const data = gameObject(payload, ['baseVersion']);
      const version = currentVersion(graph, data.baseVersion);
      if (!options.createAuthority)
        throw new RobloxError(
          403,
          'A build requires its originating workspace authority.',
          'ROBLOX_AUTHORITY_REQUIRED',
        );
      const authority = await options.createAuthority();
      try {
        await guard(options);
        return await jobs.start(diagramId, version, game, authority);
      } catch (error) {
        authority.dispose();
        throw error;
      }
    }
    if (!jobId || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(jobId))
      throw new RobloxError(422, 'Provide the build job UUID.', 'ROBLOX_INVALID_REQUEST');
    const authorize = () => guard(options);
    if (parts.length === 5) {
      gameQuery(url);
      if (method === 'GET') return jobs.status(diagramId, jobId, authorize);
      if (method === 'DELETE') {
        gameObject(payload === undefined ? {} : payload, []);
        return jobs.cancel(diagramId, jobId, authorize);
      }
    }
    if (method === 'GET' && parts.length === 6 && sub === 'result') {
      gameQuery(url);
      return jobs.result(diagramId, jobId, authorize);
    }
    if (method === 'GET' && parts.length === 6 && sub === 'artifacts') {
      gameQuery(url);
      return { jobId, artifacts: (await jobs.result(diagramId, jobId, authorize)).artifacts };
    }
    if (method === 'GET' && parts.length === 7 && sub === 'artifacts') {
      gameQuery(url, ['offset', 'limit']);
      return jobs.artifact(
        diagramId,
        jobId,
        decodeURIComponent(parts[6]),
        gameInteger(url.searchParams.get('offset'), 0, 0, robloxBuildLimits.bytes),
        gameInteger(
          url.searchParams.get('limit'),
          robloxBuildLimits.chunkBytes,
          1,
          robloxBuildLimits.chunkBytes,
        ),
        authorize,
      );
    }
    throw new RobloxError(404, 'Unknown Roblox build endpoint.', 'ROBLOX_ENDPOINT_NOT_FOUND');
  }
  if (
    gameCollections.includes(action as GameCollection) &&
    (parts.length === 4 || parts.length === 5)
  ) {
    const collection = action as GameCollection;
    const id = parts[4];
    const values = game[collection];
    if (method === 'GET') {
      if (id) {
        gameQuery(url);
        const value = values.find((value) => value.id === id);
        if (!value)
          throw new RobloxError(404, 'This game object was not found.', 'ROBLOX_OBJECT_NOT_FOUND');
        return { diagramId, baseVersion: graph.diagram.version, value };
      }
      gameQuery(url, ['offset', 'limit']);
      const offset = gameInteger(url.searchParams.get('offset'), 0, 0, 1000);
      const limit = gameInteger(url.searchParams.get('limit'), 100, 1, 200);
      return {
        diagramId,
        baseVersion: graph.diagram.version,
        total: values.length,
        offset,
        nextOffset: offset + limit < values.length ? offset + limit : null,
        items: values.slice(offset, offset + limit),
      };
    }
    gameQuery(url);
    const next = structuredClone(game);
    const nextValues = next[collection] as Array<GameDefinition[GameCollection][number]>;
    if (method === 'DELETE' && id) {
      const data = gameObject(payload, ['baseVersion']);
      if (!values.some((value) => value.id === id))
        throw new RobloxError(404, 'This game object was not found.', 'ROBLOX_OBJECT_NOT_FOUND');
      nextValues.splice(
        nextValues.findIndex((value) => value.id === id),
        1,
      );
      await save(next, data.baseVersion);
      return undefined;
    }
    if ((method === 'POST' && !id) || (method === 'PATCH' && id)) {
      const data = gameObject(payload, ['baseVersion', 'value']);
      const patch = gameObject(data.value);
      const index = values.findIndex((value) => value.id === (id ?? patch.id));
      if (method === 'POST' && index >= 0)
        throw new RobloxError(409, 'A game object already uses this ID.', 'ROBLOX_ID_CONFLICT');
      if (method === 'PATCH' && index < 0)
        throw new RobloxError(404, 'This game object was not found.', 'ROBLOX_OBJECT_NOT_FOUND');
      if (id && patch.id !== undefined && patch.id !== id)
        throw new RobloxError(422, 'A patch cannot change the object ID.', 'ROBLOX_ID_IMMUTABLE');
      if (method === 'POST') nextValues.push(patch as unknown as (typeof values)[number]);
      else {
        currentVersion(graph, data.baseVersion);
        // Keep null markers visible to the canonical field schema before they can clear values.
        nextValues[index] = mergeGameValue(values[index], patch, {
          preserveNulls: true,
        }) as (typeof values)[number];
        const unsupported = validateGameDefinition(next).diagnostics.filter(
          (issue) => issue.code === 'unsupported-field',
        );
        if (unsupported.length)
          throw new RobloxError(
            422,
            unsupported.map((issue) => `${issue.path}: ${issue.message}`).join('\n'),
            'ROBLOX_GAME_INVALID',
            unsupported,
          );
        nextValues[index] = mergeGameValue(values[index], patch) as (typeof values)[number];
      }
      return save(next, data.baseVersion);
    }
    throw new RobloxError(
      405,
      'Use GET/POST for a collection or GET/PATCH/DELETE for its object.',
      'ROBLOX_METHOD_NOT_ALLOWED',
    );
  }
  throw new RobloxError(404, 'Unknown Roblox game endpoint.', 'ROBLOX_ENDPOINT_NOT_FOUND');
}
