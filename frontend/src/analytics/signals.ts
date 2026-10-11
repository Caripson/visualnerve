import type {
  AnalyticsExtension,
  AnalyticsRule,
  AnalyticsSignal,
  SignalResult,
  SignalExpression,
  SignalOperand,
  Comparator,
  Observation,
  AnalysisContext,
  AnalyticsSeries,
} from './types';
import { querySeries, contiguous, checkAnalysis, calculationValues } from './series';
import { publicationTime, publicationReadiness } from './publication';
import { mean, median, stddev, sma, ema, regression, relativeChange } from './math';
import { calculateIndicator } from './measurements';
import {
  analyticsIdentity,
  signalDefinitionFingerprint,
  signalEpisodeIdentity,
  signalEventIdentity,
} from './identity';
import { validateRuleSemantics } from './rule-semantics';
import { requireAnalysis, validateRule } from './validation';
export type Truth = true | false | 'unknown';
interface Decision {
  state: Truth;
  next?: string;
}
interface OperandValue {
  value: number | null;
  next?: string;
}
function nextRelease(values: { next?: string }[]) {
  return values.reduce<string | undefined>(
    (next, value) => (value.next && (!next || value.next < next) ? value.next : next),
    undefined,
  );
}
function allOperands(values: OperandValue[]): string | undefined {
  if (values.some((item) => item.value === null && !item.next)) return undefined;
  return values.reduce<string | undefined>(
    (latest, item) => (item.next && (!latest || item.next > latest) ? item.next : latest),
    undefined,
  );
}
export function compare(left: number, right: number, operator: Comparator) {
  switch (operator) {
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
  }
}
export const signalHash = analyticsIdentity;
function direction(value: number, threshold: number, direction: 'up' | 'down' | 'both' = 'both') {
  return direction === 'up'
    ? value > threshold
    : direction === 'down'
      ? value < -threshold
      : Math.abs(value) > threshold;
}
function finiteWindow(
  rows: Observation[],
  start: number,
  end: number,
  knownAt: string,
  series: AnalyticsSeries,
) {
  const win = rows.slice(Math.max(0, start), end);
  return win.length === end - start &&
    win.every(
      (o, i) =>
        o.value !== null &&
        o.quality === 'valid' &&
        (!o.knownAt || o.knownAt <= knownAt) &&
        (i === 0 || contiguous(win[i - 1], o, series)),
    )
    ? win.map((o) => o.value!)
    : null;
}
function expressionWork(node: SignalExpression): number {
  if (node.kind === 'and' || node.kind === 'or')
    return node.children.reduce((total, child) => total + expressionWork(child), 1);
  if (node.kind === 'not') return expressionWork(node.child) + 1;
  if (node.kind === 'sustained') return node.periods * expressionWork(node.child);
  if (node.kind === 'window') return node.periods;
  return node.kind === 'crossing' ? 2 : 1;
}
function ruleWork(rule: AnalyticsRule): number {
  const window = rule.parameters.window ?? 12;
  if (rule.expression) return expressionWork(rule.expression);
  if (rule.family === 'anomaly') return window * Math.max(1, Math.log2(window));
  if (['momentum', 'variation-spike', 'kpi-divergence'].includes(rule.family)) return window * 2;
  if (rule.family === 'seasonality-deviation') return (rule.parameters.seasonLength ?? 12) * 2;
  return 1;
}
export function evaluateSignals(
  model: AnalyticsExtension,
  options: { ruleIds?: string[]; from?: string; to?: string } = {},
  context?: AnalysisContext,
): SignalResult {
  checkAnalysis(context);
  const rules = model.rules.filter(
    (r) => r.enabled && (!options.ruleIds || options.ruleIds.includes(r.id)),
  );
  requireAnalysis(
    !options.ruleIds || options.ruleIds.every((id) => model.rules.some((r) => r.id === id)),
    'Unknown signal rule.',
  );
  requireAnalysis(rules.length <= 100, 'At most 100 rules may be evaluated together.');
  const signals: AnalyticsSignal[] = [],
    notes: string[] = [];
  let evaluated = 0,
    unknown = 0,
    totalEvents = 0,
    episodeCount = 0,
    weightedWork = 0;
  // Pending releases remain in planning rows. Numerical operands are gated at their
  // deciding publication timestamp rather than silently dropping the observation.
  const planningCutoff =
    context?.cutoff ??
    model.datasets.reduce(
      (latest, dataset) =>
        dataset.observations.reduce(
          (time, observation) =>
            publicationTime(observation) > time ? publicationTime(observation) : time,
          latest,
        ),
      '',
    );
  const observationEnd = options.to && options.to < planningCutoff ? options.to : planningCutoff;
  const planningContext = { ...context, cutoff: undefined };
  const seriesCache = new Map<string, Observation[]>();
  const gapsCache = new Map<string, boolean[]>();
  const getRows = (id: string) => {
    let rows = seriesCache.get(id);
    if (!rows) {
      rows = querySeries(model, id, { to: observationEnd }, planningContext);
      seriesCache.set(id, rows);
    }
    return rows;
  };
  const gapsFor = (id: string) => {
    let gaps = gapsCache.get(id);
    if (!gaps) {
      const rows = getRows(id),
        series = model.series.find((item) => item.id === id)!;
      gaps = rows.map((row, index) => index > 0 && !contiguous(rows[index - 1], row, series));
      gapsCache.set(id, gaps);
    }
    return gaps;
  };
  const readinessCache = new Map<string, (string | undefined)[]>();
  const readiness = (id: string, window: number | null, minimum = window ?? 1) => {
    const key = `${id}:${window}:${minimum}`;
    let result = readinessCache.get(key);
    if (!result) {
      result = publicationReadiness(
        getRows(id),
        model.series.find((item) => item.id === id)!,
        window,
        minimum,
      );
      readinessCache.set(key, result);
    }
    return result;
  };
  const positionsCache = new Map<string, Map<string, number>>();
  const positions = (id: string) => {
    let cached = positionsCache.get(id);
    if (!cached) {
      cached = new Map(getRows(id).map((item, index) => [item.time, index]));
      positionsCache.set(id, cached);
    }
    return cached;
  };
  const indicatorCache = new Map<
    string,
    Map<string, ReturnType<typeof calculateIndicator>['points'][number]>
  >();
  const indicatorPoints = (id: string) => {
    let points = indicatorCache.get(id);
    if (!points) {
      const definition = model.indicators.find((i) => i.id === id);
      requireAnalysis(definition, 'Unknown indicator operand.');
      points = new Map(
        calculateIndicator(model, definition, { ...context, cutoff: planningCutoff }).points.map(
          (p) => [p.time, p],
        ),
      );
      indicatorCache.set(id, points);
    }
    return points;
  };
  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    checkAnalysis(context);
    const rule = rules[ruleIndex];
    validateRule(
      rule,
      new Set(model.series.map((s) => s.id)),
      new Set(model.indicators.map((i) => i.id)),
    );
    validateRuleSemantics(rule, model);
    const series = model.series.find((s) => s.id === rule.seriesId)!;
    const dataset = model.datasets.find((d) => d.id === series.datasetId)!;
    const seriesVersion = series.version ?? 1;
    const definitionFingerprint = signalDefinitionFingerprint(model, rule.id);
    requireAnalysis(definitionFingerprint, 'Signal dependencies must resolve before evaluation.');
    const rows = getRows(rule.seriesId);
    const gaps = gapsFor(rule.seriesId);
    weightedWork += rows.length * ruleWork(rule);
    requireAnalysis(
      weightedWork <= 50000000,
      'This signal batch exceeds the 50-million weighted evaluation budget. Narrow the time range, reduce lookback or split the batch.',
      'rules',
      'IMPORT_LIMIT',
    );
    requireAnalysis(
      new Set(rows.map((o) => o.time)).size === rows.length,
      'Select one segment or explicitly aggregate same-period exposures before evaluating a signal. Duplicate timestamps cannot define a confirmation sequence.',
      undefined,
      'INCOMPATIBLE_UNITS',
    );
    const maps = new Map<string, Map<string, Observation>>();
    const seriesPoint = (id: string, time: string) => {
      let map = maps.get(id);
      if (!map) {
        const data = getRows(id);
        requireAnalysis(
          new Set(data.map((o) => o.time)).size === data.length,
          'Select one segment before a cross-series rule; duplicate timestamps are ambiguous.',
          undefined,
          'INCOMPATIBLE_UNITS',
        );
        map = new Map(data.map((o) => [o.time, o]));
        maps.set(id, map);
      }
      return map.get(time);
    };
    const operand = (value: SignalOperand, time: string, knownAt: string): OperandValue => {
      if (value.kind === 'constant') return { value: value.value };
      if (value.kind === 'series') {
        const observation = seriesPoint(value.seriesId, time);
        if (!observation || observation.quality !== 'valid' || observation.value === null)
          return { value: null };
        const release = publicationTime(observation);
        return release > knownAt ? { value: null, next: release } : { value: observation.value };
      }
      const definition = model.indicators.find((item) => item.id === value.indicatorId)!;
      const index = positions(definition.seriesId).get(time);
      if (index === undefined) return { value: null };
      const recursive = ['ema', 'macd', 'rsi'].includes(definition.kind);
      const window = definition.kind === 'roc' ? definition.window + 1 : definition.window;
      const release = readiness(
        definition.seriesId,
        recursive ? null : window,
        definition.kind === 'rsi' ? definition.window + 1 : recursive ? 1 : window,
      )[index];
      if (!release) return { value: null };
      if (release > knownAt) return { value: null, next: release };
      return {
        value: indicatorPoints(value.indicatorId).get(time)?.[value.component ?? 'value'] ?? null,
      };
    };
    const expression = (node: SignalExpression, index: number, knownAt: string): Decision => {
      const primary = rows[index];
      if (primary.value === null || primary.quality !== 'valid') return { state: 'unknown' };
      if (publicationTime(primary) > knownAt)
        return { state: 'unknown', next: publicationTime(primary) };
      if (node.kind === 'and' || node.kind === 'or') {
        const children = node.children.map((child) => expression(child, index, knownAt));
        if (node.kind === 'and' && children.some((child) => child.state === false))
          return { state: false };
        if (node.kind === 'or' && children.some((child) => child.state === true))
          return { state: true };
        const pending = children.filter((child) => child.state === 'unknown');
        return pending.length
          ? { state: 'unknown', next: nextRelease(pending) }
          : { state: node.kind === 'and' };
      }
      if (node.kind === 'sustained') {
        if (index + 1 < node.periods) return { state: 'unknown' };
        const current = rows.slice(index - node.periods + 1, index + 1);
        if (current.some((o, i) => i > 0 && !contiguous(current[i - 1], o, series)))
          return { state: 'unknown' };
        const outcomes = current.map((_, i) =>
          expression(node.child, index - node.periods + 1 + i, knownAt),
        );
        if (outcomes.some((outcome) => outcome.state === false)) return { state: false };
        const pending = outcomes.filter((outcome) => outcome.state === 'unknown');
        return pending.length ? { state: 'unknown', next: nextRelease(pending) } : { state: true };
      }
      if (node.kind === 'window') {
        if (index + 1 < node.periods) return { state: 'unknown' };
        const current = rows.slice(index - node.periods + 1, index + 1);
        if (current.some((o, i) => i > 0 && !contiguous(current[i - 1], o, series)))
          return { state: 'unknown' };
        const values = current.map((o) => operand(node.operand, o.time, knownAt));
        if (values.some((item) => item.value === null))
          return { state: 'unknown', next: allOperands(values) };
        const nums = values.map((item) => item.value!);
        const result =
          node.operation === 'mean'
            ? mean(nums)
            : node.operation === 'min'
              ? Math.min(...nums)
              : node.operation === 'max'
                ? Math.max(...nums)
                : node.operation === 'stddev'
                  ? stddev(nums)
                  : relativeChange(nums[0], nums.at(-1)!).value;
        return {
          state: result === null ? 'unknown' : compare(result, node.threshold, node.operator),
        };
      }
      if (node.kind === 'not') {
        const child = expression(node.child, index, knownAt);
        return { ...child, state: child.state === 'unknown' ? 'unknown' : !child.state };
      }
      const a = operand(node.left, rows[index].time, knownAt),
        b = operand(node.right, rows[index].time, knownAt);
      if (a.value === null || b.value === null)
        return { state: 'unknown', next: allOperands([a, b]) };
      if (node.kind === 'comparison') return { state: compare(a.value, b.value, node.operator) };
      if (
        (node.direction === 'up' && a.value <= b.value) ||
        (node.direction === 'down' && a.value >= b.value)
      )
        return { state: false };
      if (index === 0 || !contiguous(rows[index - 1], rows[index], series))
        return { state: 'unknown' };
      const prevA = operand(node.left, rows[index - 1].time, knownAt),
        prevB = operand(node.right, rows[index - 1].time, knownAt);
      if (prevA.value === null || prevB.value === null)
        return { state: 'unknown', next: allOperands([prevA, prevB]) };
      return {
        state:
          node.direction === 'up'
            ? prevA.value <= prevB.value && a.value > b.value
            : prevA.value >= prevB.value && a.value < b.value,
      };
    };
    const p = rule.parameters,
      w = p.window ?? 12;
    const { values, indices } =
      rule.family === 'moving-average-crossover'
        ? calculationValues(rows, series, planningCutoff)
        : { values: [], indices: [] };
    const requiredWindow = ['momentum', 'anomaly', 'kpi-divergence'].includes(rule.family)
      ? w + 1
      : rule.family === 'variation-spike'
        ? 2 * w
        : rule.family === 'seasonality-deviation'
          ? 2 * (p.seasonLength ?? 12) + 1
          : rule.family === 'moving-average-crossover'
            ? p.average === 'ema'
              ? null
              : (p.longWindow ?? 12) + 1
            : rule.family === 'structural-change'
              ? null
              : 1;
    const primaryReady = readiness(
      series.id,
      requiredWindow,
      rule.family === 'moving-average-crossover' && p.average === 'ema'
        ? (p.longWindow ?? 12)
        : (requiredWindow ?? 1),
    );
    const secondaryReady =
      rule.family === 'kpi-divergence' ? readiness(rule.secondSeriesId!, w + 1) : undefined;
    const shortAverage =
      rule.family === 'moving-average-crossover'
        ? p.average === 'ema'
          ? ema(values, 2 / ((p.shortWindow ?? 3) + 1))
          : sma(values, p.shortWindow ?? 3)
        : [];
    const longAverage =
      rule.family === 'moving-average-crossover'
        ? p.average === 'ema'
          ? ema(values, 2 / ((p.longWindow ?? 12) + 1))
          : sma(values, p.longWindow ?? 12)
        : [];
    const averages =
      rule.family === 'moving-average-crossover'
        ? { short: indices.map((i) => shortAverage[i]), long: indices.map((i) => longAverage[i]) }
        : undefined;
    if (rule.family === 'custom') {
      weightedWork += rows.length * ruleWork(rule);
      requireAnalysis(
        weightedWork <= 50000000,
        'Custom dependency scheduling exceeds the 50-million weighted evaluation budget.',
        'rules',
        'IMPORT_LIMIT',
      );
    }
    const schedule = rows.map((observation, index) => {
      if (index % 256 === 0) checkAnalysis(context);
      let time = publicationTime(observation);
      const release = primaryReady[index];
      if (rule.family !== 'custom' && release && release > time) time = release;
      if (secondaryReady) {
        const secondIndex = positions(rule.secondSeriesId!).get(observation.time);
        const release = secondIndex === undefined ? undefined : secondaryReady[secondIndex];
        if (release && release > time) time = release;
      }
      if (rule.family === 'custom' && time <= planningCutoff) {
        let decision = expression(rule.expression!, index, time);
        while (decision.state === 'unknown' && decision.next && decision.next <= planningCutoff) {
          requireAnalysis(decision.next > time, 'Dependency scheduling must advance its cutoff.');
          time = decision.next;
          weightedWork += ruleWork(rule);
          requireAnalysis(
            weightedWork <= 50000000,
            'Delayed dependency reevaluations exceed the 50-million weighted evaluation budget.',
            'rules',
            'IMPORT_LIMIT',
          );
          checkAnalysis(context);
          decision = expression(rule.expression!, index, time);
        }
      }
      return { index, time, confirmation: false };
    });
    const consecutive = p.consecutive ?? 1;
    if (
      consecutive > 1 &&
      schedule.some((event, index) => index > 0 && event.time < schedule[index - 1].time)
    ) {
      weightedWork += rows.length * consecutive;
      requireAnalysis(
        weightedWork <= 50000000,
        'Confirmation scheduling exceeds the 50-million weighted evaluation budget.',
        'rules',
        'IMPORT_LIMIT',
      );
      const confirmation = publicationReadiness(
        rows.map((row, index) => ({ ...row, knownAt: schedule[index].time })),
        series,
        consecutive,
      );
      for (let index = 0; index < rows.length; index++)
        if (confirmation[index] && confirmation[index]! > schedule[index].time)
          schedule.push({ index, time: confirmation[index]!, confirmation: true });
    }
    const ordered = <T extends { index: number; time: string }>(items: T[]) => {
      if (
        items.some(
          (item, index) =>
            index > 0 &&
            (item.time < items[index - 1].time ||
              (item.time === items[index - 1].time && item.index < items[index - 1].index)),
        )
      )
        items.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.index - b.index));
      return items;
    };
    ordered(schedule);
    const primaryPublications = ordered(
      rows.map((row, index) => ({ index, time: publicationTime(row) })),
    );
    const conditionStates: Truth[] = rows.map(() => 'unknown');
    const conditionMetadata = new Map<
      number,
      { state: Truth; baseline: number | null; threshold: number | null; score: number | null }
    >();
    const publishedEvents = new Set<string>();
    let publicationCursor = 0,
      latestPublishedIndex = -1,
      previousCurrentIndex = -1;
    let active = false,
      streak = 0,
      episodeId = '',
      onsetTime = '',
      cooldownUntil = -1,
      hi = 0,
      lo = 0;
    let dropped = 0;
    for (let eventIndex = 0; eventIndex < schedule.length; eventIndex++) {
      if (eventIndex % 256 === 0) checkAnalysis(context);
      const event = schedule[eventIndex],
        index = event.index,
        o = rows[index],
        knownAt = event.time;
      if (event.confirmation) {
        weightedWork += ruleWork(rule);
        requireAnalysis(
          weightedWork <= 50000000,
          'Confirmation reevaluations exceed the 50-million weighted evaluation budget.',
          'rules',
          'IMPORT_LIMIT',
        );
      }
      if (knownAt > planningCutoff) {
        if (!event.confirmation) unknown++;
        continue;
      }
      while (
        publicationCursor < primaryPublications.length &&
        primaryPublications[publicationCursor].time <= knownAt
      ) {
        latestPublishedIndex = Math.max(
          latestPublishedIndex,
          primaryPublications[publicationCursor].index,
        );
        publicationCursor++;
      }
      const gap = gaps[index];
      if (gap && rule.family === 'structural-change' && !event.confirmation) {
        hi = 0;
        lo = 0;
      }
      let state: Truth = 'unknown',
        baseline: number | null = null,
        threshold: number | null = p.threshold ?? null,
        score: number | null = o.value;
      const value = o.value;
      if (value !== null && o.quality === 'valid' && knownAt <= planningCutoff) {
        switch (rule.family) {
          case 'threshold':
          case 'sustained':
            {
              const base = p.threshold ?? 0;
              threshold = base;
              const comparator = p.comparator ?? '>';
              const hysteresis = p.hysteresis ?? 0;
              const release = active
                ? ['>', '>='].includes(comparator)
                  ? base - hysteresis
                  : ['<', '<='].includes(comparator)
                    ? base + hysteresis
                    : base
                : base;
              state = compare(value, release, comparator);
              baseline = base;
            }
            break;
          case 'custom':
            state = expression(rule.expression!, index, knownAt).state;
            threshold = null;
            score = null;
            break;
          case 'moving-average-crossover':
            {
              const short = averages!.short[index],
                long = averages!.long[index];
              const min = p.longWindow ?? 12;
              if (
                primaryReady[index] &&
                index >= min - 1 &&
                short !== null &&
                long !== null &&
                !gap
              ) {
                baseline = long;
                score = short;
                threshold = long;
                const previous = index > 0 ? averages!.short[index - 1] : null,
                  previousLong = index > 0 ? averages!.long[index - 1] : null;
                if (active) state = (p.direction ?? 'up') === 'down' ? short < long : short > long;
                else if (previous !== null && previousLong !== null)
                  state =
                    (p.direction ?? 'up') === 'down'
                      ? previous >= previousLong && short < long
                      : previous <= previousLong && short > long;
              }
            }
            break;
          case 'momentum':
            {
              const prior = finiteWindow(rows, index - w, index, knownAt, series);
              if (prior && index >= w) {
                const roc = relativeChange(prior[0], value).value;
                if (roc !== null) {
                  score = roc;
                  baseline = 0;
                  threshold = p.threshold ?? 0;
                  state = direction(roc, threshold, p.direction ?? 'down');
                }
              }
            }
            break;
          case 'anomaly':
            {
              const prior = finiteWindow(rows, index - w, index, knownAt, series);
              if (prior && prior.length >= 2) {
                baseline = p.method === 'mad' ? median(prior) : mean(prior);
                const scale =
                  p.method === 'mad'
                    ? median(prior.map((v) => Math.abs(v - baseline!)))! * 1.4826
                    : stddev(prior);
                if (scale !== null && scale > 0) {
                  score = (value - baseline!) / scale;
                  threshold = p.threshold ?? 3;
                  state = direction(score, threshold, p.direction ?? 'both');
                } else if (value === baseline) {
                  score = 0;
                  state = false;
                } else score = null;
              }
            }
            break;
          case 'variation-spike':
            {
              const recent = finiteWindow(rows, index - w + 1, index + 1, knownAt, series),
                prior = finiteWindow(rows, index - 2 * w + 1, index - w + 1, knownAt, series);
              if (recent && prior && w >= 2) {
                const current = stddev(recent)!,
                  past = stddev(prior)!;
                baseline = past;
                if (past > 0) {
                  score = current / past;
                  threshold = p.threshold ?? 2;
                  state = score > threshold;
                } else if (current === 0) {
                  score = 0;
                  state = false;
                } else score = null;
              }
            }
            break;
          case 'structural-change':
            {
              if (event.confirmation) {
                const previous = conditionMetadata.get(index);
                if (previous) ({ state, baseline, threshold, score } = previous);
                break;
              }
              baseline = p.mu0!;
              const k = p.k ?? 0.5,
                h = p.h!;
              hi = Math.max(0, hi + value - baseline - k);
              lo = Math.max(0, lo + baseline - value - k);
              score = Math.max(hi, lo);
              threshold = h;
              const up = hi > h,
                down = lo > h;
              state = p.direction === 'up' ? up : p.direction === 'down' ? down : up || down;
              if (p.reset === 'on-detect' && state && index >= latestPublishedIndex) {
                hi = 0;
                lo = 0;
              } else if (p.reset !== 'on-detect' && active) {
                const delta = value - baseline;
                state =
                  p.direction === 'up'
                    ? delta > k
                    : p.direction === 'down'
                      ? delta < -k
                      : Math.abs(delta) > k;
                if (!state) {
                  hi = 0;
                  lo = 0;
                }
              }
            }
            break;
          case 'seasonality-deviation':
            {
              const season = p.seasonLength ?? 12;
              if (index >= 2 * season) {
                const a = rows[index - season],
                  b = rows[index - 2 * season];
                if (
                  a?.quality === 'valid' &&
                  b?.quality === 'valid' &&
                  a.value !== null &&
                  b.value !== null &&
                  (!a.knownAt || a.knownAt <= knownAt) &&
                  (!b.knownAt || b.knownAt <= knownAt) &&
                  rows
                    .slice(index - 2 * season, index + 1)
                    .every(
                      (r, i, arr) =>
                        r.value !== null &&
                        r.quality === 'valid' &&
                        publicationTime(r) <= knownAt &&
                        (i === 0 || contiguous(arr[i - 1], r, series)),
                    )
                ) {
                  baseline = (a.value + b.value) / 2;
                  score = value - baseline;
                  threshold = p.tolerance ?? p.threshold ?? 0;
                  state = direction(score, threshold, p.direction ?? 'both');
                }
              }
            }
            break;
          case 'kpi-divergence':
            {
              const earlier = rows[index - w];
              const other = seriesPoint(rule.secondSeriesId!, o.time),
                before = earlier ? seriesPoint(rule.secondSeriesId!, earlier.time) : undefined;
              if (
                earlier?.value !== null &&
                earlier?.value !== undefined &&
                other?.value !== null &&
                other?.value !== undefined &&
                before?.value !== null &&
                before?.value !== undefined &&
                earlier.quality === 'valid' &&
                other.quality === 'valid' &&
                before.quality === 'valid' &&
                (!earlier.knownAt || earlier.knownAt <= knownAt) &&
                (!other.knownAt || other.knownAt <= knownAt) &&
                (!before.knownAt || before.knownAt <= knownAt) &&
                finiteWindow(rows, index - w, index + 1, knownAt, series) !== null &&
                (() => {
                  const second = model.series.find((item) => item.id === rule.secondSeriesId)!;
                  const start = positions(second.id).get(earlier.time);
                  const end = positions(second.id).get(o.time);
                  return (
                    start !== undefined &&
                    end !== undefined &&
                    end - start === w &&
                    finiteWindow(getRows(second.id), start, end + 1, knownAt, second) !== null
                  );
                })()
              ) {
                const a = relativeChange(earlier.value, value).value,
                  b = relativeChange(before.value, other.value).value;
                if (a !== null && b !== null) {
                  score = a - b;
                  baseline = b;
                  threshold = p.threshold ?? 0;
                  state = a * b < 0 && Math.abs(a - b) > threshold;
                }
              }
            }
            break;
        }
      }
      const detectionTime = knownAt;
      conditionStates[index] = state;
      if (!event.confirmation) {
        if (rule.family === 'structural-change')
          conditionMetadata.set(index, { state, baseline, threshold, score });
        if (state === 'unknown') unknown++;
        else evaluated++;
      }
      if (state === 'unknown' && rule.family === 'structural-change' && !event.confirmation)
        hi = lo = 0;
      // Late evidence can complete a current window, but an obsolete endpoint must
      // never replace or resolve a condition already based on newer observations.
      if (knownAt > planningCutoff || index < latestPublishedIndex) continue;
      if (state === 'unknown') streak = 0;
      else if (!state) streak = 0;
      else if (index !== previousCurrentIndex)
        streak = previousCurrentIndex === index - 1 && !gap ? streak + 1 : 1;
      previousCurrentIndex = index;
      let confirmed = state === true && (active || consecutive === 1 || streak >= consecutive);
      if (state === true && !confirmed && index + 1 >= consecutive) {
        confirmed = true;
        for (let offset = 0; offset < consecutive; offset++) {
          if (offset % 256 === 0) checkAnalysis(context);
          weightedWork++;
          requireAnalysis(
            weightedWork <= 50000000,
            'Confirmation checks exceed the 50-million weighted evaluation budget.',
            'rules',
            'IMPORT_LIMIT',
          );
          const position = index - offset;
          if (
            conditionStates[position] !== true ||
            publicationTime(rows[position]) > knownAt ||
            (offset > 0 && gaps[position + 1]) ||
            (['threshold', 'sustained'].includes(rule.family) &&
              (rows[position].value === null ||
                !compare(rows[position].value!, p.threshold ?? 0, p.comparator ?? '>')))
          ) {
            confirmed = false;
            break;
          }
        }
      }
      if (!active && confirmed && state === true && streak < consecutive) streak = consecutive;
      const eligible =
        (!options.from || o.time >= options.from) && (!options.to || o.time <= options.to);
      let signalState: AnalyticsSignal['state'] | undefined;
      if (!active && state === true && confirmed && index > cooldownUntil) {
        active = true;
        onsetTime = o.time;
        episodeId = signalEpisodeIdentity({
          ruleId: rule.id,
          ruleVersion: rule.version,
          dataVersion: dataset.version,
          seriesVersion,
          definitionFingerprint,
          dimensions: o.dimensions,
          onsetTime,
        });
        signalState = 'onset';
      } else if (active && state === false) {
        active = false;
        signalState = 'resolved';
        cooldownUntil = index + (p.cooldown ?? 0);
      } else if (active && state === true) signalState = 'active';
      if (signalState && eligible) {
        const eventId = signalEventIdentity(episodeId, signalState, o.time);
        if (publishedEvents.has(eventId)) continue;
        publishedEvents.add(eventId);
        totalEvents++;
        if (signalState === 'onset') episodeCount++;
        if (signals.length >= 10000) {
          dropped++;
          continue;
        }
        const prefix =
          rule.family === 'anomaly' && score === null
            ? 'A zero-scale baseline cannot quantify this deviation.'
            : signalState === 'resolved'
              ? 'The configured condition is no longer satisfied.'
              : `The ${rule.family} rule is ${signalState === 'onset' ? 'first confirmed' : 'still active'} after ${streak} valid contiguous period${streak === 1 ? '' : 's'}.`;
        const signal: AnalyticsSignal = {
          id: eventId,
          episodeId,
          ruleId: rule.id,
          ruleVersion: rule.version,
          seriesId: series.id,
          seriesVersion,
          definitionFingerprint,
          dimensions: { ...o.dimensions },
          dataVersion: dataset.version,
          interval: { from: options.from ?? rows[0].time, to: options.to ?? rows.at(-1)!.time },
          observationTime: o.time,
          onsetTime,
          detectedAt: detectionTime,
          state: signalState,
          value: o.value,
          deviationMagnitude: score,
          deviationUnit:
            rule.family === 'anomaly'
              ? 'standard deviations'
              : rule.family === 'variation-spike'
                ? 'variation ratio'
                : rule.family === 'momentum' || rule.family === 'kpi-divergence'
                  ? 'relative change'
                  : rule.family === 'structural-change'
                    ? `CUSUM (${series.unit.label})`
                    : series.unit.label,
          thresholdUnit:
            rule.family === 'anomaly'
              ? 'standard deviations'
              : rule.family === 'variation-spike'
                ? 'variation ratio'
                : rule.family === 'momentum' || rule.family === 'kpi-divergence'
                  ? 'relative change'
                  : rule.family === 'structural-change'
                    ? `CUSUM (${series.unit.label})`
                    : series.unit.label,
          baseline,
          threshold,
          unit: { ...series.unit },
          method: rule.family,
          parameters: { ...p },
          ...(rule.expression ? { expression: structuredClone(rule.expression) } : {}),
          ...(rule.secondSeriesId ? { secondSeriesId: rule.secondSeriesId } : {}),
          evidence: {
            observations: Math.min(index + 1, w),
            missing: state === 'unknown' ? 1 : 0,
            ...(o.denominator !== undefined ? { exposure: o.denominator } : {}),
          },
          quality: state === 'unknown' ? 'insufficient' : 'valid',
          explanation:
            prefix +
            (o.denominator === undefined ? ' No exposure-adjusted confidence is claimed.' : ''),
          severity: rule.severity,
        };
        signals.push(signal);
      }
    }
    if (dropped)
      notes.push(
        `${dropped} signal events were omitted by the 10,000-event publication limit; narrow the interval.`,
      );
    if (rule.family === 'seasonality-deviation' && rows.length <= 2 * (p.seasonLength ?? 12))
      notes.push(
        `${rule.name}: INSUFFICIENT_DATA; seasonality needs two complete historical cycles before comparison.`,
      );
    context?.progress?.(ruleIndex + 1, rules.length);
  }
  checkAnalysis(context);
  return {
    kind: 'signals',
    signals,
    totalEvents,
    omittedEvents: totalEvents - signals.length,
    episodeCount,
    evaluated,
    unknown,
    notes: [
      'Causal rules use trailing information. Gaps break confirmation, unknown does not mean false. Severity is user configured, not empirical confidence.',
      ...notes,
    ],
  };
}
