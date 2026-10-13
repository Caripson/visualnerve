import { useId, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '../i18n';
import { runStatusLabel } from './display';
import { simulationTime } from './SimulationControls';
import './simulation-shell.css';

/** A view-only disclosure. Keeping its body mounted preserves replay and comparison choices. */
export function SimulationDesktopPanel({
  collapsed,
  toggle,
  playback,
  seconds,
  status,
  metricsToggle,
  runSettings,
  notices,
  children,
}: {
  collapsed: boolean;
  toggle: () => void;
  playback: ReactNode;
  seconds: number;
  status: string;
  metricsToggle: ReactNode;
  runSettings: ReactNode;
  notices: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const detailsId = useId();
  return (
    <>
      <div className="simulation-controls">
        <div className="simulation-transport">
          <strong>{t('simulator.feature.processSimulator')}</strong>
          {!collapsed && metricsToggle}
          <div className="simulation-playback">{playback}</div>
          <div className="simulation-time">
            <output aria-label={t('simulator.run.simulatedTime')}>{simulationTime(seconds)}</output>
            <span className="simulation-run-status" role="status">
              {runStatusLabel(t, status)}
            </span>
          </div>
          <button
            className="simulation-panel-toggle"
            aria-label={t(
              collapsed ? 'simulator.run.panel.expand' : 'simulator.run.panel.collapse',
            )}
            aria-expanded={!collapsed}
            aria-controls={detailsId}
            onClick={toggle}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            <span>{t(collapsed ? 'simulator.run.panel.show' : 'simulator.run.panel.hide')}</span>
          </button>
        </div>
      </div>
      <div className="simulation-panel-notices">{notices}</div>
      <div id={detailsId} className="simulation-panel-body" hidden={collapsed}>
        <div className="simulation-desktop-settings">{runSettings}</div>
        {children}
      </div>
    </>
  );
}
