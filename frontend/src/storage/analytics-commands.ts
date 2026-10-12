import type { Graph } from '../model/types';
import type { WorkspaceStorage } from './contracts';
import type {
  AnalyticsExtension,
  AnalysisJobRequest,
  AnalysisJobValue,
  ImportPreview,
} from '../analytics/types';
import { analyticsCapabilities } from '../analytics/capabilities';
import {
  analyticsApiJobs,
  type AnalyticsApiJobs,
  type AnalyticsJobAuthority,
} from './analytics-api-jobs';
import {
  collections,
  type Collection,
  type Entity,
  AnalyticsCommandError,
  object,
  baseVersion,
  query,
  identity,
  merge,
  request,
} from './analytics-api-input';
import { bounded, page, section, summary, resultPage, csv } from './analytics-api-format';
import { analyticsJobCommand } from './analytics-api-jobs-command';

export interface AnalyticsRepository {
  getGraph(id: string): Promise<Graph>;
  saveGraph(
    graph: Graph,
    version: number,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ): Promise<Graph>;
}
export interface AnalyticsCommandOptions {
  signal?: AbortSignal;
  byteLimit?: number;
  authorize?: () => Promise<void>;
  beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
  createAuthority?: () => Promise<AnalyticsJobAuthority>;
}
function read(graph: Graph): AnalyticsExtension {
  const model = graph.diagram.analytics;
  if (!model)
    throw new AnalyticsCommandError(
      422,
      'This diagram has no Time Series & Signal Analysis extension.',
      'ANALYTICS_DOCUMENT_REQUIRED',
    );
  return model;
}
async function guard(options: AnalyticsCommandOptions) {
  options.signal?.throwIfAborted();
  await options.authorize?.();
  options.signal?.throwIfAborted();
}
export async function executeAnalytics(
  input: AnalysisJobRequest,
  options: AnalyticsCommandOptions,
): Promise<AnalysisJobValue> {
  await guard(options);
  const { analyticsService } = await import('../analytics/service');
  const result = await analyticsService.run(input, {
    signal: options.signal,
    guard: () => guard(options),
  });
  await guard(options);
  return result;
}
/** Recheck authority at every response boundary, including private validation details. */
export async function analyticsCommand(
  repo: AnalyticsRepository,
  diagramId: string,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  options: AnalyticsCommandOptions = {},
  jobs: AnalyticsApiJobs = analyticsApiJobs,
): Promise<unknown> {
  try {
    const result = await dispatchAnalyticsCommand(
      repo,
      diagramId,
      parts,
      url,
      method,
      payload,
      options,
      jobs,
    );
    await guard(options);
    return result;
  } catch (error) {
    await guard(options);
    throw error;
  }
}

/** All browser, REST and MCP analytics commands share the versioned document and engine. */
async function dispatchAnalyticsCommand(
  repo: AnalyticsRepository,
  diagramId: string,
  parts: string[],
  url: URL,
  method: string,
  payload: unknown,
  options: AnalyticsCommandOptions = {},
  jobs: AnalyticsApiJobs = analyticsApiJobs,
): Promise<unknown> {
  await guard(options);
  const graph = await repo.getGraph(diagramId);
  const model = (await executeAnalytics(
    { kind: 'validate', model: read(graph) },
    options,
  )) as AnalyticsExtension;
  const action = parts[3];
  const save = async (next: AnalyticsExtension, version: number) => {
    if (version !== graph.diagram.version)
      throw new AnalyticsCommandError(
        409,
        'The diagram changed. Read its current baseVersion.',
        'VERSION_CONFLICT',
      );
    next = (await executeAnalytics(
      { kind: 'reconcile', previous: model, model: next },
      options,
    )) as AnalyticsExtension;
    const current = await repo.getGraph(diagramId);
    await guard(options);
    if (current.diagram.version !== version)
      throw new AnalyticsCommandError(
        409,
        'The diagram changed while its analysis update was prepared. Read its current baseVersion.',
        'VERSION_CONFLICT',
      );
    const analytics = bounded(summary(next));
    await guard(options);
    const saved = await repo.saveGraph(
      { ...graph, diagram: { ...graph.diagram, analytics: next } },
      version,
      options.beforeWrite,
    );
    return { diagramId, baseVersion: saved.diagram.version, analytics };
  };
  if (parts.length === 3) {
    query(url, ['full']);
    if (method === 'GET') {
      const full = url.searchParams.get('full');
      if (full !== null && full !== 'true' && full !== 'false')
        throw new AnalyticsCommandError(422, 'full must be true or false.');
      return bounded({
        diagramId,
        baseVersion: graph.diagram.version,
        analytics: full === 'true' ? model : summary(model),
      });
    }
    query(url);
    if (method !== 'PUT') throw new AnalyticsCommandError(405, 'Use GET or PUT for analytics.');
    const data = object(payload, ['baseVersion', 'value']);
    return save(data.value as AnalyticsExtension, baseVersion(data.baseVersion));
  }
  const pure = {
    measure: 'measurement',
    indicator: 'indicator',
    evaluate: 'signals',
    validate: 'backtest',
    project: 'scenario',
    waterfall: 'waterfall',
  } as const;
  if (Object.hasOwn(pure, action) && parts.length === 4) {
    query(url);
    if (method !== 'POST') throw new AnalyticsCommandError(405, 'Analysis preview requires POST.');
    return bounded(
      await executeAnalytics(
        request(model, pure[action as keyof typeof pure], payload, options.byteLimit),
        options,
      ),
    );
  }
  if (action === 'compare' && parts.length === 4) {
    query(url);
    if (method !== 'POST')
      throw new AnalyticsCommandError(405, 'Scenario comparison requires POST.');
    const data = object(payload, ['scenarioIds']);
    if (
      !Array.isArray(data.scenarioIds) ||
      data.scenarioIds.length < 2 ||
      data.scenarioIds.length > 20 ||
      new Set(data.scenarioIds).size !== data.scenarioIds.length
    )
      throw new AnalyticsCommandError(422, 'Compare 2..20 distinct saved scenarios.');
    const scenarios = data.scenarioIds.map((id) =>
      model.scenarios.find((entry) => entry.id === id),
    );
    if (scenarios.some((entry) => !entry))
      throw new AnalyticsCommandError(404, 'A scenario was not found.');
    const baseline = scenarios[0]!;
    if (
      scenarios.some(
        (entry) =>
          entry!.assumptions.currency !== baseline.assumptions.currency ||
          entry!.start !== baseline.start ||
          entry!.periods !== baseline.periods ||
          entry!.resolution !== baseline.resolution,
      )
    )
      throw new AnalyticsCommandError(
        422,
        'Compare scenarios with the same currency, start, resolution and horizon.',
        'INCOMPATIBLE_UNITS',
      );
    const results = [];
    for (const scenario of scenarios)
      results.push(await executeAnalytics({ kind: 'scenario', scenario: scenario! }, options));
    return bounded({
      scenarioIds: data.scenarioIds,
      results,
      interpretation:
        'Assumption-based scenarios; this spread is not a confidence or prediction interval.',
    });
  }
  if (action === 'export' && parts.length === 4) {
    query(url, ['offset', 'limit']);
    if (method !== 'POST') throw new AnalyticsCommandError(405, 'Analytics export requires POST.');
    const data = object(payload, ['scope', 'id', 'format', 'options']);
    if (data.format === 'svg') {
      query(url);
      const { exportAnalyticsChartSvg, exportAnalyticsResultSvg } =
        await import('../analytics/vector-export');
      const exportOptions = data.options === undefined ? {} : object(data.options);
      const id = identity(data.id);
      const controls = { signal: options.signal, guard: () => guard(options) };
      const result =
        data.scope === 'chart'
          ? await exportAnalyticsChartSvg(model, id, exportOptions, controls)
          : data.scope === 'indicator' || data.scope === 'scenario' || data.scope === 'measurement'
            ? await exportAnalyticsResultSvg(model, data.scope, id, exportOptions, controls)
            : (() => {
                throw new AnalyticsCommandError(
                  422,
                  'SVG export supports chart, indicator, scenario or regression measurement scope.',
                );
              })();
      return bounded({ scope: data.scope, format: 'svg', ...result });
    }
    if (data.options !== undefined)
      throw new AnalyticsCommandError(422, 'Export options are only supported for SVG.');
    if (
      !['observations', 'measurement', 'signals', 'scenario'].includes(String(data.scope)) ||
      !['json', 'csv'].includes(String(data.format))
    )
      throw new AnalyticsCommandError(
        422,
        'Choose observations/measurement/signals/scenario and json/csv.',
      );
    const { offset, limit } = page(url);
    let rows: Record<string, unknown>[];
    if (data.scope === 'observations') {
      rows = (await executeAnalytics(
        request(model, 'query', { seriesId: data.id }, options.byteLimit),
        options,
      )) as unknown as Record<string, unknown>[];
    } else if (data.scope === 'signals') {
      if (data.id !== undefined && !model.rules.some((rule) => rule.id === data.id))
        throw new AnalyticsCommandError(404, 'Signal rule not found.');
      rows = model.signals.filter(
        (signal) => data.id === undefined || signal.ruleId === data.id,
      ) as unknown as Record<string, unknown>[];
    } else {
      const result = await executeAnalytics(
        request(
          model,
          data.scope as 'measurement' | 'scenario',
          { id: data.id },
          options.byteLimit,
        ),
        options,
      );
      if (!('kind' in result)) throw new AnalyticsCommandError(422, 'Unsupported export result.');
      rows =
        result.kind === 'measurement'
          ? Object.entries(result.metrics).map(([metric, value]) => ({ metric, ...value }))
          : result.kind === 'scenario'
            ? (result.points as unknown as Record<string, unknown>[])
            : [];
    }
    const portion = section(rows, offset, limit);
    await guard(options);
    return bounded({
      scope: data.scope,
      format: data.format,
      offset: portion.offset,
      nextOffset: portion.nextOffset,
      total: portion.total,
      complete: portion.complete,
      data: data.format === 'csv' ? csv(portion.items) : portion.items,
      warnings:
        data.format === 'csv'
          ? ['Formula-like text is prefixed with an apostrophe for safe spreadsheet opening.']
          : [],
    });
  }
  if (action === 'import' && parts.length === 5) {
    query(url);
    if (method !== 'POST' || !['inspect', 'preview', 'commit'].includes(parts[4]))
      throw new AnalyticsCommandError(404, 'Unknown analytics import operation.');
    if (parts[4] === 'inspect')
      return bounded(
        await executeAnalytics(
          request(model, 'inspect-import', payload, options.byteLimit),
          options,
        ),
      );
    if (parts[4] === 'preview')
      return bounded(
        await executeAnalytics(request(model, 'import', payload, options.byteLimit), options),
      );
    const data = object(payload, ['baseVersion', 'input', 'mode', 'confirmed']);
    const version = baseVersion(data.baseVersion);
    if (data.confirmed !== true || !['create', 'replace', 'update'].includes(String(data.mode)))
      throw new AnalyticsCommandError(
        422,
        'Review preview, then supply confirmed:true and create/replace/update mode.',
      );
    if (version !== graph.diagram.version)
      throw new AnalyticsCommandError(
        409,
        'The diagram changed. Read its current baseVersion.',
        'VERSION_CONFLICT',
      );
    const preview = (await executeAnalytics(
      request(model, 'import', data.input, options.byteLimit),
      options,
    )) as ImportPreview;
    const imported = (await executeAnalytics(
      {
        kind: 'commit-import',
        model,
        preview,
        mode: data.mode as 'create' | 'replace' | 'update',
      },
      options,
    )) as AnalyticsExtension;
    return save(imported, version);
  }
  if (action === 'query' && parts.length === 4) {
    query(url, ['offset', 'limit']);
    if (method !== 'POST')
      throw new AnalyticsCommandError(405, 'Paginated data queries require POST.');
    const input = request(model, 'query', payload, options.byteLimit) as Extract<
      AnalysisJobRequest,
      { kind: 'query' }
    >;
    const seriesId = input.seriesId;
    const points = await executeAnalytics(input, options);
    if (!Array.isArray(points)) throw new AnalyticsCommandError(422, 'Invalid query result.');
    const { offset, limit } = page(url);
    await guard(options);
    return bounded({ seriesId, ...section(points, offset, limit) });
  }
  if (action === 'jobs')
    return analyticsJobCommand({
      diagramId,
      parts,
      url,
      method,
      payload,
      options,
      jobs,
      graph,
      model,
      save,
      authorize: () => guard(options),
      execute: (input) => executeAnalytics(input, options),
    });
  if (action === 'signals' || action === 'results') {
    if (action === 'results' && parts.length === 6 && parts[5] === 'content' && method === 'GET') {
      query(url, ['offset', 'limit']);
      const result = model.results.find((entry) => entry.id === parts[4]);
      if (!result) throw new AnalyticsCommandError(404, 'Analysis result not found.');
      const { offset, limit } = page(url);
      return bounded({ resultId: result.id, ...resultPage(result.content, offset, limit) });
    }
    if (action === 'results' && parts.length === 6 && parts[5] === 'input' && method === 'GET') {
      query(url, ['datasetId', 'offset', 'limit']);
      const result = model.results.find((entry) => entry.id === parts[4]);
      if (!result) throw new AnalyticsCommandError(404, 'Analysis result not found.');
      const datasetId = url.searchParams.get('datasetId');
      const datasets = result.inputSnapshot.datasets;
      if (!datasetId)
        return bounded({
          resultId: result.id,
          inputSnapshot: {
            ...result.inputSnapshot,
            datasets: datasets.map(({ observations, ...dataset }) => ({
              ...dataset,
              observationCount: observations.length,
            })),
          },
        });
      const dataset = datasets.find((entry) => entry.id === datasetId);
      if (!dataset)
        throw new AnalyticsCommandError(404, 'Original dataset not found in this result snapshot.');
      const { offset, limit } = page(url);
      return bounded({
        resultId: result.id,
        datasetId,
        dataVersion: dataset.version,
        ...section(dataset.observations, offset, limit),
      });
    }
    if (parts.length > 5)
      throw new AnalyticsCommandError(404, 'Unknown analytics result endpoint.');
    if (method === 'GET') {
      query(url, ['offset', 'limit']);
      const { offset, limit } = page(url);
      const entries = action === 'signals' ? model.signals : model.results;
      if (parts[4]) {
        const entry = entries.find((value) => value.id === parts[4]);
        if (!entry) throw new AnalyticsCommandError(404, 'Analytics result not found.');
        if (action === 'results') {
          const archived = entry as (typeof model.results)[number];
          return bounded({
            ...archived,
            inputSnapshot: undefined,
            content: undefined,
            kind: archived.content.kind,
            inputAvailable: true,
          });
        }
        return bounded(entry);
      }
      return bounded(
        section<unknown>(
          action === 'results'
            ? model.results.map(({ inputSnapshot, content, ...result }) => ({
                ...result,
                kind: content.kind,
                inputAvailable: true,
              }))
            : entries,
          offset,
          limit,
        ),
      );
    }
    if (action === 'signals' && parts[4] && method === 'PATCH') {
      query(url);
      const data = object(payload, ['baseVersion', 'value']);
      const value = object(data.value, [
        'acknowledged',
        'muted',
        'measurementId',
        'annotationId',
        'nodeId',
        'scenarioId',
      ]);
      for (const key of ['acknowledged', 'muted'])
        if (value[key] !== undefined && typeof value[key] !== 'boolean')
          throw new AnalyticsCommandError(422, `${key} must be boolean.`);
      const index = model.signals.findIndex((signal) => signal.id === parts[4]);
      if (index < 0) throw new AnalyticsCommandError(404, 'Signal not found.');
      const next = structuredClone(model);
      next.signals[index] = merge(
        next.signals[index] as unknown as Record<string, unknown>,
        value,
      ) as unknown as (typeof next.signals)[number];
      return save(next, baseVersion(data.baseVersion));
    }
    if (action === 'results' && parts[4] && method === 'DELETE') {
      query(url, ['baseVersion']);
      if (!model.results.some((result) => result.id === parts[4]))
        throw new AnalyticsCommandError(404, 'Analysis result not found.');
      return save(
        {
          ...model,
          results: model.results.filter((result) => result.id !== parts[4]),
          measurements: model.measurements.map((measurement) => {
            if (measurement.resultId !== parts[4]) return measurement;
            const { resultId: _removed, ...definition } = measurement;
            return definition;
          }),
        },
        baseVersion(
          url.searchParams.has('baseVersion')
            ? Number(url.searchParams.get('baseVersion'))
            : undefined,
        ),
      );
    }
    throw new AnalyticsCommandError(
      405,
      'Computed results are immutable. Only signal handling/link fields can be patched.',
    );
  }
  if (!collections.includes(action as Collection) || parts.length > 5)
    throw new AnalyticsCommandError(404, 'Unknown analytics endpoint.');
  const collection = action as Collection;
  const current = model[collection] as unknown as Entity[];
  const id = parts[4] === undefined ? undefined : identity(decodeURIComponent(parts[4]));
  const index = id === undefined ? -1 : current.findIndex((entity) => entity.id === id);
  if (id !== undefined && index < 0)
    throw new AnalyticsCommandError(404, 'Analytics definition not found.');
  if (method === 'GET') {
    query(url);
    if (collection === 'datasets') {
      const datasets = (id ? [current[index]] : current).map(({ observations, ...dataset }) => ({
        ...dataset,
        observationCount: (observations as unknown[]).length,
      }));
      return bounded(id ? datasets[0] : datasets);
    }
    return bounded(id === undefined ? current : current[index]);
  }
  let version: number, next: Entity[];
  if (method === 'DELETE' && id !== undefined) {
    query(url, ['baseVersion']);
    version = baseVersion(
      url.searchParams.has('baseVersion') ? Number(url.searchParams.get('baseVersion')) : undefined,
    );
    next = current.filter((entity) => entity.id !== id);
  } else if ((method === 'POST' && id === undefined) || (method === 'PATCH' && id !== undefined)) {
    query(url);
    const data = object(payload, ['baseVersion', 'value']);
    version = baseVersion(data.baseVersion);
    const value = object(data.value);
    if (id !== undefined && value.id !== undefined && value.id !== id)
      throw new AnalyticsCommandError(422, 'An analytics identity cannot be changed.');
    const entityId = id ?? identity(value.id ?? crypto.randomUUID());
    if (id === undefined && current.some((entry) => entry.id === entityId))
      throw new AnalyticsCommandError(
        409,
        'This analytics identity already exists.',
        'ANALYTICS_ID_CONFLICT',
      );
    const entity = { ...(id === undefined ? value : merge(current[index], value)), id: entityId };
    next =
      id === undefined
        ? [...current, entity]
        : current.map((entry, i) => (i === index ? entity : entry));
  } else
    throw new AnalyticsCommandError(
      405,
      'Use GET, collection POST, entity PATCH or entity DELETE.',
    );
  const candidate = { ...model, [collection]: next };
  if (collection === 'series' && method === 'DELETE' && model.scenarioView) {
    candidate.scenarioView = { ...model.scenarioView };
    for (const key of ['customerHistorySeriesId', 'mrcHistorySeriesId'] as const)
      if (candidate.scenarioView[key] === id) delete candidate.scenarioView[key];
  }
  return save(candidate, version);
}
export { analyticsCapabilities, AnalyticsCommandError };
