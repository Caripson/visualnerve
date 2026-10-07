import { BaseEdge, type EdgeProps } from '@xyflow/react';

export function ProcessConnectionEdge({
  id,
  data,
  label,
  style,
  markerStart,
  markerEnd,
}: EdgeProps) {
  const resourceRequirement = data?.resourceRequirement === true;
  return (
    <g>
      {resourceRequirement && typeof label === 'string' && <title>{label}</title>}
      <BaseEdge
        id={id}
        path={String(data?.path ?? '')}
        label={resourceRequirement ? undefined : label}
        labelX={Number(data?.labelX ?? 0)}
        labelY={Number(data?.labelY ?? 0)}
        style={style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        labelStyle={{ fill: 'var(--text)', fontSize: 11 }}
        labelBgStyle={{ fill: 'var(--surface)' }}
        labelBgPadding={[5, 3]}
      />
    </g>
  );
}
