import { Position, type EdgeProps } from '@xyflow/react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { selfLoopPath } from '../src/canvas/selfLoop';
import { edgeTypes } from '../src/mindmap/Branch';

const node = vi.hoisted(() => ({
  internals: { positionAbsolute: { x: 1400, y: 800 } },
  measured: { width: 340, height: 186 },
}));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useInternalNode: () => node,
  BaseEdge: ({
    path,
    labelX,
    labelY,
    label,
    markerStart,
    markerEnd,
    style,
    interactionWidth,
  }: EdgeProps & { path: string; labelX: number; labelY: number }) => (
    <g>
      <path
        data-testid="edge-path"
        d={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
        data-interaction-width={interactionWidth}
      />
      <text data-testid="edge-label" x={labelX} y={labelY}>
        {label}
      </text>
    </g>
  ),
  BezierEdge: () => <g data-testid="builtin-bezier" />,
  SmoothStepEdge: () => <g data-testid="builtin-smoothstep" />,
}));

type Point = { x: number; y: number };
const bounds = { x: 1400, y: 800, width: 340, height: 186 };
function endpoint(position: Position) {
  return {
    position,
    x:
      position === Position.Left
        ? bounds.x
        : position === Position.Right
          ? bounds.x + bounds.width
          : bounds.x + bounds.width / 2,
    y:
      position === Position.Top
        ? bounds.y
        : position === Position.Bottom
          ? bounds.y + bounds.height
          : bounds.y + bounds.height / 2,
  };
}

/** Sample the actual rounded SVG path, including curves at the perimeter corners. */
function sample(path: string): Point[] {
  let current = { x: 0, y: 0 };
  const points: Point[] = [];
  for (const command of path.matchAll(/([MLQ])([^MLQ]+)/g)) {
    const values = command[2].trim().split(/[ ,]+/).map(Number);
    const end = { x: values.at(-2)!, y: values.at(-1)! };
    if (command[1] === 'M') points.push(end);
    else
      for (let step = 1; step <= 20; step++) {
        const t = step / 20;
        const rest = 1 - t;
        points.push(
          command[1] === 'Q'
            ? {
                x: rest * rest * current.x + 2 * rest * t * values[0] + t * t * end.x,
                y: rest * rest * current.y + 2 * rest * t * values[1] + t * t * end.y,
              }
            : { x: rest * current.x + t * end.x, y: rest * current.y + t * end.y },
        );
      }
    current = end;
  }
  return points;
}

const positions = [Position.Left, Position.Right, Position.Top, Position.Bottom];
it.each(positions.flatMap((source) => positions.map((target) => [source, target] as const)))(
  'routes a %s to %s self connection and its label outside the actual card',
  (source, target) => {
    const start = endpoint(source);
    const end = endpoint(target);
    const geometry = selfLoopPath(start, end, bounds);
    const points = sample(geometry.path);
    const inside = ({ x, y }: Point) =>
      x > bounds.x + 0.01 &&
      x < bounds.x + bounds.width - 0.01 &&
      y > bounds.y + 0.01 &&
      y < bounds.y + bounds.height - 0.01;
    expect(points[0]).toEqual({ x: start.x, y: start.y });
    expect(points.at(-1)).toEqual({ x: end.x, y: end.y });
    expect(points.length).toBeLessThan(300);
    expect(
      points.every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && !inside(point),
      ),
    ).toBe(true);
    expect(inside({ x: geometry.labelX, y: geometry.labelY })).toBe(false);
    expect(
      points.some(
        (point) =>
          point.x < bounds.x ||
          point.x > bounds.x + bounds.width ||
          point.y < bounds.y ||
          point.y > bounds.y + bounds.height,
      ),
    ).toBe(true);
  },
);

it.each(['smoothstep', 'default', 'mindmap-branch'])(
  'uses the visible self path for %s while preserving the FK label, markers, style and interaction area',
  (type) => {
    const Component = edgeTypes[type];
    const props: EdgeProps & { data: Record<string, never>; type: string } = {
      id: 'manager-reference',
      data: {},
      type,
      source: 'customers',
      target: 'customers',
      sourceX: bounds.x + bounds.width,
      sourceY: bounds.y + bounds.height / 2,
      targetX: bounds.x,
      targetY: bounds.y + bounds.height / 2,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      label: 'manager_id → id',
      markerStart: 'url(#backward)',
      markerEnd: 'url(#forward)',
      style: { stroke: '#8a9694', strokeDasharray: '7 4' },
      interactionWidth: 30,
    };
    const { rerender } = render(
      <svg>
        <Component {...props} />
      </svg>,
    );
    const path = screen.getByTestId('edge-path');
    expect(path).toHaveAttribute('marker-start', 'url(#backward)');
    expect(path).toHaveAttribute('marker-end', 'url(#forward)');
    expect(path).toHaveStyle({ strokeDasharray: '7 4' });
    expect(path).toHaveAttribute('data-interaction-width', '30');
    const label = screen.getByTestId('edge-label');
    expect(label).toHaveTextContent('manager_id → id');
    expect(Number(label.getAttribute('y'))).toBeLessThan(bounds.y);
    if (type !== 'mindmap-branch') {
      rerender(
        <svg>
          <Component {...props} target="another-table" />
        </svg>,
      );
      expect(
        screen.getByTestId(type === 'default' ? 'builtin-bezier' : 'builtin-smoothstep'),
      ).toBeInTheDocument();
    }
  },
);
