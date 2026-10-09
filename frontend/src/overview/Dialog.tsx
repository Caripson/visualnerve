import { useI18n } from '../i18n';
import { useMemo } from 'react';
import { Modal } from '../components/Modal';
import { useEditor } from '../state/editor';
import { projectCanonicalOverview } from './projection';
import { getOverviewConfig, setOverviewConfig, type OverviewGrouping } from './types';
import { OVERVIEW_RESET_VIEW } from './Controls';
import './overview.css';
export function OverviewDialog({ close }: { close: () => void }) {
  const { t, number } = useI18n();
  const graph = useEditor((state) => state.graph);
  const projection = useMemo(() => (graph ? projectCanonicalOverview(graph) : undefined), [graph]);
  if (!graph || !projection) return null;
  const config = getOverviewConfig(graph);
  const update = (patch: Partial<typeof config>) =>
    useEditor
      .getState()
      .command('Semantic overview', (current) =>
        setOverviewConfig(current, { ...getOverviewConfig(current), ...patch }),
      );
  return (
    <Modal title={t('overview.title')} close={close}>
      <div className="overview-controls-body">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => {
              update({ enabled: event.target.checked });
              window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
            }}
          />
          {t('overview.summarize')}
        </label>
        <label>
          {t('overview.grouping')}
          <select
            value={config.grouping}
            onChange={(event) =>
              update({ grouping: event.target.value as OverviewGrouping, expanded: [] })
            }
          >
            <option value="auto">{t('overview.groupAuto')}</option>
            <option value="groups">{t('overview.groupHierarchy')}</option>
            <option value="tags">{t('overview.groupTag')}</option>
            <option value="source">{t('overview.groupSource')}</option>
          </select>
        </label>
        <p>
          {t('overview.counts', {
            objects: number(projection.counts.originalNodes),
            cards: number(projection.counts.representedNodes),
          })}
        </p>
        <p>{t('overview.summaryExplanation')}</p>
        <p>{t('overview.layoutExplanation')}</p>
        <p>{t('overview.readOnlyExplanation')}</p>
        <button
          onClick={() => {
            update({ expanded: [] });
            window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
          }}
        >
          {t('overview.collapse')}
        </button>
        <button onClick={close}>{t('common.done')}</button>
      </div>
    </Modal>
  );
}
