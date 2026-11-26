import { Handle, Position, useStore } from '@xyflow/react';
import { cardPortId, type CardSide } from './card-ports';

const positions: Record<CardSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};
// Edges with no saved handle use the first handle of each type.
const incoming = ['left', 'right', 'top', 'bottom'] as const;
const outgoing = ['right', 'left', 'bottom', 'top'] as const;

/** One visible connection point per side, with separate incoming and outgoing anchors. */
export function CardPorts({
  connectable,
  topic = false,
}: {
  connectable: boolean;
  topic?: boolean;
}) {
  const fromRole = useStore(
    (state) => state.connection?.fromHandle?.type ?? state.connectionClickStartHandle?.type,
  );
  return (
    <>
      {incoming.map((side) => (
        <Handle
          key={`target-${side}`}
          className="card-port card-port-target"
          type="target"
          id={cardPortId(side, 'target', topic)}
          position={positions[side]}
          isConnectable={connectable}
          isConnectableStart={false}
          isConnectableEnd={fromRole !== 'target'}
        />
      ))}
      {outgoing.map((side) => (
        <Handle
          key={`source-${side}`}
          className="card-port"
          type="source"
          id={cardPortId(side, 'source', topic)}
          position={positions[side]}
          isConnectable={connectable}
          isConnectableEnd={fromRole !== 'source'}
        />
      ))}
    </>
  );
}
