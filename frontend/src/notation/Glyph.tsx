import type { NodeNotation } from './types';
import { notationGeometry } from './geometry';

export function NotationGlyph({
  value,
  className,
  size,
}: {
  value: NodeNotation;
  className?: string;
  size?: number;
}) {
  const shape = notationGeometry(value);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ overflow: 'visible' }}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={shape.outlinePath}
        className={`notation-outline fill-${shape.outlineFill}`}
        strokeDasharray={shape.stroke === 'dashed' ? '5 3' : undefined}
        strokeWidth={shape.strokeWidth ?? 1.5}
        vectorEffect="non-scaling-stroke"
      />
      {shape.shadedPaths?.map((path, index) => (
        <path key={`shade-${index}`} d={path} className="notation-shade" />
      ))}
      {shape.detailPaths.map((path, index) => (
        <path
          key={`detail-${index}`}
          d={path}
          className="notation-detail"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shape.dashedPaths?.map((path, index) => (
        <path
          key={`dash-${index}`}
          d={path}
          className="notation-detail"
          strokeDasharray="5 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shape.filledPaths.map((path, index) => (
        <path
          key={`fill-${index}`}
          d={path}
          className="notation-fill"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shape.contrastPaths?.map((path, index) => (
        <path
          key={`contrast-${index}`}
          d={path}
          className="notation-contrast"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
