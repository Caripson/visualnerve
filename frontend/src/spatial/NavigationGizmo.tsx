import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { SpatialCamera, SpatialPoint } from './types';
import type { SpatialNavigationMode, SpatialNavigationAxis } from './navigation';
import './navigation-gizmo.css';

export type { SpatialNavigationMode, SpatialNavigationAxis } from './navigation';
export interface SpatialNavigationDelta {
  x: number;
  y: number;
}
export interface NavigationGizmoProps {
  camera?: SpatialCamera;
  disabled?: boolean;
  onNavigate: (
    mode: SpatialNavigationMode,
    axis: SpatialNavigationAxis,
    delta: SpatialNavigationDelta,
  ) => void;
  onGestureEnd?: () => void;
}

const axes = ['x', 'y', 'z'] as const;
const colors = { x: '#df5461', y: '#43a975', z: '#567de2' };
const axisVectors: Record<(typeof axes)[number], SpatialPoint> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};
const center = { x: 78, y: 62 };
const cross = (a: SpatialPoint, b: SpatialPoint): SpatialPoint => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: SpatialPoint, b: SpatialPoint) => a.x * b.x + a.y * b.y + a.z * b.z;
function normalize(point: SpatialPoint, fallback: SpatialPoint): SpatialPoint {
  const length = Math.hypot(point.x, point.y, point.z);
  return length > 1e-9 && Number.isFinite(length)
    ? { x: point.x / length, y: point.y / length, z: point.z / length }
    : fallback;
}
function projection(camera?: SpatialCamera) {
  const forward = normalize(
    camera
      ? {
          x: camera.position.x - camera.target.x,
          y: camera.position.y - camera.target.y,
          z: camera.position.z - camera.target.z,
        }
      : axisVectors.z,
    axisVectors.z,
  );
  const cameraUp = camera?.up ?? axisVectors.y;
  let right = cross(cameraUp, forward);
  if (Math.hypot(right.x, right.y, right.z) < 1e-9) right = cross(axisVectors.z, forward);
  right = normalize(right, axisVectors.x);
  const up = normalize(cross(forward, right), axisVectors.y);
  return (point: SpatialPoint, radius = 43) => ({
    x: center.x + dot(point, right) * radius,
    y: center.y - dot(point, up) * radius,
  });
}
function circlePoint(axis: (typeof axes)[number], angle: number): SpatialPoint {
  const a = Math.cos(angle);
  const b = Math.sin(angle);
  return axis === 'x'
    ? { x: 0, y: a, z: b }
    : axis === 'y'
      ? { x: b, y: 0, z: a }
      : { x: a, y: b, z: 0 };
}
function controlLabel(mode: SpatialNavigationMode, axis: SpatialNavigationAxis) {
  const verb = mode[0].toUpperCase() + mode.slice(1);
  return axis === 'free'
    ? `${verb} view freely`
    : `${verb} view ${mode === 'rotate' ? 'around' : 'along'} ${axis.toUpperCase()} axis`;
}
function ModeIcon({ mode }: { mode: SpatialNavigationMode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {mode === 'rotate' ? (
        <>
          <ellipse cx="12" cy="12" rx="9" ry="4" fill="none" stroke={colors.z} strokeWidth="1.6" />
          <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke={colors.y} strokeWidth="1.6" />
          <ellipse
            cx="12"
            cy="12"
            rx="4"
            ry="9"
            transform="rotate(-40 12 12)"
            fill="none"
            stroke={colors.x}
            strokeWidth="1.6"
          />
        </>
      ) : (
        <>
          <path
            d="M12 15 3 10M12 15 21 10M12 15V3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          {[
            ['x', 21, 10],
            ['y', 3, 10],
            ['z', 12, 3],
          ].map(([axis, x, y]) =>
            mode === 'scale' ? (
              <rect
                key={axis}
                x={Number(x) - 2}
                y={Number(y) - 2}
                width="4"
                height="4"
                rx=".5"
                fill={colors[axis as (typeof axes)[number]]}
              />
            ) : (
              <path
                key={axis}
                d={`M${Number(x) - 2} ${Number(y) + 2}L${x} ${Number(y) - 2}L${Number(x) + 2} ${Number(y) + 2}Z`}
                fill={colors[axis as (typeof axes)[number]]}
              />
            ),
          )}
        </>
      )}
    </svg>
  );
}

/** View navigation only: the diagram's node positions and dimensions stay canonical. */
export function NavigationGizmo({
  camera,
  disabled = false,
  onNavigate,
  onGestureEnd,
}: NavigationGizmoProps) {
  const [mode, setMode] = useState<SpatialNavigationMode>('rotate');
  const [activeAxis, setActiveAxis] = useState<SpatialNavigationAxis | null>(null);
  const instructionsId = useId();
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    axis: SpatialNavigationAxis;
    mode: SpatialNavigationMode;
  } | null>(null);
  const endCallback = useRef(onGestureEnd);
  endCallback.current = onGestureEnd;
  const project = projection(camera);
  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    setActiveAxis(null);
    endCallback.current?.();
  };
  useEffect(() => {
    if (disabled) finish();
  }, [disabled]);
  useEffect(
    () => () => {
      if (drag.current) endCallback.current?.();
    },
    [],
  );

  function start(axis: SpatialNavigationAxis, event: PointerEvent<SVGGElement>) {
    if (disabled || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, axis, mode };
    setActiveAxis(axis);
  }
  function move(event: PointerEvent<SVGGElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    const delta = { x: event.clientX - gesture.x, y: event.clientY - gesture.y };
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (delta.x || delta.y) onNavigate(gesture.mode, gesture.axis, delta);
  }
  function end(event: PointerEvent<SVGGElement>) {
    if (event.pointerId !== drag.current?.pointerId) return;
    event.preventDefault();
    finish();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboard(axis: SpatialNavigationAxis, event: KeyboardEvent<SVGGElement>) {
    if (disabled) return;
    const step = event.shiftKey ? 24 : 8;
    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      Enter: { x: step, y: 0 },
      ' ': { x: step, y: 0 },
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    onNavigate(mode, axis, delta);
    onGestureEnd?.();
  }
  function events(axis: SpatialNavigationAxis) {
    return {
      role: 'button',
      tabIndex: disabled ? -1 : 0,
      'aria-label': controlLabel(mode, axis),
      'aria-disabled': disabled,
      'aria-describedby': instructionsId,
      'data-axis': axis,
      className: `spatial-gizmo-control${activeAxis === axis ? ' is-active' : ''}`,
      onPointerDown: (event: PointerEvent<SVGGElement>) => start(axis, event),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: () => finish(),
      onKeyDown: (event: KeyboardEvent<SVGGElement>) => keyboard(axis, event),
    };
  }
  return (
    <div
      className="spatial-navigation-gizmo"
      role="group"
      data-testid="spatial-navigation-gizmo"
      data-mode={mode}
      aria-label="3D view controls"
      aria-disabled={disabled}
    >
      <div className="spatial-gizmo-modes" role="toolbar" aria-label="3D control mode">
        {(['move', 'rotate', 'scale'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-label={`${item[0].toUpperCase()}${item.slice(1)} view`}
            aria-pressed={mode === item}
            disabled={disabled}
            onClick={() => {
              finish();
              setMode(item);
            }}
          >
            <ModeIcon mode={item} />
            <span>
              {item[0].toUpperCase()}
              {item.slice(1)}
            </span>
          </button>
        ))}
      </div>
      <svg
        className="spatial-gizmo-space"
        viewBox="0 0 156 126"
        aria-label={`${mode[0].toUpperCase()}${mode.slice(1)} view handles`}
      >
        <path className="spatial-gizmo-ground" d="M78 89 32 68 78 47 124 68Z" />
        {axes.map((axis, index) => {
          const point =
            mode === 'rotate'
              ? project(circlePoint(axis, [Math.PI / 4, Math.PI / 4, (Math.PI * 5) / 4][index]))
              : project(axisVectors[axis]);
          const path =
            mode === 'rotate'
              ? Array.from({ length: 65 }, (_, i) => {
                  const p = project(circlePoint(axis, (i * Math.PI) / 32));
                  return `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
                }).join(' ')
              : `M${center.x} ${center.y}L${point.x} ${point.y}`;
          const arrowAngle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
          return (
            <g
              key={axis}
              {...events(axis)}
              style={{ '--gizmo-axis': colors[axis] } as CSSProperties}
            >
              <path className="spatial-gizmo-axis" d={path} />
              {mode === 'scale' ? (
                <rect
                  className="spatial-gizmo-marker"
                  x={point.x - 5}
                  y={point.y - 5}
                  width="10"
                  height="10"
                  rx="1.5"
                />
              ) : mode === 'move' && Math.hypot(point.x - center.x, point.y - center.y) > 8 ? (
                <path
                  className="spatial-gizmo-marker"
                  d="M-6-5 5 0-6 5Z"
                  transform={`translate(${point.x} ${point.y}) rotate(${arrowAngle})`}
                />
              ) : (
                <circle className="spatial-gizmo-marker" cx={point.x} cy={point.y} r="5" />
              )}
              <text
                x={point.x + (point.x > center.x + 10 ? 12 : -12)}
                y={point.y + (point.y > center.y + 10 ? 14 : -9)}
              >
                {axis.toUpperCase()}
              </text>
              <circle
                className="spatial-gizmo-hit"
                data-testid={`spatial-gizmo-grab-${axis}`}
                cx={point.x}
                cy={point.y}
                r="12"
              />
            </g>
          );
        })}
        <g
          {...events('free')}
          className={`spatial-gizmo-control spatial-gizmo-free${activeAxis === 'free' ? ' is-active' : ''}`}
        >
          <circle className="spatial-gizmo-free-disc" cx="134" cy="106" r="12" />
          <path d="M129 106h10m-5-5v10" />
          <circle
            className="spatial-gizmo-hit"
            data-testid="spatial-gizmo-grab-free"
            cx="134"
            cy="106"
            r="13"
          />
        </g>
      </svg>
      <p id={instructionsId}>
        {mode === 'move'
          ? 'Drag axes to pan the view'
          : mode === 'rotate'
            ? 'Drag rings to rotate the view'
            : 'Drag to zoom the view'}
        <span>Arrow keys fine-tune · Shift speeds up</span>
      </p>
    </div>
  );
}
