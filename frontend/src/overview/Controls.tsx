import { useI18n } from '../i18n';
import { Layers, ChevronsLeft } from 'lucide-react';
import { useEditor } from '../state/editor';
import {
  getOverviewConfig,
  setOverviewConfig,
  type OverviewGrouping,
  type OverviewProjection,
} from './types';
import './overview.css';
import { collapseOverviewLevel, lastOverviewExpansion } from './expansion';

export const OVERVIEW_RESET_VIEW = 'visualnerve:overview-reset-view';
export function OverviewControls({ projection }: { projection: OverviewProjection }) {
  const { t, number } = useI18n();
  const graph = useEditor((state) => state.graph);
  if (!graph) return null;
  const config = getOverviewConfig(graph);
  const update = (patch: Partial<typeof config>) =>
    useEditor
      .getState()
      .command('Semantic overview', (current) =>
        setOverviewConfig(current, { ...getOverviewConfig(current), ...patch }),
      );
  const chooseView = (enabled: boolean) => {
    if (config.enabled === enabled) return;
    update({ enabled });
    window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
  };
  return (
    <details className="overview-controls" data-testid="overview-controls">
      <summary>
        <Layers size={15} />
        <span>
          {config.enabled
            ? t('overview.withCards', { count: number(projection.counts.representedNodes) })
            : t('overview.overview')}
        </span>
      </summary>
      <div className="overview-controls-body">
        <div className="overview-view-switch" role="group" aria-label={t('overview.detailView')}>
          <button aria-pressed={config.enabled} onClick={() => chooseView(true)}>
            {t('overview.overview')}
          </button>
          <button aria-pressed={!config.enabled} onClick={() => chooseView(false)}>
            {t('overview.details')}
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => {
              chooseView(event.target.checked);
            }}
          />
          {t('overview.title')}
        </label>
        <label>
          {t('overview.groupBy')}
          <select
            value={config.grouping}
            disabled={!config.enabled}
            onChange={(event) =>
              update({ grouping: event.target.value as OverviewGrouping, expanded: [] })
            }
          >
            <option value="auto">{t('overview.groupAuto')}</option>
            <option value="groups">{t('overview.groupHierarchy')}</option>
            <option value="tags">{t('overview.groupTag')}</option>
            <option value="source">{t('overview.groupSourceCompact')}</option>
          </select>
        </label>
        <p>
          {t('overview.retainedCounts', {
            objects: number(projection.counts.originalNodes),
            relationships: number(projection.counts.originalEdges),
          })}
        </p>
        {config.enabled && (
          <>
            <p>{t('overview.detailHint')}</p>
            <button
              disabled={!lastOverviewExpansion(config, projection.groups)}
              onClick={() => {
                useEditor
                  .getState()
                  .command('Back one overview level', (current) =>
                    setOverviewConfig(
                      current,
                      collapseOverviewLevel(getOverviewConfig(current), projection.groups),
                    ),
                  );
                window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
              }}
            >
              <ChevronsLeft size={14} />
              {t('overview.backLevel')}
            </button>
            <button
              onClick={() => {
                update({ expanded: [] });
                window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
              }}
            >
              <ChevronsLeft size={14} />
              {t('overview.collapse')}
            </button>
            {projection.bounded && <p role="status">{t('overview.cardLimit')}</p>}
          </>
        )}
      </div>
    </details>
  );
}
