import type {
  AnalyticsExtension,
  AnalyticsRule,
  AnalyticsSeries,
  AnalyticsUnit,
  SignalExpression,
  SignalOperand,
} from './types';
import { requireAnalysis } from './validation';
import { unitsCompatible, indicatorUnit } from './units';

/** Each comparison retains its own unit; an AND can combine unlike KPI conditions. */
export function validateRuleSemantics(rule: AnalyticsRule, model: AnalyticsExtension) {
  const base = model.series.find((item) => item.id === rule.seriesId)!;
  const requireCalendar = (series: AnalyticsSeries) =>
    requireAnalysis(
      base.resolution === series.resolution &&
        base.timezone === series.timezone &&
        base.periodBoundary === series.periodBoundary,
      'Cross-series rules require matching resolution, time zone and period boundaries.',
      'rule.expression',
      'INCOMPATIBLE_UNITS',
    );
  if (rule.secondSeriesId)
    requireCalendar(model.series.find((item) => item.id === rule.secondSeriesId)!);
  function operand(value: SignalOperand): AnalyticsUnit | null {
    if (value.kind === 'constant') return null;
    if (value.kind === 'series') {
      const series = model.series.find((item) => item.id === value.seriesId)!;
      requireCalendar(series);
      return series.unit;
    }
    const indicator = model.indicators.find((item) => item.id === value.indicatorId)!;
    const series = model.series.find((item) => item.id === indicator.seriesId)!;
    requireCalendar(series);
    return indicatorUnit(series, indicator.kind);
  }
  function visit(node: SignalExpression) {
    if (node.kind === 'and' || node.kind === 'or') {
      node.children.forEach(visit);
      return;
    }
    if (node.kind === 'not' || node.kind === 'sustained') {
      visit(node.child);
      return;
    }
    if (node.kind === 'window') {
      operand(node.operand);
      return;
    }
    const left = operand(node.left),
      right = operand(node.right);
    requireAnalysis(
      !left || !right || unitsCompatible(left, right),
      'Compared operands require compatible units. Use separate AND conditions for unlike KPIs.',
      'rule.expression',
      'INCOMPATIBLE_UNITS',
    );
  }
  if (rule.expression) visit(rule.expression);
}
