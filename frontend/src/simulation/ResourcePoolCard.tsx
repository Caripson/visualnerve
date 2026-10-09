import { nodeTrafficReason, trafficStatusLabel } from './display';
import { useI18n } from '../i18n';
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Users } from 'lucide-react';
import type { CanvasNode } from '../canvas/projection';
import { useSimulationSummary } from './summary-context';
import { logicalNodeId } from './render-model';
import { simulationNodeTraffic } from './traffic';
import './process-hierarchy.css';

/** One shared pool, with genuine occupied units; no duplicated resource or logical Work. */
export const ResourcePoolCard = memo(({ id, data }: NodeProps<CanvasNode>) => {
  const { t } = useI18n();
  const { model, view } = useSimulationSummary();
  if (!model) return null;
  const logicalId = logicalNodeId(data.node);
  const config = model.nodes.find((node) => node.id === logicalId);
  if (config?.type !== 'resource') return null;
  const resource = model.resources.find((entry) => entry.id === config.resourceId);
  const metric = view?.state?.resources[config.resourceId];
  const capacity =
    metric?.capacity ??
    Number(data.node.metadata.simulationResourceCapacity ?? resource?.capacity ?? 0);
  const busy = metric?.busy ?? 0;
  const traffic = simulationNodeTraffic(config, view?.state, model);
  return (
    <div
      className="vn-node simulation-pool-card"
      data-testid="graph-node"
      data-node-id={id}
      data-simulation-projected="true"
      data-simulation-logical-node={logicalId}
    >
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="in-top" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="out-bottom" isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="in-bottom" isConnectable={false} />
      <Handle type="source" position={Position.Top} id="out-top" isConnectable={false} />
      <div className="node-topline">
        <Users size={12} />
        <span className="node-kind">{t('simulator.canvas.resource.sharedPool')}</span>
      </div>
      <div className="node-title" title={resource?.name}>
        {resource?.name ?? data.node.title}
      </div>
      <div
        className="simulation-pool-summary"
        data-simulation-node={id}
        data-simulation-logical-node={logicalId}
        data-traffic={traffic.level}
        data-queue={metric?.queue.current ?? 0}
      >
        <span className="simulation-traffic-badge" title={nodeTrafficReason(t, traffic)}>
          {traffic.level === 'congested' ? '! ' : traffic.level === 'busy' ? '◷ ' : ''}
          {trafficStatusLabel(t, traffic.label)}
        </span>
        <div className="simulation-pool-values">
          <span>
            <small>{t('simulator.common.capacity')}</small>
            <strong>{capacity}</strong>
          </span>
          <span>
            <small>{t('simulator.canvas.resource.busy')}</small>
            <strong>{busy}</strong>
          </span>
          <span>
            <small>{t('simulator.canvas.resource.queued')}</small>
            <strong>{metric?.queue.current ?? 0}</strong>
          </span>
        </div>
        <div
          className="simulation-pool-units"
          aria-label={t('simulator.canvas.resource.busyOfCapacityUnits', {
            busy: String(busy),
            capacity: String(capacity),
          })}
        >
          {Array.from({ length: Math.min(capacity, 8) }, (_, index) => (
            <i key={index} data-occupied={index < busy} />
          ))}
          {capacity > 8 && <span>+{capacity - 8}</span>}
        </div>
      </div>
    </div>
  );
});
ResourcePoolCard.displayName = 'ResourcePoolCard';
