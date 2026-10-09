import { useI18n } from '../i18n';
import { useMemo, useState } from 'react';
import {
  Clock3,
  Folder,
  FolderOpen,
  GitBranch,
  LayoutTemplate,
  Plus,
  Search,
  Settings,
  Star,
  Upload,
  Users,
  ChevronDown,
  ChevronRight,
  X,
  Database,
  Code2,
} from 'lucide-react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import type { DialogName } from '../App';
import { BackupNudge } from './DataPrivacy';
import { AreaIcon } from '../ui/icons';
export function Sidebar({
  open,
  importFile,
}: {
  open: (name: DialogName) => void;
  importFile: () => void;
}) {
  const { t } = useI18n();
  const diagrams = useEditor((s) => s.diagrams);
  const current = useEditor((s) => s.graph?.diagram.id);
  const [section, setSection] = useState<'all' | 'recent' | 'favorites'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [tag, setTag] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tags = [...new Set(diagrams.flatMap((d) => d.tags))].filter(Boolean).sort();
  const list = useMemo(
    () =>
      diagrams
        .filter(
          (d) =>
            (section !== 'favorites' || d.favorite) &&
            (!tag || d.tags.includes(tag)) &&
            `${d.name} ${d.description ?? ''} ${d.folder ?? ''} ${d.tags.join(' ')} ${JSON.stringify(d.metadata)}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : sort === 'created'
              ? b.createdAt.localeCompare(a.createdAt)
              : b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, section === 'recent' ? 12 : undefined),
    [diagrams, section, tag, query, sort],
  );
  const folders = new Map<string, typeof list>();
  for (const d of list) {
    const folder = d.folder || '';
    folders.set(folder, [...(folders.get(folder) ?? []), d]);
  }
  return (
    <aside className="sidebar">
      <div className="workspace-label">
        <span className="workspace-symbol">VN</span>
        <div>
          <b>{t('workspace.personalTitle')}</b>
          <small>{t('workspace.storedBrowser')}</small>
        </div>
        <span className="local-dot" title={t('workspace.localWorkspaceTooltip')} />
        <button
          className="mobile-only"
          data-mobile-panel-dismiss="projects"
          aria-label={t('workspace.closeProjects')}
          onClick={() => useEditor.setState({ mobilePanel: null })}
        >
          <X size={18} />
        </button>
      </div>
      <button className="primary new-diagram" onClick={() => open('new')}>
        <Plus size={16} />
        {t('workspace.newDiagram')}
        <span>⌘ N</span>
      </button>
      <nav className="workspace-nav">
        <button className={section === 'all' ? 'active' : ''} onClick={() => setSection('all')}>
          <GitBranch size={16} />
          {t('workspace.diagrams')}
          <span>{diagrams.length}</span>
        </button>
        <button onClick={() => open('search')}>
          <Search size={16} />
          {t('workspace.search')}
          <span>⌘ K</span>
        </button>
        <button
          className={section === 'recent' ? 'active' : ''}
          onClick={() => setSection('recent')}
        >
          <Clock3 size={16} />
          {t('workspace.recentlyEdited')}
        </button>
        <button
          className={section === 'favorites' ? 'active' : ''}
          onClick={() => setSection('favorites')}
        >
          <Star size={16} />
          {t('workspace.favorites')}
        </button>
        <button onClick={() => open('owners')}>
          <Users size={16} />
          {t('workspace.owners')}
        </button>
        <button onClick={() => open('new')}>
          <LayoutTemplate size={16} />
          {t('workspace.templates')}
        </button>
      </nav>
      <div className="sidebar-section-title">
        {section === 'favorites'
          ? t('workspace.favoriteSectionTitle')
          : section === 'recent'
            ? t('workspace.recentSectionTitle')
            : t('workspace.allSectionTitle')}
        <button
          className="icon-button"
          title={t('workspace.newDiagram')}
          aria-label={t('workspace.addDiagram')}
          onClick={() => open('new')}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="diagram-filter">
        <Search size={13} />
        <input
          aria-label={t('workspace.filterDiagrams')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('workspace.filterPlaceholder')}
        />
      </div>
      <div className="list-filters">
        <select
          aria-label={t('workspace.sortDiagrams')}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="updated">{t('workspace.sortLastEdited')}</option>
          <option value="name">{t('workspace.sortName')}</option>
          <option value="created">{t('workspace.sortCreated')}</option>
        </select>
        {tags.length > 0 && (
          <select
            aria-label={t('workspace.filterTags')}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">{t('workspace.allTags')}</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      <div className="diagram-list">
        {[...folders]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([folder, items]) => (
            <div className="folder-group" key={folder}>
              <button
                className="folder-heading"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(folder)) next.delete(folder);
                    else next.add(folder);
                    return next;
                  })
                }
              >
                {collapsed.has(folder) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {collapsed.has(folder) ? <Folder size={13} /> : <FolderOpen size={13} />}
                <span>{folder || t('workspace.unfiledDisplay')}</span>
                <small>{items.length}</small>
              </button>
              {!collapsed.has(folder) &&
                items.map((d) => (
                  <button
                    className={`diagram-item ${current === d.id ? 'active' : ''}`}
                    key={d.id}
                    onClick={() => {
                      useEditor.setState({ mobilePanel: null });
                      void workspace.open(d.id);
                    }}
                    data-diagram-id={d.id}
                  >
                    <AreaIcon metadata={d.metadata} fallback={GitBranch} size={14} />
                    <span>{d.name}</span>
                    {d.favorite && <Star size={11} fill="currentColor" />}
                  </button>
                ))}
            </div>
          ))}
        {!list.length && (
          <div className="list-empty">
            {diagrams.length ? t('workspace.noMatchingDiagrams') : t('workspace.emptyIntro')}
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <BackupNudge settings={() => open('settings')} />
        <button onClick={importFile}>
          <Upload size={15} />
          {t('workspace.import')}
        </button>
        <button onClick={() => open('sql')}>
          <Database size={15} />
          {t('toolbar.importSql')}
        </button>
        <button onClick={() => open('code')}>
          <Code2 size={15} />
          {t('toolbar.visualizeCode')}
        </button>
        <button onClick={() => open('settings')}>
          <Settings size={15} />
          {t('app.settings')}
        </button>
        <div className="local-note">
          <span className="local-dot" />
          {t('workspace.localFooterHint')}
        </div>
        <a className="author-credit" href="/license/">
          Johan Caripson · MPL-2.0
        </a>
      </div>
    </aside>
  );
}
