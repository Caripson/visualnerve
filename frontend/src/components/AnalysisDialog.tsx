import { TranslatedText } from './TranslatedText';
import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { Network, Bookmark } from 'lucide-react';
import { useEditor } from '../state/editor';
import {
  getExploration,
  getNamedAnalysisViews,
  type RelationshipExploration,
} from '../analysis/types';
import { getCsvNode } from '../data/csv';
import { Modal } from './Modal';
import './analysis-tools.css';

export function AnalysisDialog({ close, startId }: { close: () => void; startId?: string }) {
  const { t } = useI18n();
  const graph = useEditor((state) => state.graph);
  const result = useEditor((state) => state.explorationResult);
  const working = useEditor((state) => state.explorationBusy);
  const previous = graph && getExploration(graph);
  const [mode, setMode] = useState<'neighbors' | 'path'>(
    previous?.mode === 'path' ? 'path' : 'neighbors',
  );
  const [direction, setDirection] = useState<RelationshipExploration['direction']>(
    previous?.direction ?? 'all',
  );
  const [steps, setSteps] = useState<1 | 2>(previous?.steps === 2 ? 2 : 1);
  const [directed, setDirected] = useState(previous?.directed ?? true);
  const [includeHidden, setIncludeHidden] = useState(previous?.includeHidden ?? false);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(previous?.targetId ?? '');
  const [name, setName] = useState('');
  const [viewId, setViewId] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const views = graph ? getNamedAnalysisViews(graph).views : [];
  const start = graph?.nodes.find((node) => node.id === (startId ?? previous?.startId));
  const destinations = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const matching = nodes
      .filter(
        (node) =>
          node.id !== start?.id &&
          (includeHidden || getCsvNode(node)?.visible !== false) &&
          node.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
      .slice(0, 100);
    const chosen = nodes.find((node) => node.id === target);
    if (chosen && !matching.some((node) => node.id === target)) matching.unshift(chosen);
    return matching;
  }, [graph?.nodes, search, target, start?.id, includeHidden]);
  useEffect(() => {
    if (viewId && !views.some((view) => view.id === viewId)) setViewId('');
  }, [views, viewId]);
  if (!graph) return null;
  const action = (operation: () => void) => {
    try {
      operation();
      setNotice('View saved.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  const load = async () => {
    setBusy(true);
    setNotice('Loading view…');
    try {
      await useEditor.getState().loadView(viewId);
      setNotice(
        'View loaded. Notes, statuses, drawing marks and manual connections were preserved.',
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('data.analysis.title')} close={close} wide>
      <div className="analysis-dialog">
        <section aria-label={t('data.analysis.explorationAccessible')}>
          <h3>
            <Network size={17} />
            {t('data.analysis.exploreAction')}
          </h3>
          <p>
            {start ? (
              <TranslatedText
                messageId="data.analysis.startFromObject"
                slots={{ title: <strong>{start.title}</strong> }}
              />
            ) : (
              t('data.analysis.startFromSelection')
            )}
          </p>
          <label className="field">
            {t('data.analysis.modeLabel')}
            <select
              aria-label={t('data.analysis.modeAccessible')}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="neighbors">{t('data.analysis.neighbors')}</option>
              <option value="path">{t('data.analysis.shortestPath')}</option>
            </select>
          </label>
          {mode === 'neighbors' ? (
            <div className="analysis-fields">
              <label className="field">
                {t('data.analysis.relationshipsLabel')}
                <select
                  aria-label={t('data.analysis.directionAccessible')}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as typeof direction)}
                >
                  <option value="all">{t('data.analysis.allDirections')}</option>
                  <option value="incoming">{t('data.analysis.incoming')}</option>
                  <option value="outgoing">{t('data.analysis.outgoing')}</option>
                </select>
              </label>
              <label className="field">
                {t('data.analysis.distanceLabel')}
                <select
                  aria-label={t('data.analysis.stepsAccessible')}
                  value={steps}
                  onChange={(event) => setSteps(Number(event.target.value) as 1 | 2)}
                >
                  <option value={1}>{t('data.analysis.oneStep')}</option>
                  <option value={2}>{t('data.analysis.twoSteps')}</option>
                </select>
              </label>
            </div>
          ) : (
            <>
              <label className="field">
                {t('data.analysis.findDestination')}
                <input
                  aria-label={t('data.analysis.findDestinationAccessible')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('data.analysis.searchPlaceholder')}
                />
              </label>
              <label className="field">
                {t('data.analysis.destinationLabel')}
                <select
                  aria-label={t('data.analysis.destinationAccessible')}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">{t('data.analysis.chooseDestination')}</option>
                  {destinations.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title} · {node.id.slice(0, 8)}
                      {getCsvNode(node)?.visible === false
                        ? t('data.analysis.outsideViewSuffix')
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{t('data.analysis.searchBound')}</p>
              <label className="analysis-check">
                <input
                  type="checkbox"
                  aria-label={t('data.analysis.followDirections')}
                  checked={directed}
                  onChange={(event) => setDirected(event.target.checked)}
                />
                {t('data.analysis.followDirections')}
              </label>
            </>
          )}
          <label className="analysis-check">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(event) => setIncludeHidden(event.target.checked)}
            />
            {t('data.analysis.includeOutsideView')}
          </label>
          {includeHidden && (
            <p className="analysis-warning">{t('data.analysis.earlierMeasures')}</p>
          )}
          <p className="muted">{t('data.analysis.explorationRules')}</p>
          <div className="analysis-actions">
            <button
              className="primary"
              disabled={
                !start || (mode === 'path' && (!target || target === start.id)) || busy || working
              }
              onClick={() => {
                setNotice('');
                useEditor.getState().explore({
                  version: 1,
                  mode,
                  startId: start!.id,
                  ...(mode === 'path' ? { targetId: target } : {}),
                  direction,
                  steps,
                  directed,
                  includeHidden,
                });
              }}
            >
              {t('data.analysis.exploreAction')}
            </button>
            <button disabled={!previous || busy} onClick={() => useEditor.getState().explore()}>
              {t('data.analysis.resetAction')}
            </button>
          </div>
          {previous && (
            <p role="status">
              {working
                ? t('data.analysis.exploring')
                : result
                  ? result.found
                    ? t(
                        result.truncated
                          ? 'data.analysis.truncatedCount'
                          : 'data.analysis.shownCount',
                        { count: result.nodeIds.length },
                      )
                    : t('data.analysis.noPath')
                  : localizedFeedback(useEditor.getState().explorationError ?? '', t)}
            </p>
          )}
        </section>
        <section aria-label={t('data.analysis.savedAccessible')}>
          <h3>
            <Bookmark size={17} />
            {t('data.analysis.savedTitle')}
          </h3>
          <p>{t('data.analysis.sharedViewsExplanation')}</p>
          <label className="field">
            {t('data.analysis.viewNameLabel')}
            <input
              aria-label={t('data.analysis.viewNameAccessible')}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('data.analysis.viewNamePlaceholder')}
            />
          </label>
          <div className="analysis-actions">
            <button
              disabled={busy || !name.trim()}
              onClick={() => action(() => useEditor.getState().saveView(name))}
            >
              {t('data.analysis.saveAction')}
            </button>
          </div>
          <label className="field">
            {t('data.analysis.savedLabel')}
            <select
              aria-label={t('data.analysis.savedSelectAccessible')}
              value={viewId}
              onChange={(event) => {
                setViewId(event.target.value);
                setName(views.find((view) => view.id === event.target.value)?.name ?? '');
              }}
            >
              <option value="">{t('data.analysis.chooseSaved', { count: views.length })}</option>
              {views.map((view) => (
                <option value={view.id} key={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
          <div className="analysis-actions">
            <button className="primary" disabled={busy || !viewId} onClick={() => void load()}>
              {t('data.analysis.loadAction')}
            </button>
            <button
              disabled={busy || !viewId || !name.trim()}
              onClick={() => action(() => useEditor.getState().saveView(name, viewId))}
            >
              {t('data.analysis.updateAction')}
            </button>
            <button
              className="danger"
              disabled={busy || !viewId}
              onClick={() => {
                useEditor.getState().deleteView(viewId);
                setNotice('Saved view deleted.');
              }}
            >
              {t('data.analysis.deleteAction')}
            </button>
          </div>
          <p className="muted">{t('data.analysis.sourceSharingUndo')}</p>
        </section>
        {!!notice && (
          <p role="status" className="analysis-notice">
            {localizedFeedback(notice, t)}
          </p>
        )}
      </div>
    </Modal>
  );
}
