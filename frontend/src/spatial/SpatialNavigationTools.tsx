import { ArrowLeft, CircleHelp, Focus, Maximize, Move, Settings2 } from 'lucide-react';
import { ToolbarMenu } from '../components/ToolbarMenu';
import { useCompactLayout } from '../hooks/useCompactLayout';

type Orientation = 'front' | 'back' | 'left' | 'right' | 'top';
export function SpatialNavigationTools({
  ready,
  moving,
  movementDisabled,
  selected,
  labels,
  help,
  returnTo2D,
  fit,
  focus,
  toggleMovement,
  toggleHelp,
  setLabels,
  orient,
  tilt,
}: {
  ready: boolean;
  moving: boolean;
  movementDisabled: boolean;
  selected: boolean;
  labels: boolean;
  help: boolean;
  returnTo2D: () => void;
  fit: () => void;
  focus: () => void;
  toggleMovement: () => void;
  toggleHelp: () => void;
  setLabels: (value: boolean) => void;
  orient: (value: Orientation) => void;
  tilt: (value: number) => void;
}) {
  const compact = useCompactLayout();
  const options = (
    <>
      <button disabled={movementDisabled} aria-pressed={moving} onClick={toggleMovement}>
        <Move size={16} />
        Move objects
      </button>
      <div className="spatial-orientations">
        {(['front', 'back', 'left', 'right', 'top'] as const).map((value) => (
          <button
            key={value}
            disabled={!ready}
            onClick={() => orient(value)}
            aria-label={`${value[0].toUpperCase()}${value.slice(1)} view`}
          >
            {value[0].toUpperCase()}
            {value.slice(1)}
          </button>
        ))}
      </div>
      <button
        disabled={!ready}
        onClick={() => tilt(-Math.PI / 18)}
        aria-label="Tilt diagram left 10 degrees"
      >
        −10°
      </button>
      <button
        disabled={!ready}
        onClick={() => tilt(Math.PI / 18)}
        aria-label="Tilt diagram right 10 degrees"
      >
        +10°
      </button>
      <button disabled={!ready || !selected} onClick={focus} aria-label="Focus selected object">
        <Focus size={16} />
        Focus
      </button>
      <label>
        <input
          type="checkbox"
          checked={labels}
          onChange={(event) => setLabels(event.target.checked)}
        />
        Labels
      </label>
    </>
  );
  return (
    <>
      <button className="spatial-return" aria-label="Return to 2D" onClick={returnTo2D}>
        <ArrowLeft size={16} />
        {compact ? '2D' : 'Return to 2D'}
      </button>
      {!compact && options}
      <button onClick={fit} disabled={!ready} aria-label="Fit 3D diagram">
        <Maximize size={16} />
        Fit
      </button>
      <button
        aria-label="3D help"
        aria-expanded={help}
        aria-controls="spatial-help"
        data-spatial-help-control
        onClick={toggleHelp}
      >
        <CircleHelp size={16} />
        {!compact && 'Help'}
      </button>
      {compact && (
        <ToolbarMenu label="3D tools" icon={<Settings2 size={16} />} text={false}>
          <h3>3D navigation</h3>
          {options}
        </ToolbarMenu>
      )}
    </>
  );
}
