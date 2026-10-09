import { orientationKeys } from './ui-labels';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const compact = useCompactLayout();
  const options = (
    <>
      <button disabled={movementDisabled} aria-pressed={moving} onClick={toggleMovement}>
        <Move size={16} />
        {t('spatial.moveObjects')}
      </button>
      <div className="spatial-orientations">
        {(['front', 'back', 'left', 'right', 'top'] as const).map((value) => (
          <button
            key={value}
            disabled={!ready}
            onClick={() => orient(value)}
            aria-label={t(orientationKeys[value].aria)}
          >
            {t(orientationKeys[value].label)}
          </button>
        ))}
      </div>
      <button
        disabled={!ready}
        onClick={() => tilt(-Math.PI / 18)}
        aria-label={t('spatial.tiltLeft')}
      >
        −10°
      </button>
      <button
        disabled={!ready}
        onClick={() => tilt(Math.PI / 18)}
        aria-label={t('spatial.tiltRight')}
      >
        +10°
      </button>
      <button
        disabled={!ready || !selected}
        onClick={focus}
        aria-label={t('spatial.focusSelected')}
      >
        <Focus size={16} />
        {t('spatial.focus')}
      </button>
      <label>
        <input
          type="checkbox"
          checked={labels}
          onChange={(event) => setLabels(event.target.checked)}
        />
        {t('spatial.labelsToggle')}
      </label>
    </>
  );
  return (
    <>
      <button className="spatial-return" aria-label={t('spatial.return2D')} onClick={returnTo2D}>
        <ArrowLeft size={16} />
        {compact ? '2D' : t('spatial.return2D')}
      </button>
      {!compact && options}
      <button onClick={fit} disabled={!ready} aria-label={t('spatial.fitDiagramAria')}>
        <Maximize size={16} />
        {t('spatial.fit')}
      </button>
      <button
        aria-label={t('spatial.helpAria')}
        aria-expanded={help}
        aria-controls="spatial-help"
        data-spatial-help-control
        onClick={toggleHelp}
      >
        <CircleHelp size={16} />
        {!compact && t('spatial.help')}
      </button>
      {compact && (
        <ToolbarMenu label={t('spatial.toolsMenu')} icon={<Settings2 size={16} />} text={false}>
          <h3>{t('spatial.navigationRegion')}</h3>
          {options}
        </ToolbarMenu>
      )}
    </>
  );
}
