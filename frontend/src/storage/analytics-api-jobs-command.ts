import type { Graph } from '../model/types';
import type {
  AnalyticsExtension,
  AnalyticsResultContent,
  AnalysisJobRequest,
  AnalysisJobValue,
  ImportPreview,
} from '../analytics/types';
import { sourceDefinitionChanged } from '../analytics/reconcile';
import { reconcileSignalHistory } from '../analytics/signal-history';
import type { AnalyticsCommandOptions } from './analytics-commands';
import type { AnalyticsApiJobs } from './analytics-api-jobs';
import {
  AnalyticsCommandError,
  baseVersion,
  identity,
  object,
  query,
  request,
  type PublicAnalysisJobRequest,
} from './analytics-api-input';
import { bounded, page, resultPage } from './analytics-api-format';

interface JobCommandContext {
  diagramId: string;
  parts: string[];
  url: URL;
  method: string;
  payload: unknown;
  options: AnalyticsCommandOptions;
  jobs: AnalyticsApiJobs;
  graph: Graph;
  model: AnalyticsExtension;
  save: (next: AnalyticsExtension, version: number) => Promise<unknown>;
  authorize: () => Promise<void>;
  execute: (input: AnalysisJobRequest) => Promise<AnalysisJobValue>;
}

/** Background jobs retain their originating session and immutable source configuration. */
export async function analyticsJobCommand(context: JobCommandContext): Promise<unknown> {
  const { diagramId, parts, url, method, payload, options, jobs, graph, model, save, authorize } =
    context;
  if (parts.length === 4 && method === 'POST') {
    query(url);
    const data = object(payload, ['kind', 'input']);
    if (
      ![
        'measurement',
        'indicator',
        'signals',
        'backtest',
        'scenario',
        'import',
        'inspect-import',
        'query',
        'waterfall',
      ].includes(String(data.kind))
    )
      throw new AnalyticsCommandError(422, 'Choose a supported analytics job kind.');
    const input = request(
      model,
      data.kind as PublicAnalysisJobRequest['kind'],
      data.input,
      options.byteLimit,
    );
    if (!options.createAuthority)
      throw new AnalyticsCommandError(
        503,
        'An originating workspace session is required for background jobs.',
      );
    const authority = await options.createAuthority();
    try {
      await authorize();
      return await jobs.start(diagramId, input, authority, {
        model,
        modelVersion: graph.diagram.version,
      });
    } catch (error) {
      authority.dispose();
      throw error;
    }
  }
  if (parts.length < 5 || parts.length > 6)
    throw new AnalyticsCommandError(404, 'Unknown analytics job endpoint.');
  const jobId = identity(parts[4]);
  if (parts.length === 5) {
    query(url);
    if (method === 'GET') return jobs.status(diagramId, jobId, authorize);
    if (method === 'DELETE') return jobs.cancel(diagramId, jobId, authorize);
  }
  if (parts[5] === 'result' && method === 'GET') {
    query(url, ['offset', 'limit']);
    const { offset, limit } = page(url);
    const { value } = await jobs.result(diagramId, jobId, authorize);
    return bounded({ jobId, ...resultPage(value, offset, limit) });
  }
  if (parts[5] === 'archive' && method === 'POST') {
    query(url);
    const data = object(payload, ['baseVersion', 'mode', 'confirmed']);
    const version = baseVersion(data.baseVersion);
    if (version !== graph.diagram.version)
      throw new AnalyticsCommandError(
        409,
        'The diagram changed. Read the current baseVersion.',
        'VERSION_CONFLICT',
      );
    const {
      request: input,
      value,
      model: originalModel,
      modelVersion,
    } = await jobs.result(diagramId, jobId, authorize);
    if (input.kind === 'inspect-import' || input.kind === 'query' || input.kind === 'waterfall')
      throw new AnalyticsCommandError(
        422,
        'Inspection, data-query and waterfall-view jobs do not create analysis archives. Export data or save an analysis definition instead.',
      );
    if (input.kind === 'import') {
      if (data.confirmed !== true || !['create', 'replace', 'update'].includes(String(data.mode)))
        throw new AnalyticsCommandError(
          422,
          'Imported jobs require reviewed confirmed:true and create/replace/update mode.',
        );
      const imported = (await context.execute({
        kind: 'commit-import',
        model,
        preview: value as ImportPreview,
        mode: data.mode as 'create' | 'replace' | 'update',
      })) as AnalyticsExtension;
      return save(imported, version);
    }
    if (data.mode !== undefined || data.confirmed !== undefined)
      throw new AnalyticsCommandError(422, 'Only import archives accept mode and confirmed.');
    if (
      'model' in input &&
      input.model.datasets.some(
        (dataset) =>
          model.datasets.find((current) => current.id === dataset.id)?.version !== dataset.version,
      )
    )
      throw new AnalyticsCommandError(
        409,
        'The dataset changed while this job ran. Its result cannot be archived as current.',
        'STALE_ANALYSIS_RESULT',
      );
    const { kind, ...configuration } = input;
    const { model: omittedModel, ...parameters } = configuration as {
      model?: AnalyticsExtension;
      [key: string]: unknown;
    };
    const archived = (await context.execute({
      kind: 'archive',
      model: { ...originalModel, results: model.results, retention: model.retention },
      content: value as AnalyticsResultContent,
      parameters: { kind, ...parameters },
      modelVersion,
    })) as AnalyticsExtension;
    const createdResult = archived.results.at(-1)!;
    createdResult.stale ||= sourceDefinitionChanged(createdResult, originalModel, model);
    const retainedResults = new Set(archived.results.map((result) => result.id));
    const next = {
      ...model,
      results: archived.results,
      measurements: model.measurements.map((measurement) => {
        if (!measurement.resultId || retainedResults.has(measurement.resultId)) return measurement;
        const { resultId: _expired, ...definition } = measurement;
        return definition;
      }),
    };
    if (value && 'kind' in value && value.kind === 'signals') {
      const history = reconcileSignalHistory(model, value.signals);
      next.signals = history.signals;
      if (createdResult.content.kind === 'signals')
        createdResult.content.notes.push(...history.notes);
    }
    return save(next, version);
  }
  throw new AnalyticsCommandError(405, 'Use job GET/DELETE, result GET or archive POST.');
}
