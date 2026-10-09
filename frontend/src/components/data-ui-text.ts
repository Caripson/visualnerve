import type { MessageId, Translate } from '../i18n';
import type { CsvColumnRule, CsvDataset } from '../data/types';
import type { QualityIssue } from '../data/quality';

const metricLabels: Readonly<Record<string, MessageId>> = {
  count: 'data.measure.count',
  sum: 'data.measure.sum',
  avg: 'data.measure.avg',
  median: 'data.measure.median',
  min: 'data.measure.min',
  max: 'data.measure.max',
  distinct: 'data.measure.distinct',
};
const filterLabels: Readonly<Record<string, MessageId>> = {
  equals: 'data.filter.equals',
  notEquals: 'data.filter.notEquals',
  startsWith: 'data.filter.startsWith',
  contains: 'data.filter.contains',
  gt: 'data.filter.gt',
  gte: 'data.filter.gte',
  lt: 'data.filter.lt',
  lte: 'data.filter.lte',
  empty: 'data.filter.empty',
  notEmpty: 'data.filter.notEmpty',
};
const dispositions: Readonly<Record<string, MessageId>> = {
  included: 'data.evidence.disposition.included',
  empty: 'data.evidence.disposition.empty',
  invalid: 'data.evidence.disposition.invalid',
  duplicate: 'data.evidence.disposition.duplicate',
};
const measureRules: Readonly<Record<string, MessageId>> = {
  count: 'data.measureEvidence.rule.count',
  sum: 'data.measureEvidence.rule.sum',
  avg: 'data.measureEvidence.rule.avg',
  median: 'data.measureEvidence.rule.median',
  min: 'data.measureEvidence.rule.min',
  max: 'data.measureEvidence.rule.max',
  distinct: 'data.measureEvidence.rule.distinct',
};

function knownLabel(value: string, labels: Readonly<Record<string, MessageId>>, t: Translate) {
  return Object.hasOwn(labels, value) ? t(labels[value]) : value;
}

/** Display adapters never rewrite stored operation names, source labels or worker results. */
export const metricOperationLabel = (operation: string, t: Translate) =>
  knownLabel(operation, metricLabels, t);
export const filterOperationLabel = (operation: string, t: Translate) =>
  knownLabel(operation, filterLabels, t);
export const evidenceDispositionLabel = (disposition: string, t: Translate) =>
  knownLabel(disposition, dispositions, t);

export function qualityIssueLabel(issue: QualityIssue, dataset: CsvDataset, t: Translate) {
  if (issue.kind === 'missing-key') return t('data.quality.issue.missingKey');
  if (issue.kind === 'duplicate-key') return t('data.quality.issue.duplicateKey');
  const column = dataset.columns.find((entry) => entry.id === issue.columnId);
  if (!column) return issue.label;
  switch (issue.kind) {
    case 'missing':
      return t('data.quality.issue.missing', { column: column.label });
    case 'invalid':
      return t('data.quality.issue.invalid', { column: column.label });
    case 'ambiguous':
      return t('data.quality.issue.ambiguous', { column: column.label });
    case 'collision':
      return t('data.quality.issue.collision', { column: column.label });
    default:
      return issue.label;
  }
}

export function measureRuleText(operation: string, originalRule: string, t: Translate) {
  return Object.hasOwn(measureRules, operation) ? t(measureRules[operation]) : originalRule;
}

export function cleanupRuleText(rule: CsvColumnRule, column: string, t: Translate) {
  const message = rule.pattern
    ? rule.trim !== false
      ? 'data.measureEvidence.cleanupTrimReplace'
      : 'data.measureEvidence.cleanupReplace'
    : rule.trim !== false
      ? 'data.measureEvidence.cleanupTrim'
      : 'data.measureEvidence.cleanupNumbers';
  return t(message, {
    column,
    pattern: rule.pattern ?? '',
    flags: rule.flags ?? '',
    replacement: JSON.stringify(rule.replacement ?? ''),
    format: rule.numberFormat ?? t('data.measureEvidence.autoFormat'),
  });
}
