import { nodeKindLabel } from '../../ui/editor-labels';
import { timelineScaleKeys } from '../ui-labels';
import { useI18n } from '../../i18n';
import { ArrowRight, GitBranch, Layers, SlidersHorizontal } from 'lucide-react';
import type { Direction } from '../../layouts/layout';
import type { NodeKind, TimelineScale } from '../../model/types';
import { nodeRegistry } from '../../nodes/registry';
import { useEditor } from '../../state/editor';
import type { CompactToolbarProps } from './compact-toolbar-types';

export function CompactArrangementTools({
  graph,
  spatial,
  mindmap,
  kind,
  setKind,
  direction,
  setDirection,
  busy,
  selectionCount,
  showFilters,
  toggleFilters,
  open,
  addSibling,
  runLayout,
}: CompactToolbarProps) {
  const { t } = useI18n();
  return (
    <>
      <h3>{t('mobile.editArrangeHeading')}</h3>
      {!mindmap && (
        <label className="field">
          {t('toolbar.nodeTypeField')}
          <select
            aria-label={t('toolbar.nodeTypeField')}
            value={kind}
            onChange={(event) => setKind(event.target.value as NodeKind)}
          >
            {Object.entries(nodeRegistry).map(([key]) => (
              <option key={key} value={key}>
                {nodeKindLabel(t, key)}
              </option>
            ))}
          </select>
        </label>
      )}
      {mindmap && (
        <button className="full" disabled={!selectionCount} onClick={addSibling}>
          <GitBranch size={17} />
          {t('toolbar.addSibling')}
        </button>
      )}
      <button className="full" disabled={graph.nodes.length < 2} onClick={() => open('connect')}>
        <ArrowRight size={17} />
        {t('toolbar.connectNodes')}
      </button>
      <button
        className="full"
        disabled={selectionCount < 2}
        onClick={() => useEditor.getState().group()}
      >
        <Layers size={17} />
        {t('toolbar.groupSelection')}
      </button>
      <label className="field">
        {t('toolbar.layoutDirection')}
        <select
          aria-label={t('toolbar.mobileLayoutDirection')}
          value={direction}
          onChange={(event) => setDirection(event.target.value as Direction)}
        >
          {mindmap && <option value="BALANCED">{t('toolbar.balancedLayout')}</option>}
          <option value="RIGHT">{t('toolbar.leftRightLayout')}</option>
          <option value="LEFT">{t('toolbar.rightLeftLayout')}</option>
          <option value="DOWN">{t('toolbar.topBottomLayout')}</option>
          <option value="UP">{t('toolbar.bottomTopLayout')}</option>
          <option value="RADIAL">{t('toolbar.radialLayout')}</option>
        </select>
      </label>
      <button
        className="full"
        disabled={spatial || busy || !graph.nodes.length}
        onClick={() => void runLayout()}
      >
        <GitBranch size={17} />
        {busy ? t('toolbar.layingOut') : t('toolbar.autoLayout')}
      </button>
      <button className={`full ${showFilters ? 'active' : ''}`} onClick={toggleFilters}>
        <SlidersHorizontal size={17} />
        {t('toolbar.filters')}
      </button>
      {graph.diagram.type === 'timeline' && (
        <label className="field">
          {t('toolbar.timelineZoom')}
          <select
            aria-label={t('toolbar.timelineZoom')}
            value={graph.diagram.settings.timelineScale ?? 'month'}
            onChange={(event) =>
              useEditor.getState().command('Timeline zoom', (current) => ({
                ...current,
                diagram: {
                  ...current.diagram,
                  settings: {
                    ...current.diagram.settings,
                    timelineScale: event.target.value as TimelineScale,
                  },
                },
              }))
            }
          >
            {(['day', 'week', 'month', 'quarter', 'year'] as const).map((value) => (
              <option key={value} value={value}>
                {t(timelineScaleKeys[value])}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
