import { useEffect, type CSSProperties } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { ibmPortPoint, type IBMPortSide } from './ibm-ports';
import type { IBMSymbolId } from './ibm-symbols';

const transform: Record<IBMPortSide, string> = {
  left: 'translate(0, -50%)',
  right: 'translate(-100%, -50%)',
  top: 'translate(-50%, 0)',
  bottom: 'translate(-50%, -100%)',
};

export function IbmNodePorts({
  id,
  symbol,
  width,
  height,
  connectable,
  exporting,
  layoutProjected,
}: {
  id: string;
  symbol: IBMSymbolId;
  width: number;
  height: number;
  connectable: boolean;
  exporting: boolean;
  layoutProjected: boolean;
}) {
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    if (exporting) return;
    updateInternals(id);
    // Clearing the symbol restores ordinary ports at the same node dimensions.
    return () => updateInternals(id);
  }, [id, symbol, width, height, exporting, layoutProjected, updateInternals]);
  const style = (side: IBMPortSide): CSSProperties => {
    const [x, y] = ibmPortPoint(symbol, side);
    return {
      left: `${Number((x * 100).toFixed(6))}%`,
      top: `${Number((y * 100).toFixed(6))}%`,
      right: 'auto',
      bottom: 'auto',
      // React Flow routes to the handle's outside edge, rather than its center.
      transform: transform[side],
    };
  };
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={style('left')}
        isConnectable={connectable}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={style('right')}
        isConnectable={connectable}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="in-top"
        style={style('top')}
        isConnectable={connectable}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="out-bottom"
        style={style('bottom')}
        isConnectable={connectable}
      />
      {layoutProjected && (
        <>
          <Handle
            type="target"
            position={Position.Bottom}
            id="in-bottom"
            style={style('bottom')}
            isConnectable={false}
          />
          <Handle
            type="source"
            position={Position.Top}
            id="out-top"
            style={style('top')}
            isConnectable={false}
          />
        </>
      )}
    </>
  );
}
