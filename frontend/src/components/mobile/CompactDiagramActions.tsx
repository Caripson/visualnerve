import {
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
  const { graph, open, newSpatialExample } = props;
  return (
    <ToolbarMenu label="Diagram actions" icon={<MoreHorizontal size={21} />} text={false}>
      <h3>Diagram</h3>
      <button className="full" onClick={() => open('new')}>
        <Plus size={17} />
        New diagram
      </button>
      <button className="full" onClick={() => open('search')}>
        <Search size={17} />
        Search
      </button>
      <button
        className="full"
        aria-label="Diagram player"
        onClick={() => {
          useEditor.getState().finishEditing();
          presentation.open();
        }}
      >
        <Clapperboard size={17} />
        Diagram player
      </button>
      <button className="full" aria-label="Export" onClick={() => open('export')}>
        <Download size={17} />
        Export
      </button>
      <button
        className="full"
        onClick={() => {
          useEditor.getState().select([]);
          useEditor.setState({ mobilePanel: 'details' });
        }}
      >
        <PanelRight size={17} />
        Project properties
      </button>
      <CompactArrangementTools {...props} />
      <DataToolActions graph={graph} open={open} />
      <UnderstandingActions open={open} />
      <h3>Import and build</h3>
      <button className="full" onClick={() => open('code')}>
        <Code2 size={17} />
        Visualize code
      </button>
      <button className="full" onClick={() => open('sql')}>
        <Database size={17} />
        Import SQL script
      </button>
      <button className="full" onClick={() => open('lovable')}>
        <Sparkles size={17} />
        Build with Lovable
      </button>
      <button className="full" onClick={() => void newSpatialExample()}>
        New 3D truck lifecycle example
      </button>
      <h3>Workspace</h3>
      <button className="full" onClick={() => open('settings')}>
        <Settings size={17} />
        Settings
      </button>
      <a className="compact-menu-link" href="/help/">
        User guide
      </a>
      <a className="compact-menu-link" href="/api/docs">
        API documentation
      </a>
      <a className="compact-menu-link" href="/license/">
        About and license
      </a>
      <a
        className="compact-menu-link"
        href="https://github.com/Caripson/visualnerve"
        aria-label="Visual Nerve on GitHub"
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub
      </a>
      <button className="full danger" onClick={() => open('delete')}>
        <Trash2 size={17} />
        Delete diagram
      </button>
    </ToolbarMenu>
  );
}
