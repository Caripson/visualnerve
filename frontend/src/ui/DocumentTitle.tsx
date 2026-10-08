import { useEffect, useRef, useState } from 'react';
import { GitBranch, Pencil } from 'lucide-react';
import { useEditor } from '../state/editor';
import { IconPicker, iconKey, withIcon } from './icons';
export function DocumentTitle() {
  const graph = useEditor((state) => state.graph)!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(graph.diagram.name);
  const active = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const begin = () => {
    active.current = true;
    setDraft(graph.diagram.name);
    setEditing(true);
  };
  const finish = (save: boolean) => {
    if (!active.current) return;
    active.current = false;
    if (save && draft.trim() && draft.trim() !== graph.diagram.name)
      useEditor.getState().command('Rename project', (g) => ({
        ...g,
        diagram: { ...g.diagram, name: draft.trim() },
      }));
    setEditing(false);
  };
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    active.current = false;
    setEditing(false);
  }, [graph.diagram.id]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const state = useEditor.getState();
      if (
        e.key === 'F2' &&
        !state.selectedNodes.length &&
        !state.selectedEdges.length &&
        !(e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[data-node-scroll]',
        )
      ) {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [graph.diagram.id, graph.diagram.name]);
  return (
    <div className="document-title">
      <div className="project-icon-picker">
        <IconPicker
          compact
          fallback={GitBranch}
          label="Project icon"
          value={iconKey(graph.diagram.metadata)}
          onChange={(icon) =>
            useEditor.getState().command('Project icon', (g) => ({
              ...g,
              diagram: { ...g.diagram, metadata: withIcon(g.diagram.metadata, icon) },
            }))
          }
        />
      </div>
      {editing ? (
        <input
          ref={input}
          className="project-title-input"
          aria-label="Project name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(true);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            }
          }}
        />
      ) : (
        <h1 aria-label={graph.diagram.name}>
          <button
            className="project-title-button"
            aria-label={`Rename project: ${graph.diagram.name}`}
            title="Rename project (F2)"
            onClick={begin}
          >
            {graph.diagram.name}
            <Pencil size={12} />
          </button>
        </h1>
      )}
      <span className="mode-badge">{graph.diagram.type}</span>
    </div>
  );
}
