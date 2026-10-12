import './edge.css';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { EdgeNotation, NotationDecoration } from './types';
import {
  notationConnectorPaths,
  notationDecoration,
  notationEdgeAppearance,
} from './edge-geometry';

function Marker({
  id,
  value,
  hatched = false,
  ribbon = hatched,
}: {
  id: string;
  value: NotationDecoration;
  hatched?: boolean;
  ribbon?: boolean;
}) {
  const geometry = notationDecoration(value, hatched, ribbon);
  return (
    <marker
      id={id}
      viewBox="-1 -1 12 12"
      refX={10}
      refY={5}
      markerWidth={12}
      markerHeight={12}
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      <path
        d={geometry.path}
        fill={
          geometry.fill === 'foreground'
            ? 'context-stroke'
            : geometry.fill === 'background'
              ? 'var(--surface)'
              : 'none'
        }
        stroke="context-stroke"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {geometry.detailPaths.map((d, index) => (
        <path key={index} d={d} fill="none" stroke="context-stroke" strokeWidth={1} />
      ))}
    </marker>
  );
}
export function NotationEdge(props: EdgeProps) {
  const notation = props.data?.notation as EdgeNotation;
  const context = { sourceIsGateway: props.data?.sourceIsGateway === true };
  const appearance = notationEdgeAppearance(notation, context);
  const [smooth, x, y] = getSmoothStepPath(props);
  const path = notation.waypoints?.length
    ? `M ${props.sourceX} ${props.sourceY} ${notation.waypoints.map(([px, py]) => `L ${px} ${py}`).join(' ')} L ${props.targetX} ${props.targetY}`
    : smooth;
  const geometry = notationConnectorPaths(notation, path, context);
  const start = `notation-start-${props.id}`,
    end = `notation-end-${props.id}`;
  const stroke = String(props.style?.stroke ?? '#8a9694');
  const style = {
    '--notation-stroke-width': `${Math.max(geometry.strokeWidth, Number(props.style?.strokeWidth ?? 0))}px`,
    ...props.style,
    strokeWidth: appearance.heavy
      ? Math.max(geometry.strokeWidth, Number(props.style?.strokeWidth ?? 0))
      : props.style?.strokeWidth,
    strokeDasharray:
      appearance.line === 'dashed' ? '7 4' : appearance.line === 'dotted' ? '2 4' : undefined,
  };
  const source = [notation.sourceLabel, notation.sourceMultiplicity].filter(Boolean).join(' ');
  const target = [notation.targetLabel, notation.targetMultiplicity].filter(Boolean).join(' ');
  return (
    <>
      <defs>
        <Marker id={start} value={appearance.sourceDecoration} />
        <Marker
          id={end}
          value={appearance.targetDecoration}
          hatched={appearance.hatch}
          ribbon={appearance.ribbon}
        />
      </defs>
      {(appearance.double || appearance.ribbon) &&
        geometry.strokePaths.map((d, index) => (
          <path
            key={index}
            className="notation-edge-stroke"
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={Number(props.style?.strokeWidth ?? 1.6)}
            pointerEvents="none"
          />
        ))}
      <BaseEdge
        id={props.id}
        className={
          appearance.double || appearance.ribbon
            ? 'notation-edge-guide'
            : appearance.heavy
              ? 'notation-edge-heavy'
              : undefined
        }
        path={geometry.path}
        label={props.label}
        labelX={x}
        labelY={y}
        style={appearance.double || appearance.ribbon ? { ...style, strokeWidth: 0 } : style}
        markerStart={appearance.sourceDecoration !== 'none' ? `url(#${start})` : undefined}
        markerEnd={appearance.targetDecoration !== 'none' ? `url(#${end})` : undefined}
        labelStyle={{ fill: 'var(--text)', fontSize: 11 }}
        labelBgStyle={{ fill: 'var(--surface)' }}
        labelBgPadding={[5, 3]}
      />
      {geometry.detailPaths.map((d, index) => (
        <path
          key={index}
          className="notation-edge-stroke"
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={appearance.hatch ? 1 : 1.5}
          pointerEvents="none"
        />
      ))}
      {source && (
        <text x={props.sourceX + 16} y={props.sourceY - 10} fill="var(--text)" fontSize={11}>
          {source}
        </text>
      )}
      {target && (
        <text
          x={props.targetX - 16}
          y={props.targetY - 10}
          textAnchor="end"
          fill="var(--text)"
          fontSize={11}
        >
          {target}
        </text>
      )}
    </>
  );
}
