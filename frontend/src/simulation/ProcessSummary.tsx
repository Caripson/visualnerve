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
  return (
    <div
      className="simulation-process-summary"
      data-simulation-process={id}
      data-traffic={traffic.level}
      data-queue={metrics?.queue.current ?? 0}
    >
      <span className="simulation-traffic-badge" title={traffic.reason}>
        <span aria-hidden="true">
          {traffic.level === 'congested'
            ? '!'
            : traffic.level === 'busy'
              ? '◷'
              : traffic.level === 'inactive'
                ? '·'
                : '✓'}
        </span>{' '}
        {traffic.label}
      </span>
      {!boundary && (
        <span className="simulation-process-members">
          {nodeCount} {nodeCount === 1 ? 'step' : 'steps'}
          {childCount ? ` · ${childCount} ${childCount === 1 ? 'subprocess' : 'subprocesses'}` : ''}
        </span>
      )}
      {node.metadata.simulationProcessBoundary === true && (
        <span className="simulation-process-context">
          {node.metadata.simulationProcessBoundaryKind === 'ancestor'
            ? 'Parent context · includes this process'
            : 'Connected process outside this view'}
        </span>
      )}
      {boundary ? (
        <span>
          Queue {metrics?.queue.current ?? 0} · in process {metrics?.inSystem ?? 0}
        </span>
      ) : metrics ? (
        <>
          <div className="simulation-process-values">
            <span>
              <small>Queue</small>
              <strong>{metrics.queue.current}</strong>
            </span>
            <span>
              <small>In process</small>
              <strong>{metrics.inSystem}</strong>
            </span>
            <span>
              <small>Completed</small>
              <strong>{metrics.completed}</strong>
            </span>
          </div>
          <span>
            {(metrics.currentUtilization * 100).toFixed(0)}% busy · avg wait{' '}
            {(metrics.queue.wait.average / 60).toFixed(1)} min
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
          <span title="Child step operations and occupied shared-resource units. Parent totals include subprocesses; do not add parent and child totals. Idle shared-resource costs remain in system totals.">
            Cycle {(metrics.cycleTime.average / 60).toFixed(1)} min · cost {metrics.cost.toFixed(2)}{' '}
            {model.currency}
          </span>
          <span className="simulation-process-bottleneck" title={traffic.reason}>
            Constraint:{' '}
            {bottleneck ? bottleneck.name : (metrics.currentBottleneck ?? 'none observed')}
          </span>
        </>
      ) : (
        <p className="simulation-process-description">
          {process?.description ||
            'Open this process to configure each step and inspect where work waits.'}
        </p>
      )}
      {!exporting && diagramId && (
        <button
          className="nodrag nopan"
          aria-label={`Open process ${process?.name ?? node.title}`}
          onClick={(event) => {
            event.stopPropagation();
            openSimulationProcess(diagramId, id);
          }}
        >
          Open process <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
