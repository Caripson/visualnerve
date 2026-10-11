import { Check, CircleAlert, Download, LoaderCircle, Menu, Settings } from 'lucide-react';
import { useEditor } from '../state/editor';
import { DocumentTitle } from '../ui/DocumentTitle';
import type { DialogName } from '../App';
import { useI18n } from '../i18n';

export function AnalyticsToolbar({ open }: { open: (name: DialogName) => void }) {
  const status = useEditor((state) => state.status);
  const { t } = useI18n();
  const Icon = status === 'saved' ? Check : status === 'saving' ? LoaderCircle : CircleAlert;
  return (
    <div className="document-bar analytics-document-bar">
      <button
        className="mobile-only project-menu"
        data-mobile-panel-trigger="projects"
        aria-label={t('workspace.openProjects')}
        onClick={() => useEditor.setState({ mobilePanel: 'projects' })}
      >
        <Menu size={19} />
      </button>
      <DocumentTitle />
      <div className="document-actions">
        <span className={`save-status save-${status}`} role="status">
          <Icon size={14} />
          {status === 'saved'
            ? t('workspace.saved')
            : status === 'saving'
              ? t('workspace.saving')
              : t('workspace.error')}
        </span>
        <button onClick={() => open('export')} aria-label="Export analysis document">
          <Download size={16} />
          <span>Export</span>
        </button>
        <button onClick={() => open('settings')} aria-label="Workspace settings">
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
