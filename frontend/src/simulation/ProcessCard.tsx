import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers } from 'lucide-react';
import type { CanvasNode } from '../canvas/projection';
import { ProcessSummary } from './ProcessSummary';

export const ProcessCard = memo(({ id, data }: NodeProps<CanvasNode>) => (
  <div
    className="vn-node shape-box simulation-process-card"
    data-testid="graph-node"
    data-node-id={id}
    data-simulation-projected="true"
    data-simulation-process-id={data.node.metadata.simulationProcessId as string}
    style={{ '--node-accent': data.node.color || '#31766c' } as React.CSSProperties}
  >
    <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
    <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
    <Handle type="target" position={Position.Top} id="in-top" isConnectable={false} />
    <Handle type="source" position={Position.Bottom} id="out-bottom" isConnectable={false} />
    <Handle type="target" position={Position.Bottom} id="in-bottom" isConnectable={false} />
    <Handle type="source" position={Position.Top} id="out-top" isConnectable={false} />
    <div className="node-topline">
      <Layers size={14} />
      <span className="node-kind">Process group</span>
    </div>
    <div className="node-title">{data.node.title}</div>
    <ProcessSummary node={data.node} exporting={data.exporting} />
  </div>
));
ProcessCard.displayName = 'ProcessCard';
