import { BaseEdge, type EdgeProps } from '@xyflow/react';
export function OverviewEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  style,
  markerStart,
  markerEnd,
  data,
  ...rest
}: EdgeProps) {
  const lane = Number(data?.lane ?? 0),
    loop = rest.source === rest.target;
  let path: string, x: number, y: number;
  if (loop) {
    const top = Math.min(sourceY, targetY) - 90 - lane * 28;
    path = `M ${sourceX} ${sourceY} C ${sourceX + 80} ${top}, ${targetX - 80} ${top}, ${targetX} ${targetY}`;
    x = (sourceX + targetX) / 2;
    y = top + 14;
  } else {
    const dx = targetX - sourceX,
      dy = targetY - sourceY,
      length = Math.max(1, Math.hypot(dx, dy));
    const bend = 24 + lane * 30,
      nx = (-dy / length) * bend,
      ny = (dx / length) * bend;
    path = `M ${sourceX} ${sourceY} C ${sourceX + dx / 3 + nx} ${sourceY + dy / 3 + ny}, ${sourceX + (dx * 2) / 3 + nx} ${sourceY + (dy * 2) / 3 + ny}, ${targetX} ${targetY}`;
    x = (sourceX + targetX) / 2 + nx * 0.75;
    y = (sourceY + targetY) / 2 + ny * 0.75;
  }
  return (
    <BaseEdge
      id={id}
      path={path}
      label={label}
      labelX={x}
      labelY={y}
      style={style}
      markerStart={markerStart}
      markerEnd={markerEnd}
      labelStyle={{ fill: 'var(--text)', fontSize: 12 }}
      labelBgStyle={{ fill: 'var(--surface)' }}
      labelBgPadding={[6, 4]}
    />
  );
}
