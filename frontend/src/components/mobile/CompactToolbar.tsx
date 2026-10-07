import { Maximize, Menu, PanelRight, Plus, Redo2, Undo2 } from 'lucide-react';
import { useEditor } from '../../state/editor';
import { DocumentTitle } from '../../ui/DocumentTitle';
import { CompactDiagramActions } from './CompactDiagramActions';
import type { CompactToolbarProps } from './compact-toolbar-types';

export function CompactToolbar(props: CompactToolbarProps) {
  const { graph, spatial, mindmap, canUndo, canRedo, status, statusIcon, switchView, add, fit } =
    props;
  const statusText =
    { saved: 'Saved', saving: 'Saving…', error: 'Error', conflict: 'Conflict' }[status] ?? status;
  const mobilePanel = useEditor((state) => state.mobilePanel);
  return (
    <>
      <header className="document-bar compact-document-bar">
        <button
          className="project-menu"
          aria-label="Open projects"
          aria-haspopup="dialog"
          aria-expanded={mobilePanel === 'projects'}
          onClick={() => useEditor.setState({ mobilePanel: 'projects' })}
        >
          <Menu size={20} />
        </button>
        <DocumentTitle />
        <span
          className={`save-status save-${status}`}
          role="status"
          aria-label={statusText}
          title={statusText}
        >
          {statusIcon}
          {statusText}
        </span>
        <button
          className="compact-edit-button"
          aria-label="Open properties"
          aria-haspopup="dialog"
          aria-expanded={mobilePanel === 'details'}
          onClick={() => useEditor.setState({ mobilePanel: 'details' })}
        >
          <PanelRight size={18} />
          <span>Edit</span>
        </button>
        <CompactDiagramActions {...props} />
      </header>
      <nav className="editor-toolbar compact-editor-toolbar" aria-label="Diagram tools">
        <div
          className="spatial-view-bar compact-view-toggle"
          role="group"
          aria-label="Diagram view"
        >
          <button aria-label="2D view" aria-pressed={!spatial} onClick={() => switchView('2d')}>
            2D
          </button>
          <button aria-label="3D view" aria-pressed={spatial} onClick={() => switchView('3d')}>
            3D
          </button>
        </div>
        <button
          className="add-node"
          aria-label={mindmap ? (graph.nodes.length ? 'Add subtopic' : 'Central idea') : 'Add node'}
          onClick={add}
        >
          <Plus size={19} />
          <span>{mindmap ? 'Topic' : 'Node'}</span>
        </button>
        <button aria-label="Fit diagram" title="Fit diagram" disabled={spatial} onClick={fit}>
          <Maximize size={19} />
        </button>
        <button aria-label="Undo" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
          <Undo2 size={19} />
        </button>
        <button aria-label="Redo" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
          <Redo2 size={19} />
        </button>
      </nav>
    </>
  );
}
