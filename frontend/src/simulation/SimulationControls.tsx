import { runStatusLabel } from './display';
import { useI18n } from '../i18n';
import { Play, Pause, Square, RotateCcw, Settings2, SlidersHorizontal } from 'lucide-react';
import type { SimulationSpeed } from './protocol';
import type { SimulationModel } from './types';

export const simulationTime = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${Math.floor(seconds % 60)}s`;

interface ActionProps {
  busy: boolean;
  active: boolean;
  paused: boolean;
  canResume: boolean;
  hasRun: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  reset: () => void;
}

export function SimulationActions({
  compact = false,
  ...props
}: ActionProps & { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <button
        className="simulation-play primary"
        aria-label={
          props.canResume
            ? t('simulator.run.resumeAccessible')
            : props.active
              ? t('simulator.run.rerunAccessible')
              : t('simulator.run.playAccessible')
        }
        disabled={props.busy}
        onClick={props.play}
      >
        <Play size={compact ? 19 : 15} />
        {props.canResume
          ? t('simulator.run.resume')
          : props.active
            ? t('simulator.run.rerun')
            : t('simulator.run.play')}
      </button>
      <button
        className={compact ? 'simulation-icon-action' : undefined}
        aria-label={t('simulator.run.pauseAccessible')}
        disabled={props.busy || !props.active || props.paused}
        onClick={props.pause}
      >
        <Pause size={compact ? 19 : 15} />
        {!compact && t('simulator.run.pause')}
      </button>
      {!compact && <SimulationStopActions {...props} />}
    </>
  );
}

export function SimulationStopActions(props: ActionProps) {
  const { t } = useI18n();
  return (
    <>
      <button
        aria-label={t('simulator.run.stopAccessible')}
        disabled={props.busy || !props.active}
        onClick={props.stop}
      >
        <Square size={15} />
        {t('simulator.run.stop')}{' '}
      </button>
      <button
        aria-label={t('simulator.run.resetAccessible')}
        disabled={props.busy || !props.hasRun}
        onClick={props.reset}
      >
        <RotateCcw size={15} />
        {t('simulator.run.reset')}{' '}
      </button>
    </>
  );
}

export function SimulationDock({
  seconds,
  status,
  openDetails,
  ...actions
}: ActionProps & {
  seconds: number;
  status: string;
  openDetails: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="simulation-dock">
      <SimulationActions {...actions} compact />
      <div className="simulation-dock-clock">
        <output aria-label={t('simulator.run.simulatedTime')} title={simulationTime(seconds)}>
          {simulationTime(seconds)}
        </output>
        <span className="simulation-run-status" role="status">
          {runStatusLabel(t, status)}
        </span>
      </div>
      <button
        aria-label={t('simulator.run.openSimulationDetails')}
        className="simulation-details-action"
        onClick={openDetails}
      >
        <SlidersHorizontal size={19} />
        <span>{t('simulator.run.details')}</span>
      </button>
    </div>
  );
}

export function SimulationRunSettings({
  model,
  speed,
  setSpeed,
  duration,
  setDuration,
  seed,
  setSeed,
  untilComplete,
  setUntilComplete,
  scenarioId,
  setScenarioId,
  createScenario,
  configure,
}: {
  model: SimulationModel;
  speed: SimulationSpeed;
  setSpeed: (value: SimulationSpeed) => void;
  duration: number;
  setDuration: (value: number) => void;
  seed: number;
  setSeed: (value: number) => void;
  untilComplete: boolean;
  setUntilComplete: (value: boolean) => void;
  scenarioId: string;
  setScenarioId: (value: string) => void;
  createScenario: () => void;
  configure: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label>
        {t('simulator.run.speed')}{' '}
        <select
          aria-label={t('simulator.run.simulationSpeed')}
          value={speed}
          onChange={(event) =>
            setSpeed(
              event.target.value === 'max'
                ? 'max'
                : (Number(event.target.value) as SimulationSpeed),
            )
          }
        >
          {[1, 10, 100, 'max'].map((value) => (
            <option key={value} value={value}>
              {value === 'max'
                ? t('simulator.run.max')
                : t('simulator.run.', { value: String(value) })}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('simulator.run.duration')}{' '}
        <select
          aria-label={t('simulator.run.simulationDurationPreset')}
          value={[3600, 86400, 604800, 2592000, 31536000].includes(duration) ? duration : 'custom'}
          onChange={(event) =>
            event.target.value !== 'custom' && setDuration(Number(event.target.value))
          }
        >
          <option value={3600}>{t('simulator.run.1Hour')}</option>
          <option value={86400}>{t('simulator.run.1Day')}</option>
          <option value={604800}>{t('simulator.run.1Week')}</option>
          <option value={2592000}>{t('simulator.run.1Month30Days')}</option>
          <option value={31536000}>{t('simulator.run.1Year365Days')}</option>
          <option value="custom">{t('simulator.run.custom')}</option>
        </select>
      </label>
      <label>
        {t('simulator.run.hours')}{' '}
        <input
          aria-label={t('simulator.run.durationHoursAccessible')}
          type="number"
          min={0.001}
          step="any"
          value={duration / 3600}
          onChange={(event) => setDuration(Number(event.target.value) * 3600)}
        />
      </label>
      <label>
        {t('simulator.run.seed')}{' '}
        <input
          aria-label={t('simulator.run.seedAccessible')}
          type="number"
          min={0}
          step={1}
          value={seed}
          onChange={(event) => setSeed(Number(event.target.value))}
        />
      </label>
      <label className="simulation-finish-field">
        <span>{t('simulator.run.finishWorkload')}</span>
        <input
          aria-label={t('simulator.run.finishAllGeneratedWork')}
          type="checkbox"
          checked={untilComplete}
          onChange={(event) => setUntilComplete(event.target.checked)}
        />
      </label>
      <label className="simulation-scenario-field">
        {t('simulator.run.scenario')}{' '}
        <select
          aria-label={t('simulator.run.simulationScenario')}
          value={scenarioId}
          onChange={(event) => setScenarioId(event.target.value)}
        >
          <option value="">{t('simulator.run.baseModel')}</option>
          {model.scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>
      <button onClick={createScenario}>{t('simulator.run.newScenario')}</button>
      <button aria-label={t('simulator.run.assumptionsConfigureSimulation')} onClick={configure}>
        <Settings2 size={15} />
        {t('simulator.run.assumptions')}{' '}
      </button>
    </>
  );
}
