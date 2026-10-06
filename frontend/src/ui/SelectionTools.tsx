import {
  Copy,
  Pencil,
  Trash2,
  Palette,
  GitBranch,
  ListTodo,
  CircleCheck,
  RotateCcw,
} from 'lucide-react';
import { useEditor } from '../state/editor';
import { colorPalette } from './colors';
import { IconPicker, iconKey, withIcon } from './icons';
import { nodeStatuses, statusLabel } from './status';

export function SelectionTools() {
  const graph = useEditor((state) => state.graph);
  const nodes = useEditor((state) => state.selectedNodes);
  const edges = useEditor((state) => state.selectedEdges);
  if (!graph || (!nodes.length && !edges.length)) return null;
  const selected = new Set(nodes);
  const objects = graph.nodes.filter((node) => selected.has(node.id));
  const first = objects[0];
  const statuses = [...new Set(objects.map((node) => node.status ?? ''))];
  const allDone = objects.length > 0 && statuses.length === 1 && statuses[0] === 'done';
  let mixedValue = '__mixed_status__';
  while (statuses.includes(mixedValue)) mixedValue += '_';
  const canBranch =
    graph.diagram.type === 'mindmap' &&
    first &&
    graph.nodes.some((node) => node.parentId === first.id);
  const color = (value: string) =>
    useEditor.getState().command('Color selection', (g) => ({
      ...g,
      nodes: g.nodes.map((node) => (selected.has(node.id) ? { ...node, color: value } : node)),
    }));
  const status = (value: string) =>
    useEditor.getState().command('Set object status', (g) => ({
      ...g,
      nodes: g.nodes.map((node) => (selected.has(node.id) ? { ...node, status: value } : node)),
    }));
  return (
    <div className="selection-tools" aria-label="Selection actions">
      <button
        aria-label="Edit selected item"
        title="Edit item"
        onClick={() => {
          useEditor.setState({ mobilePanel: 'details' });
          requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('.properties input')?.focus();
          });
        }}
      >
        <Pencil size={17} />
        <span>Edit</span>
      </button>
      {first && (
        <>
          <details className="quick-picker status-picker">
            <summary aria-label="Choose status" title="Status">
              <ListTodo size={17} />
              <span>Status</span>
            </summary>
            <div className="picker-panel status-picker-panel">
              <label>
                Status for {objects.length === 1 ? 'this object' : `${objects.length} objects`}
                <select
                  aria-label="Selection status"
                  value={statuses.length > 1 ? mixedValue : statuses[0]}
                  onChange={(e) => {
                    status(e.target.value);
                    const picker = e.currentTarget.closest('details');
                    picker?.removeAttribute('open');
                    picker?.querySelector('summary')?.focus();
                  }}
                >
                  {statuses.length > 1 && (
                    <option value={mixedValue} disabled>
                      Mixed statuses
                    </option>
                  )}
                  <option value="">None</option>
                  {nodeStatuses.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                  {statuses
                    .filter(
                      (value) => value && !nodeStatuses.some((choice) => choice.value === value),
                    )
                    .map((value) => (
                      <option key={value} value={value}>
                        {statusLabel(value)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </details>
          <button
            className={`completion-action ${allDone ? 'is-done' : ''}`}
            aria-label={allDone ? 'Reopen selected objects' : 'Mark selected objects done'}
            title={allDone ? 'Reopen as In progress' : 'Mark as Done'}
            onClick={() => status(allDone ? 'in-progress' : 'done')}
          >
            {allDone ? <RotateCcw size={17} /> : <CircleCheck size={17} />}
            <span>{allDone ? 'Reopen' : 'Done'}</span>
          </button>
          <details className="quick-picker color-picker">
            <summary aria-label="Choose color" title="Color">
              <Palette size={17} />
              <span>Color</span>
            </summary>
            <div className="picker-panel" role="group" aria-label="Colors">
              <div className="color-grid">
                {colorPalette.map((choice) => (
                  <button
                    key={choice.value}
                    aria-label={`Color: ${choice.name}`}
                    title={choice.name}
                    style={{ background: choice.value }}
                    onClick={(e) => {
                      color(choice.value);
                      e.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  />
                ))}
              </div>
              <label className="custom-color">
                Custom color
                <input
                  aria-label="Custom selection color"
                  type="color"
                  value={first.color || '#23664d'}
                  onChange={(e) => color(e.target.value)}
                />
              </label>
            </div>
          </details>
          <IconPicker
            value={iconKey(first.metadata)}
            onChange={(icon) =>
              useEditor.getState().command('Icon selection', (g) => ({
                ...g,
                nodes: g.nodes.map((node) =>
                  selected.has(node.id)
                    ? { ...node, metadata: withIcon(node.metadata, icon) }
                    : node,
                ),
              }))
            }
          />
          <button
            aria-label="Duplicate selection"
            title="Duplicate (Ctrl/Cmd D)"
            onClick={() => {
              const clip = useEditor.getState().copy();
              if (clip) useEditor.getState().paste(clip);
            }}
          >
            <Copy size={17} />
          </button>
        </>
      )}
      <button
        className="danger"
        aria-label="Delete selection"
        title="Delete selection (Delete / Backspace)"
        onClick={() => useEditor.getState().remove()}
      >
        <Trash2 size={17} />
        <span>Delete</span>
      </button>
      {canBranch && (
        <button
          className="danger delete-branch"
          aria-label="Delete branch"
          title="Delete topic and all subtopics (Shift Delete)"
          onClick={() => useEditor.getState().remove(true)}
        >
          <GitBranch size={17} />
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
