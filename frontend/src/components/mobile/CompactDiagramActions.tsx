import { useI18n } from '../../i18n';
import {
  Users,
  Clapperboard,
  Code2,
  Database,
  Download,
  MoreHorizontal,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { presentation } from '../../presentation/service';
import { useEditor } from '../../state/editor';
import { DataToolActions } from '../ToolbarDataTools';
import { ToolbarMenu } from '../ToolbarMenu';
import { UnderstandingActions } from '../UnderstandingTools';
import { CompactArrangementTools } from './CompactArrangementTools';
import type { CompactToolbarProps } from './compact-toolbar-types';

export function CompactDiagramActions(props: CompactToolbarProps) {
  const { t } = useI18n();
  const { graph, open, newSpatialExample } = props;
  return (
    <ToolbarMenu
      label={t('mobile.diagramActionsMenu')}
      icon={<MoreHorizontal size={21} />}
      text={false}
    >
      <h3>{t('mobile.diagramTitle')}</h3>
      <button className="full" onClick={() => open('collaboration')}>
        <Users size={17} />
        {t('collaboration.open')}
      </button>
      <button className="full" onClick={() => open('new')}>
        <Plus size={17} />
        {t('workspace.newDiagram')}
      </button>
      <button className="full" onClick={() => open('search')}>
        <Search size={17} />
        {t('workspace.search')}
      </button>
      <button
        className="full"
        aria-label={t('toolbar.playerAria')}
        onClick={() => {
          useEditor.getState().finishEditing();
          presentation.open();
        }}
      >
        <Clapperboard size={17} />
        {t('toolbar.playerAria')}
      </button>
      <button className="full" aria-label={t('dialogs.exportField')} onClick={() => open('export')}>
        <Download size={17} />
        {t('dialogs.exportField')}
      </button>
      <button
        className="full"
        onClick={() => {
          useEditor.getState().select([]);
          useEditor.setState({ mobilePanel: 'details' });
        }}
      >
        <PanelRight size={17} />
        {t('toolbar.projectProperties')}
      </button>
      <CompactArrangementTools {...props} />
      <DataToolActions graph={graph} open={open} />
      <UnderstandingActions open={open} />
      <h3>{t('toolbar.importBuildTitle')}</h3>
      <button className="full" onClick={() => open('code')}>
        <Code2 size={17} />
        {t('toolbar.visualizeCode')}
      </button>
      <button className="full" onClick={() => open('sql')}>
        <Database size={17} />
        {t('toolbar.importSql')}
      </button>
      <button className="full" onClick={() => open('lovable')}>
        <Sparkles size={17} />
        {t('toolbar.buildLovable')}
      </button>
      <button className="full" onClick={() => void newSpatialExample()}>
        {t('toolbar.truckExampleAction')}
      </button>
      <h3>{t('mobile.workspaceTitle')}</h3>
      <button className="full" onClick={() => open('settings')}>
        <Settings size={17} />
        {t('app.settings')}
      </button>
      <a className="compact-menu-link" href="/help/">
        {t('mobile.userGuide')}
      </a>
      <a className="compact-menu-link" href="/api/docs">
        {t('mobile.apiDocs')}
      </a>
      <a className="compact-menu-link" href="/license/">
        {t('mobile.aboutLicense')}
      </a>
      <a
        className="compact-menu-link"
        href="https://github.com/Caripson/visualnerve/issues/new/choose"
        aria-label={t('mobile.reportIssueGitHub')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('settings.reportIssue')}
      </a>
      <button className="full danger" onClick={() => open('delete')}>
        <Trash2 size={17} />
        {t('dialogs.deleteDiagramTitle')}
      </button>
    </ToolbarMenu>
  );
}
