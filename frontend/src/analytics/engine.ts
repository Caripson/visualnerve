import type { AnalysisJobRequest, AnalysisJobValue, AnalysisContext } from './types';
import { measure, calculateIndicator } from './measurements';
import { evaluateSignals } from './signals';
import { backtest } from './backtest';
import { runScenario } from './scenarios';
import { previewImport, readImportTable } from './import';
import { querySeries, aggregateOHLC, waterfall } from './series';
import { checkAnalysis } from './series';
import { validateAnalytics, assertFiniteJson, AnalyticsError } from './validation';
import { archiveResult, applyImport } from './document';
import { reconcileAnalytics } from './reconcile';
export { measure, calculateIndicator, evaluateSignals, backtest, runScenario, previewImport };
export {
  querySeries,
  seriesObservations,
  aggregateOHLC,
  waterfall,
  normalizeSeries,
  compatibleUnits,
  periodKey,
  periodOrdinal,
  periodStart,
} from './series';
export { compareScenarios, adjustedChurn } from './scenarios';
export { sma, ema, pearson, ranks, median, regression, relativeChange } from './math';
export { indicatorUnit } from './units';
export { signalDefinitionFingerprint, isCurrentSignal } from './identity';
export function executeAnalysis(
  request: AnalysisJobRequest,
  context?: AnalysisContext,
): AnalysisJobValue {
  checkAnalysis(context);
  if ('model' in request && request.kind !== 'archive' && request.kind !== 'reconcile')
    validateAnalytics(request.model);
  let result: AnalysisJobValue;
  switch (request.kind) {
    case 'validate':
      result = request.model;
      break;
    case 'commit-import':
      result = applyImport(request.model, request.preview, request.mode, request.targetDatasetId);
      break;
    case 'archive':
      result = archiveResult(
        request.model,
        request.content,
        request.parameters,
        request.modelVersion,
        context,
      );
      break;
    case 'reconcile':
      validateAnalytics(request.previous);
      result = reconcileAnalytics(request.previous, request.model);
      break;
    case 'inspect-import': {
      const table = readImportTable(request.source, request.byteLimit, context);
      const seriesNames = request.seriesColumn
        ? [...new Set(table.rows.map((row) => String(row[request.seriesColumn!] ?? '')))]
        : undefined;
      if (seriesNames && seriesNames.length > 100)
        throw new AnalyticsError('IMPORT_LIMIT', 'At most 100 named series are supported.');
      result = {
        columns: table.columns,
        sample: table.rows.slice(0, 10),
        rows: table.rows.length,
        sheets: table.sheets,
        ...(seriesNames ? { seriesNames } : {}),
      };
      break;
    }
    case 'query':
      result = request.ohlc
        ? aggregateOHLC(
            request.model,
            request.seriesId,
            request.query?.resolution ?? 'month',
            request.query,
            context,
          )
        : querySeries(request.model, request.seriesId, request.query, context);
      break;
    case 'import':
      result = previewImport(
        request.source,
        request.mapping,
        request.datasetId,
        request.byteLimit,
        context,
      );
      break;
    case 'waterfall':
      result = waterfall(request.model, request.chart, request.time, context);
      break;
    case 'measurement':
      result = measure(request.model, request.measurement, context);
      break;
    case 'indicator':
      result = calculateIndicator(request.model, request.indicator, context);
      break;
    case 'signals':
      result = evaluateSignals(
        request.model,
        { ruleIds: request.ruleIds, from: request.from, to: request.to },
        context,
      );
      break;
    case 'backtest':
      result = backtest(request.model, request.config, context);
      break;
    case 'scenario':
      result = runScenario(request.scenario, context);
      break;
  }
  checkAnalysis(context);
  assertFiniteJson(result);
  return result;
}
