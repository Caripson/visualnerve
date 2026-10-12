import { Fragment, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeNotation, NotationSide } from './types';
import { notationGeometry } from './geometry';

const positions: Record<NotationSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};
export function NotationNodePorts({
  id,
  value,
  width,
  height,
  connectable,
  exporting,
  mindmap,
}: {
  id: string;
  value: NodeNotation;
  width: number;
  height: number;
  connectable: boolean;
  exporting: boolean;
  mindmap: boolean;
}) {
  const update = useUpdateNodeInternals();
  const geometry = notationGeometry(value);
  useEffect(() => {
    if (!exporting) update(id);
  }, [id, value, width, height, exporting, update]);
  const anchors = geometry.anchors;
  return (
    <>
      {anchors.map((anchor) => {
        const style = {
          left: `${anchor.x * 100}%`,
          top: `${anchor.y * 100}%`,
          right: 'auto',
          bottom: 'auto',
          transform: 'translate(-50%, -50%)',
        };
        const port = value.ports?.find((item) => item.id === anchor.id);
        const incoming = port?.direction !== 'out',
          outgoing = port?.direction !== 'in';
        const standard = !port;
        return (
          <Fragment key={anchor.id}>
            {incoming && (
              <Handle
                type="target"
                id={
                  standard
                    ? anchor.side === 'left'
                      ? 'in'
                      : `in-${anchor.side}`
                    : `in-port-${anchor.id}`
                }
                position={positions[anchor.side]}
                style={style}
                isConnectable={connectable}
                aria-label={port?.label ?? `${anchor.side} incoming`}
              />
            )}
            {outgoing && (
              <Handle
                type="source"
                id={
                  standard
                    ? anchor.side === 'right'
                      ? 'out'
                      : `out-${anchor.side}`
                    : `out-port-${anchor.id}`
                }
                position={positions[anchor.side]}
                style={style}
                isConnectable={connectable}
                aria-label={port?.label ?? `${anchor.side} outgoing`}
              />
            )}
            {mindmap && standard && (
              <>
                <Handle
                  type="target"
                  id={`target-${anchor.side}`}
                  position={positions[anchor.side]}
                  style={style}
                  isConnectable={connectable}
                />
                <Handle
                  type="source"
                  id={`source-${anchor.side}`}
                  position={positions[anchor.side]}
                  style={style}
                  isConnectable={connectable}
                />
              </>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
