import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Users } from 'lucide-react';
import type { CanvasNode } from '../canvas/projection';
import { useEditor } from '../state/editor';
import { useSimulation } from './useSimulation';
import { logicalNodeId, resolveSimulationRenderModel } from './render-model';
import { simulationNodeTraffic } from './traffic';
import './process-hierarchy.css';

/** One shared pool, with genuine occupied units; no duplicated resource or logical Work. */
export const ResourcePoolCard = memo(({ id, data }: NodeProps<CanvasNode>) => {
  const graph = useEditor((state) => state.graph);
  const view = useSimulation(graph?.simulation ? graph.diagram.id : undefined);
  if (!graph?.simulation) return null;
  const model = resolveSimulationRenderModel(
    view?.run.model ?? graph.simulation,
    view?.run.options,
  );
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
        <span className="node-kind">Shared pool</span>
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
        <span className="simulation-traffic-badge" title={traffic.reason}>
          {traffic.level === 'congested' ? '! ' : traffic.level === 'busy' ? '◷ ' : ''}
          {traffic.label}
        </span>
        <div className="simulation-pool-values">
          <span>
            <small>Capacity</small>
            <strong>{capacity}</strong>
          </span>
          <span>
            <small>Busy</small>
            <strong>{busy}</strong>
          </span>
          <span>
            <small>Queued</small>
            <strong>{metric?.queue.current ?? 0}</strong>
          </span>
        </div>
        <div
          className="simulation-pool-units"
          aria-label={`${busy} busy of ${capacity} capacity units`}
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
