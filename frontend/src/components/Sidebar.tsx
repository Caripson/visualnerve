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
    const folder = d.folder || 'Unfiled';
    folders.set(folder, [...(folders.get(folder) ?? []), d]);
  }
  return (
    <aside className="sidebar">
      <div className="workspace-label">
        <span className="workspace-symbol">VN</span>
        <div>
          <b>Personal workspace</b>
          <small>Stored in this browser</small>
        </div>
        <span className="local-dot" title="Local workspace" />
        <button
          className="mobile-only"
          aria-label="Close projects"
          onClick={() => useEditor.setState({ mobilePanel: null })}
        >
          <X size={18} />
        </button>
      </div>
      <button className="primary new-diagram" onClick={() => open('new')}>
        <Plus size={16} />
        New diagram<span>⌘ N</span>
      </button>
      <nav className="workspace-nav">
        <button className={section === 'all' ? 'active' : ''} onClick={() => setSection('all')}>
          <GitBranch size={16} />
          Diagrams<span>{diagrams.length}</span>
        </button>
        <button onClick={() => open('search')}>
          <Search size={16} />
          Search<span>⌘ K</span>
        </button>
        <button
          className={section === 'recent' ? 'active' : ''}
          onClick={() => setSection('recent')}
        >
          <Clock3 size={16} />
          Recently edited
        </button>
        <button
          className={section === 'favorites' ? 'active' : ''}
          onClick={() => setSection('favorites')}
        >
          <Star size={16} />
          Favorites
        </button>
        <button onClick={() => open('owners')}>
          <Users size={16} />
          Owners
        </button>
        <button onClick={() => open('new')}>
          <LayoutTemplate size={16} />
          Templates
        </button>
      </nav>
      <div className="sidebar-section-title">
        {section === 'favorites'
          ? 'FAVORITES'
          : section === 'recent'
            ? 'RECENT DIAGRAMS'
            : 'YOUR DIAGRAMS'}
        <button
          className="icon-button"
          title="New diagram"
          aria-label="Add diagram"
          onClick={() => open('new')}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="diagram-filter">
        <Search size={13} />
        <input
          aria-label="Filter diagrams"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter diagrams…"
        />
      </div>
      <div className="list-filters">
        <select aria-label="Sort diagrams" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="updated">Last edited</option>
          <option value="name">Name</option>
          <option value="created">Newest created</option>
        </select>
        {tags.length > 0 && (
          <select
            aria-label="Filter diagram tags"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">All tags</option>
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
                <span>{folder}</span>
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
            {diagrams.length
              ? 'No matching diagrams.'
              : 'Your ideas start here.\nCreate your first diagram.'}
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <BackupNudge settings={() => open('settings')} />
        <button onClick={importFile}>
          <Upload size={15} />
          Import
        </button>
        <button onClick={() => open('sql')}>
          <Database size={15} />
          Import SQL script
        </button>
        <button onClick={() => open('code')}>
          <Code2 size={15} />
          Visualize code
        </button>
        <button onClick={() => open('settings')}>
          <Settings size={15} />
          Settings
        </button>
        <div className="local-note">
          <span className="local-dot" />
          Your diagrams stay in this browser.
        </div>
        <a className="author-credit" href="/license/">
          Johan Caripson · MPL-2.0
        </a>
      </div>
    </aside>
  );
}
