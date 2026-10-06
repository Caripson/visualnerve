import { useMemo } from 'react';
import { Modal } from '../components/Modal';
import { useEditor } from '../state/editor';
import { projectCanonicalOverview } from './projection';
import { getOverviewConfig, setOverviewConfig, type OverviewGrouping } from './types';
import { OVERVIEW_RESET_VIEW } from './Controls';
import './overview.css';
export function OverviewDialog({ close }: { close: () => void }) {
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
    <Modal title="Semantic overview" close={close}>
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
          Summarize related objects
        </label>
        <label>
          Grouping
          <select
            value={config.grouping}
            onChange={(event) =>
              update({ grouping: event.target.value as OverviewGrouping, expanded: [] })
            }
          >
            <option value="auto">Hierarchy, tags and source</option>
            <option value="groups">Diagram hierarchy</option>
            <option value="tags">Primary tag</option>
            <option value="source">Source files and SQL schemas</option>
          </select>
        </label>
        <p>
          {projection.counts.originalNodes.toLocaleString()} visible original objects →{' '}
          {projection.counts.representedNodes.toLocaleString()} displayed cards.
        </p>
        <p>
          Summary cards show object counts and status. Relationships keep their type and direction
          and show how many original connections they represent. Zoom in or expand a card to inspect
          more detail.
        </p>
        <p>
          Objects without hierarchy, tags or source information use clearly labeled layout areas and
          stable partitions. These are navigation aids.
        </p>
        <p>
          Overview placement is read-only. Turn off overview to edit the original diagram layout.
          Your source objects, relationships, filters and annotations stay available.
        </p>
        <button
          onClick={() => {
            update({ expanded: [] });
            window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
          }}
        >
          Collapse to overview
        </button>
        <button onClick={close}>Done</button>
      </div>
    </Modal>
  );
}
