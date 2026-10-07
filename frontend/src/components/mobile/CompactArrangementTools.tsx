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
  return (
    <>
      <h3>Edit and arrange</h3>
      {!mindmap && (
        <label className="field">
          New node type
          <select
            aria-label="New node type"
            value={kind}
            onChange={(event) => setKind(event.target.value as NodeKind)}
          >
            {Object.entries(nodeRegistry).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {mindmap && (
        <button className="full" disabled={!selectionCount} onClick={addSibling}>
          <GitBranch size={17} />
          Add sibling
        </button>
      )}
      <button className="full" disabled={graph.nodes.length < 2} onClick={() => open('connect')}>
        <ArrowRight size={17} />
        Connect nodes
      </button>
      <button
        className="full"
        disabled={selectionCount < 2}
        onClick={() => useEditor.getState().group()}
      >
        <Layers size={17} />
        Group selection
      </button>
      <label className="field">
        Layout direction
        <select
          aria-label="Mobile layout direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value as Direction)}
        >
          {mindmap && <option value="BALANCED">Balanced branches</option>}
          <option value="RIGHT">Left → Right</option>
          <option value="LEFT">Right → Left</option>
          <option value="DOWN">Top → Bottom</option>
          <option value="UP">Bottom → Top</option>
          <option value="RADIAL">Radial</option>
        </select>
      </label>
      <button
        className="full"
        disabled={spatial || busy || !graph.nodes.length}
        onClick={() => void runLayout()}
      >
        <GitBranch size={17} />
        {busy ? 'Laying out…' : 'Auto layout'}
      </button>
      <button className={`full ${showFilters ? 'active' : ''}`} onClick={toggleFilters}>
        <SlidersHorizontal size={17} />
        Filters
      </button>
      {graph.diagram.type === 'timeline' && (
        <label className="field">
          Timeline zoom
          <select
            aria-label="Timeline zoom"
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
            {['day', 'week', 'month', 'quarter', 'year'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
