import { useI18n } from '../../i18n';
import { Maximize, Menu, PanelRight, Plus, Redo2, Undo2 } from 'lucide-react';
import { useEditor } from '../../state/editor';
import { DocumentTitle } from '../../ui/DocumentTitle';
import { CompactDiagramActions } from './CompactDiagramActions';
import type { CompactToolbarProps } from './compact-toolbar-types';

export function CompactToolbar(props: CompactToolbarProps) {
  const { t } = useI18n();
  const { graph, spatial, mindmap, canUndo, canRedo, status, statusIcon, switchView, add, fit } =
    props;
  const statusText =
    {
      saved: t('workspace.saved'),
      saving: t('workspace.saving'),
      error: t('workspace.error'),
      conflict: t('workspace.conflict'),
    }[status] ?? status;
  const mobilePanel = useEditor((state) => state.mobilePanel);
  return (
    <>
      <header className="document-bar compact-document-bar">
        <button
          className="project-menu"
          data-mobile-panel-trigger="projects"
          aria-label={t('workspace.openProjects')}
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
          data-mobile-panel-trigger="details"
          aria-label={t('workspace.openProperties')}
          aria-haspopup="dialog"
          aria-expanded={mobilePanel === 'details'}
          onClick={() => useEditor.setState({ mobilePanel: 'details' })}
        >
          <PanelRight size={18} />
          <span>{t('mobile.edit')}</span>
        </button>
        <CompactDiagramActions {...props} />
      </header>
      <nav
        className="editor-toolbar compact-editor-toolbar"
        aria-label={t('mobile.diagramToolsNav')}
      >
        <div
          className="spatial-view-bar compact-view-toggle"
          role="group"
          aria-label={t('toolbar.diagramViewGroup')}
        >
          <button
            aria-label={t('toolbar.view2DAria')}
            aria-pressed={!spatial}
            onClick={() => switchView('2d')}
          >
            2D
          </button>
          <button
            aria-label={t('toolbar.view3DAria')}
            aria-pressed={spatial}
            onClick={() => switchView('3d')}
          >
            3D
          </button>
        </div>
        <button
          className="add-node"
          aria-label={
            mindmap
              ? graph.nodes.length
                ? t('toolbar.addSubtopic')
                : t('toolbar.centralIdea')
              : t('toolbar.addNode')
          }
          onClick={add}
        >
          <Plus size={19} />
          <span>{mindmap ? t('mobile.topic') : t('mobile.node')}</span>
        </button>
        <button
          aria-label={t('toolbar.fitDiagram')}
          title={t('toolbar.fitDiagram')}
          disabled={spatial}
          onClick={fit}
        >
          <Maximize size={19} />
        </button>
        <button
          aria-label={t('toolbar.undo')}
          disabled={!canUndo}
          onClick={() => useEditor.getState().undo()}
        >
          <Undo2 size={19} />
        </button>
        <button
          aria-label={t('toolbar.redo')}
          disabled={!canRedo}
          onClick={() => useEditor.getState().redo()}
        >
          <Redo2 size={19} />
        </button>
      </nav>
    </>
  );
}
