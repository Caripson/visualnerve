import type {
  AnalyticsExtension,
  BacktestConfig,
  BacktestResult,
  BacktestRuleResult,
  AnalysisContext,
} from './types';
import { evaluateSignals, compare } from './signals';
import { querySeries, checkAnalysis, DAY_MS, contiguous, lexical } from './series';
import { metric, mean } from './math';
import { requireAnalysis, validateAnalytics } from './validation';
export function backtest(
  model: AnalyticsExtension,
  config: BacktestConfig,
  context?: AnalysisContext,
): BacktestResult {
  checkAnalysis(context);
  validateAnalytics({ ...model, backtests: [config] });
  const results: BacktestRuleResult[] = [],
    notes: string[] = [];
  const rules = config.ruleIds.map((id) => model.rules.find((r) => r.id === id)!);
  const splits: {
    name: BacktestRuleResult['split'];
    from: string;
    to: string;
    exclusiveStart?: boolean;
  }[] = [
    { name: 'train', from: config.from, to: config.trainEnd },
    { name: 'validation', from: config.trainEnd, to: config.validationEnd, exclusiveStart: true },
    { name: 'holdout', from: config.holdoutStart, to: config.to },
  ];
  const outcomeRows = config.outcome
    ? querySeries(model, config.outcome.seriesId, { to: config.to }, context)
    : [];
  const outcomeOnsets = config.outcome
    ? outcomeRows.flatMap((o, i) =>
        o.value !== null &&
        o.quality === 'valid' &&
        compare(o.value, config.outcome!.threshold, config.outcome!.comparator) &&
        (i === 0 ||
          outcomeRows[i - 1].value === null ||
          !compare(
            outcomeRows[i - 1].value!,
            config.outcome!.threshold,
            config.outcome!.comparator,
          ))
          ? [i]
          : [],
      )
    : [];
  let selectedRuleId: string | undefined;
  for (const split of splits) {
    const chosen =
      split.name === 'holdout'
        ? [
            ...new Set([
              selectedRuleId ?? rules[0].id,
              ...(config.baselineRuleId ? [config.baselineRuleId] : []),
            ]),
          ].map((id) => model.rules.find((r) => r.id === id)!)
        : rules;
    for (const rule of chosen) {
      checkAnalysis(context);
      requireAnalysis(rule, 'Unknown baseline rule.');
      const source = querySeries(model, rule.seriesId, { to: split.to, cutoff: split.to }, context);
      const availableTime = (o: (typeof source)[number]) =>
        o.knownAt && o.knownAt > o.time ? o.knownAt : o.time;
      const eligible = source.filter(
        (o) =>
          availableTime(o) >= split.from &&
          (!split.exclusiveStart || availableTime(o) > split.from) &&
          availableTime(o) <= split.to,
      );
      requireAnalysis(
        (Math.ceil(eligible.length / config.walkForwardPeriods) + 1) * source.length <= 20000000,
        'Signal Lab prefix folds exceed the 20-million-observation replay budget. Increase fold size or narrow the interval.',
        undefined,
        'IMPORT_LIMIT',
      );
      const combined = new Map<string, ReturnType<typeof evaluateSignals>['signals'][number]>();
      let exposedPeriods = 0,
        evaluablePeriods = 0;
      const cutoffs: string[] = [];
      for (let start = 0; start < eligible.length; start += config.walkForwardPeriods)
        cutoffs.push(
          availableTime(eligible[Math.min(eligible.length, start + config.walkForwardPeriods) - 1]),
        );
      // A secondary KPI may publish after the last primary observation. Replay the
      // split boundary as well, including splits containing no new primary rows.
      if (cutoffs.at(-1) !== split.to) cutoffs.push(split.to);
      /** Each fold evaluates a prefix. Baselines/transforms never see a later fold. */
      for (const cutoff of [...new Set(cutoffs)].sort()) {
        const signal = evaluateSignals(
          model,
          { ruleIds: [rule.id], to: cutoff },
          { ...context, cutoff },
        );
        requireAnalysis(
          signal.omittedEvents === 0,
          'Signal Lab cannot evaluate a truncated event history. Narrow the interval or adjust the rule; no predictive metrics were computed.',
          undefined,
          'IMPORT_LIMIT',
        );
        for (const event of signal.signals)
          if (
            event.detectedAt >= split.from &&
            (!split.exclusiveStart || event.detectedAt > split.from) &&
            event.detectedAt <= cutoff
          )
            combined.set(event.id, event);
      }
      const events = [...combined.values()],
        onsets = events.filter((e) => e.state === 'onset');
      exposedPeriods = eligible.length;
      evaluablePeriods = eligible.filter((o) => o.value !== null && o.quality === 'valid').length;
      const item: BacktestRuleResult = {
        ruleId: rule.id,
        split: split.name,
        signals: events.length,
        episodes: onsets.length,
        activePeriods: events.filter((e) => e.state !== 'resolved').length,
        exposedPeriods,
        evaluablePeriods,
        detectionDelay: metric(
          mean(
            onsets.map((s) => (Date.parse(s.detectedAt) - Date.parse(s.observationTime)) / DAY_MS),
          ),
        ),
      };
      if (config.outcome) {
        const usedOutcomes = new Set<number>();
        let matchedSignals = 0,
          eligibleSignals = 0;
        const horizon = config.outcome.horizon;
        const inSplitOutcomes = outcomeOnsets.filter(
          (index) =>
            outcomeRows[index].time >= split.from &&
            (!split.exclusiveStart || outcomeRows[index].time > split.from) &&
            outcomeRows[index].time <= split.to &&
            (!outcomeRows[index].knownAt || outcomeRows[index].knownAt! <= split.to),
        );
        for (const event of onsets) {
          let start = -1;
          for (let i = 0; i < outcomeRows.length && outcomeRows[i].time <= event.detectedAt; i++)
            start = i;
          if (event.detectedAt > split.to) continue;
          if (start < 0 || start + horizon >= outcomeRows.length) continue;
          const future = outcomeRows.slice(start + 1, start + horizon + 1);
          if (
            future.length !== horizon ||
            future.some(
              (o) =>
                o.time > split.to ||
                o.value === null ||
                o.quality !== 'valid' ||
                (o.knownAt && o.knownAt > split.to),
            )
          )
            continue;
          const outcomeSeries = model.series.find((s) => s.id === config.outcome!.seriesId)!;
          if (
            future.some(
              (o, index) =>
                !contiguous(index === 0 ? outcomeRows[start] : future[index - 1], o, outcomeSeries),
            )
          )
            continue;
          eligibleSignals++;
          const match = inSplitOutcomes.find(
            (index) => index > start && index <= start + horizon && !usedOutcomes.has(index),
          );
          if (match !== undefined) {
            usedOutcomes.add(match);
            matchedSignals++;
          }
        }
        item.matchedSignals = matchedSignals;
        item.matchedOutcomes = usedOutcomes.size;
        item.outcomeCount = inSplitOutcomes.length;
        item.evaluablePeriods = eligibleSignals;
        item.precision = metric(
          eligibleSignals ? matchedSignals / eligibleSignals : null,
          'No complete future outcome windows are available.',
        );
        item.recall = metric(
          inSplitOutcomes.length ? usedOutcomes.size / inSplitOutcomes.length : null,
          'No defined outcome episodes are available.',
        );
        item.falseAlarms = eligibleSignals - matchedSignals;
      }
      results.push(item);
    }
    if (split.name === 'validation') {
      const candidates = results.filter((r) => r.split === 'validation');
      selectedRuleId = config.outcome
        ? [...candidates].sort(
            (a, b) =>
              (b.precision?.value ?? -1) - (a.precision?.value ?? -1) ||
              a.episodes - b.episodes ||
              lexical(a.ruleId, b.ruleId),
          )[0]?.ruleId
        : rules[0].id;
    }
  }
  const retrospective = model.datasets.some((d) => d.revisionHistory === 'unavailable');
  notes.push(
    'Fixed rule parameters are replayed in time-ordered prefix folds. There is no random shuffle or future fitting. Train and validation results are search evidence; only the selected rule and optional baseline touch holdout.',
  );
  if (!config.outcome)
    notes.push(
      'No outcome was defined: this is signal-history replay; precision, recall and false alarms are intentionally absent. Selection defaults to the first configured rule, not a claimed best rule.',
    );
  if (retrospective)
    notes.push(
      'Retrospective analysis on currently available data: historical revision/publication versions are unavailable. This does not prove what was knowable then.',
    );
  notes.push(
    `${config.trials} parameter/rule ${config.trials === 1 ? 'trial is' : 'trials are'} recorded; search performance is not an untouched holdout claim. Outcome onsets and signal episodes use one-to-one matching; incomplete future windows are excluded.`,
  );
  checkAnalysis(context);
  return {
    kind: 'backtest',
    configId: config.id,
    results,
    selectedRuleId,
    trials: config.trials,
    retrospective,
    notes,
  };
}
