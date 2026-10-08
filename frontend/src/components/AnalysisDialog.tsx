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
    <Modal title="Relationships and analysis views" close={close} wide>
      <div className="analysis-dialog">
        <section aria-label="Relationship exploration">
          <h3>
            <Network size={17} />
            Explore relationships
          </h3>
          <p>
            Start from {start ? <strong>{start.title}</strong> : 'an object selected on the canvas'}
            . Exploration changes the displayed objects; your diagram and connections stay intact.
          </p>
          <label className="field">
            Explore
            <select
              aria-label="Relationship exploration mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="neighbors">Connected neighbors</option>
              <option value="path">Shortest path</option>
            </select>
          </label>
          {mode === 'neighbors' ? (
            <div className="analysis-fields">
              <label className="field">
                Relationships
                <select
                  aria-label="Neighbor direction"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as typeof direction)}
                >
                  <option value="all">All relationships</option>
                  <option value="incoming">Incoming</option>
                  <option value="outgoing">Outgoing</option>
                </select>
              </label>
              <label className="field">
                Distance
                <select
                  aria-label="Neighbor steps"
                  value={steps}
                  onChange={(event) => setSteps(Number(event.target.value) as 1 | 2)}
                >
                  <option value={1}>One step</option>
                  <option value={2}>Two steps</option>
                </select>
              </label>
            </div>
          ) : (
            <>
              <label className="field">
                Find destination
                <input
                  aria-label="Find path destination"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search object titles"
                />
              </label>
              <label className="field">
                Destination
                <select
                  aria-label="Path destination"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">Choose another object</option>
                  {destinations.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title} · {node.id.slice(0, 8)}
                      {getCsvNode(node)?.visible === false ? ' · outside current data view' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Shows at most 100 search matches. Refine the search to find another object.
              </p>
              <label className="analysis-check">
                <input
                  type="checkbox"
                  aria-label="Follow relationship directions"
                  checked={directed}
                  onChange={(event) => setDirected(event.target.checked)}
                />
                Follow relationship directions
              </label>
            </>
          )}
          <label className="analysis-check">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(event) => setIncludeHidden(event.target.checked)}
            />
            Include groups outside the current data view
          </label>
          {includeHidden && (
            <p className="analysis-warning">
              These retained CSV groups may contain earlier measures. They are marked “Outside
              current data view” on the canvas.
            </p>
          )}
          <p className="muted">
            Directed exploration follows arrowheads. Relationships without arrows can be traversed
            with All relationships or an undirected path. Object filters and collapsed branches are
            temporarily overridden. Views are limited to 500 objects and 2,000 connections.
          </p>
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
              Explore relationships
            </button>
            <button disabled={!previous || busy} onClick={() => useEditor.getState().explore()}>
              Reset exploration
            </button>
          </div>
          {previous && (
            <p role="status">
              {working
                ? 'Exploring…'
                : result
                  ? result.found
                    ? `${result.nodeIds.length} objects shown.${result.truncated ? ' The result exceeds the view limit; refine your exploration.' : ''}`
                    : 'No path found with these directions and visibility settings.'
                  : useEditor.getState().explorationError}
            </p>
          )}
        </section>
        <section aria-label="Saved analysis views">
          <h3>
            <Bookmark size={17} />
            Named analysis views
          </h3>
          <p>
            Save filters, source analyses, relationship configuration, layout, collapsed branches
            and viewport over the same shared sources. Notes, statuses, drawing marks and manual
            connections remain current when switching views.
          </p>
          <label className="field">
            View name
            <input
              aria-label="Analysis view name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="For example, blocked customer dependencies"
            />
          </label>
          <div className="analysis-actions">
            <button
              disabled={busy || !name.trim()}
              onClick={() => action(() => useEditor.getState().saveView(name))}
            >
              Save current view
            </button>
          </div>
          <label className="field">
            Saved view
            <select
              aria-label="Saved analysis view"
              value={viewId}
              onChange={(event) => {
                setViewId(event.target.value);
                setName(views.find((view) => view.id === event.target.value)?.name ?? '');
              }}
            >
              <option value="">Choose a saved view ({views.length})</option>
              {views.map((view) => (
                <option value={view.id} key={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
          <div className="analysis-actions">
            <button className="primary" disabled={busy || !viewId} onClick={() => void load()}>
              Load view
            </button>
            <button
              disabled={busy || !viewId || !name.trim()}
              onClick={() => action(() => useEditor.getState().saveView(name, viewId))}
            >
              Update saved view
            </button>
            <button
              className="danger"
              disabled={busy || !viewId}
              onClick={() => {
                useEditor.getState().deleteView(viewId);
                setNotice('Saved view deleted.');
              }}
            >
              Delete saved view
            </button>
          </div>
          <p className="muted">
            Source rows are shared, never copied into a view. Saving and loading views can be
            undone.
          </p>
        </section>
        {!!notice && (
          <p role="status" className="analysis-notice">
            {notice}
          </p>
        )}
      </div>
    </Modal>
  );
}
