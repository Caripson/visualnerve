import { drawingBounds, strokePath } from './geometry';
import type { DrawingStroke } from './types';

/** Render inside a React Flow ViewportPortal: coordinates and pen widths scale with its viewport. */
export function DrawingSvg({
  strokes,
  draft = false,
}: {
  strokes: readonly DrawingStroke[];
  draft?: boolean;
}) {
  const bounds = drawingBounds(strokes);
  if (!bounds) return null;
  return (
    <svg
      className={draft ? 'drawing-draft' : 'drawing-layer'}
      data-testid={draft ? 'drawing-draft' : 'drawing-layer'}
      aria-hidden="true"
      width={bounds.width}
      height={bounds.height}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        overflow: 'visible',
        pointerEvents: 'none',
        // Nested groups can lift their children beyond the selected-node z-index.
        // This remains inside the viewport stack, below screen controls/panels.
        zIndex: 2147483647,
      }}
    >
      {strokes.map((stroke) =>
        stroke.points.length === 1 ? (
          <circle
            key={stroke.id}
            data-drawing-stroke-id={stroke.id}
            cx={stroke.points[0][0]}
            cy={stroke.points[0][1]}
            r={stroke.width / 2}
            fill={stroke.color}
          />
        ) : (
          <path
            key={stroke.id}
            data-drawing-stroke-id={stroke.id}
            d={strokePath(stroke.points)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}
