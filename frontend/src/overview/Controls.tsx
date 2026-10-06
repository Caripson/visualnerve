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
          Overview{config.enabled ? ` · ${projection.counts.representedNodes} cards` : ''}
        </span>
      </summary>
      <div className="overview-controls-body">
        <div className="overview-view-switch" role="group" aria-label="Diagram detail view">
          <button aria-pressed={config.enabled} onClick={() => chooseView(true)}>
            Overview
          </button>
          <button aria-pressed={!config.enabled} onClick={() => chooseView(false)}>
            Details
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
          Semantic overview
        </label>
        <label>
          Group objects by
          <select
            value={config.grouping}
            disabled={!config.enabled}
            onChange={(event) =>
              update({ grouping: event.target.value as OverviewGrouping, expanded: [] })
            }
          >
            <option value="auto">Hierarchy, tags and source</option>
            <option value="groups">Diagram hierarchy</option>
            <option value="tags">Primary tag</option>
            <option value="source">Source file or schema</option>
          </select>
        </label>
        <p>
          {projection.counts.originalNodes.toLocaleString()} visible objects and{' '}
          {projection.counts.originalEdges.toLocaleString()} relationships. Summaries retain every
          original object and direction.
        </p>
        {config.enabled && (
          <>
            <p>
              Zoom in or expand a summary for more detail. Overview placement is read-only; turn it
              off for Details, moving objects and freehand notes.
            </p>
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
              Back one level
            </button>
            <button
              onClick={() => {
                update({ expanded: [] });
                window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
              }}
            >
              <ChevronsLeft size={14} />
              Collapse to overview
            </button>
            {projection.bounded && (
              <p role="status">
                Detail is limited to 2,000 cards at once. Remaining objects stay represented by
                summary cards; filter or open a smaller area.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
