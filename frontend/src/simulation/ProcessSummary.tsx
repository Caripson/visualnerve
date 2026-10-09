import { processTrafficReason, trafficStatusLabel } from './display';
import { useI18n } from '../i18n';
import type { CSSProperties } from 'react';
import type { GraphNode } from '../model/types';
import { useSimulationSummary } from './summary-context';
import { getSimulationProcessId } from './process-projection';
import { openSimulationProcess } from './process-navigation';
import { simulationProcessTraffic } from './process-traffic';
export { simulationProcessTraffic } from './process-traffic';
import './process-hierarchy.css';

export function ProcessSummary({
  node,
  exporting = false,
}: {
  node: GraphNode;
  exporting?: boolean;
}) {
  const { t, plural } = useI18n();
  const { diagramId, model, view } = useSimulationSummary();
  const id = getSimulationProcessId(node);
  if (!id || !model) return null;
  const process = model.processes?.find((entry) => entry.id === id);
  const metrics = view?.state?.processes?.[id];
  const traffic = simulationProcessTraffic(id, model, view?.state);
  const childCount = Number(node.metadata.simulationProcessChildren) || 0;
  const nodeCount = Array.isArray(node.metadata.simulationProcessNodeIds)
    ? node.metadata.simulationProcessNodeIds.length
    : 0;
  const boundary = node.metadata.simulationProcessBoundary === true;
  const bottleneck =
    metrics?.currentBottleneck &&
    (view?.state?.nodes[metrics.currentBottleneck] ??
      view?.state?.resources[metrics.currentBottleneck]);
  const trafficLabel = trafficStatusLabel(t, traffic.label);
  const trafficReason = processTrafficReason(
    t,
    traffic,
    bottleneck ? bottleneck.name : (metrics?.currentBottleneck ?? undefined),
  );
  return (
    <div
      className="simulation-process-summary"
      data-simulation-process={id}
      data-traffic={traffic.level}
      data-queue={metrics?.queue.current ?? 0}
    >
      <span className="simulation-traffic-badge" title={trafficReason}>
        <span aria-hidden="true">
          {traffic.level === 'congested'
            ? '!'
            : traffic.level === 'busy'
              ? '◷'
              : traffic.level === 'inactive'
                ? '·'
                : '✓'}
        </span>{' '}
        {trafficLabel}
      </span>
      {!boundary && (
        <span className="simulation-process-members">
          {plural(
            'simulator.hierarchy.members.steps.one',
            'simulator.hierarchy.members.steps.other',
            nodeCount,
          )}
          {childCount
            ? plural(
                'simulator.hierarchy.members.subprocesses.one',
                'simulator.hierarchy.members.subprocesses.other',
                childCount,
              )
            : ''}
        </span>
      )}
      {node.metadata.simulationProcessBoundary === true && (
        <span className="simulation-process-context">
          {node.metadata.simulationProcessBoundaryKind === 'ancestor'
            ? t('simulator.hierarchy.summary.parentContextIncludesThisProcess')
            : t('simulator.hierarchy.summary.connectedProcessOutsideThisView')}
        </span>
      )}
      {boundary ? (
        <span>
          {t('simulator.hierarchy.queue.summary', {
            queueCount: metrics?.queue.current ?? 0,
            inSystemCount: metrics?.inSystem ?? 0,
          })}
        </span>
      ) : metrics ? (
        <>
          <div className="simulation-process-values">
            <span>
              <small>{t('simulator.common.queue')}</small>
              <strong>{metrics.queue.current}</strong>
            </span>
            <span>
              <small>{t('simulator.hierarchy.summary.inProcess.')}</small>
              <strong>{metrics.inSystem}</strong>
            </span>
            <span>
              <small>{t('simulator.common.completed')}</small>
              <strong>{metrics.completed}</strong>
            </span>
          </div>
          <span>
            {t('simulator.hierarchy.utilization.summary', {
              utilizationPercent: (metrics.currentUtilization * 100).toFixed(0),
              minutes: (metrics.queue.wait.average / 60).toFixed(1),
            })}
          </span>
          <span
            className="simulation-utilization-track"
            aria-hidden="true"
            style={
              {
                '--simulation-utilization': `${Math.min(100, Math.max(0, metrics.currentUtilization * 100))}%`,
              } as CSSProperties
            }
          >
            <span />
          </span>
          <span
            title={t(
              'simulator.hierarchy.summary.childStepOperationsAndOccupiedSharedResourceUnitsParentTotalsIncludeSubprocesses',
            )}
          >
            {t('simulator.hierarchy.cycleCost.summary', {
              minutes: (metrics.cycleTime.average / 60).toFixed(1),
              cost: metrics.cost.toFixed(2),
              currency: model.currency,
            })}
          </span>
          <span className="simulation-process-bottleneck" title={trafficReason}>
            {t('simulator.hierarchy.summary.constraint')}
            {bottleneck
              ? bottleneck.name
              : (metrics.currentBottleneck ?? t('simulator.hierarchy.summary.noneObserved'))}
          </span>
        </>
      ) : (
        <p className="simulation-process-description">
          {process?.description ||
            t(
              'simulator.hierarchy.summary.openThisProcessToConfigureEachStepAndInspectWhereWorkWaits',
            )}
        </p>
      )}
      {!exporting && diagramId && (
        <button
          className="nodrag nopan"
          aria-label={t('simulator.hierarchy.summary.openProcess', {
            title: String(process?.name ?? node.title),
          })}
          onClick={(event) => {
            event.stopPropagation();
            openSimulationProcess(diagramId, id);
          }}
        >
          {t('simulator.hierarchy.summary.openProcess.')} <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
