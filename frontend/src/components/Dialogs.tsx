import { VoiceSettings } from './VoiceSettings';
import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  GitBranch,
  Plus,
  Search as SearchIcon,
  Trash2,
  Users,
} from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Properties';
import { useEditor } from '../state/editor';
import { flushSpatialCamera, workspace } from '../storage/workspace';
import { database } from '../storage/database';
import { templates } from '../templates/templates';
import { createTemplateDiagram } from '../templates/create';
import { type Owner, type Graph, ownersFor } from '../model/types';
import { download, markdown, safeName } from '../export/semantic';
import { DataPrivacy, StorageNotice } from './DataPrivacy';
import { McpSettings } from './McpSettings';
import { ImportSettings } from './ImportSettings';
import { exportAllData } from '../storage/backup';
import type { WorkspaceBackup } from '../storage/database';
import type { RenderOptions } from '../export/rendered';
import { getSpatialView } from '../spatial/types';
export function NewDiagram({ close }: { close: () => void }) {
  const [name, setName] = useState('Untitled diagram');
  const [template, setTemplate] = useState('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="New diagram" close={close} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await createTemplateDiagram(template, name);
            close();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <Field title="Name">
          <input
            aria-label="New diagram name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            required
          />
        </Field>
        <div className="eyebrow template-label">START WITH A TEMPLATE</div>
        <div className="template-grid">
          {templates.map((t) => (
            <button
              type="button"
              key={t.key}
              className={`template-option ${template === t.key ? 'selected' : ''}`}
              onClick={() => setTemplate(t.key)}
            >
              <div className={`template-preview preview-${t.type}`}>
                <span />
                <i />
                <i />
                <i />
              </div>
              <b>{t.name}</b>
              <small>
                {t.key === 'process-simulator-blank'
                  ? 'Guided setup for your own process'
                  : t.key === 'process-simulator'
                    ? 'Example · shared staff, queues and scenarios'
                    : t.nodes
                      ? `${t.nodes} nodes · ${t.type}`
                      : 'An open space for your ideas'}
              </small>
            </button>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create diagram'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ExportDialog({ close }: { close: () => void }) {
  const spatial = useEditor((state) =>
    state.graph ? getSpatialView(state.graph).mode === '3d' : false,
  );
  const [target, setTarget] = useState('diagram');
  const [format, setFormat] = useState<'json' | 'markdown' | 'png' | 'pdf'>('json');
  const [options, setOptions] = useState<RenderOptions>({
    scope: 'complete',
    multiplier: 2,
    page: 'a4',
    orientation: 'landscape',
    tiled: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<RenderOptions>) => setOptions((v) => ({ ...v, ...patch }));
  const targetField = (
    <Field title="Export">
      <select
        aria-label="Export target"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      >
        <option value="diagram">Export diagram</option>
        <option value="workspace">Export all data / backup</option>
      </select>
    </Field>
  );
  if (target === 'workspace')
    return (
      <Modal title="Export all data / backup" close={close}>
        {targetField}
        <p>
          One portable Visual Nerve backup contains all diagrams, owners, preferences and templates.
        </p>
        <StorageNotice />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportAllData();
                close();
              } catch (error) {
                setError((error as Error).message);
                setBusy(false);
              }
            }}
          >
            <Download size={15} />
            Export all data
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title="Export diagram" close={close}>
      {targetField}
      <Field title="Format">
        <select
          aria-label="Export format"
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
        >
          <option value="json">JSON · complete graph</option>
          <option value="markdown">Markdown · semantic outline</option>
          <option value="png">PNG · rendered diagram</option>
          <option value="pdf">PDF · printable diagram</option>
        </select>
      </Field>
      {(format === 'png' || format === 'pdf') && (
        <>
          <Field title="Area">
            <select
              aria-label="Export area"
              value={options.scope}
              onChange={(e) => set({ scope: e.target.value as RenderOptions['scope'] })}
            >
              <option value="complete">Complete diagram</option>
              <option value="viewport">{spatial ? 'Saved 2D viewport' : 'Current viewport'}</option>
              <option value="selected">Selected nodes</option>
            </select>
          </Field>
          <Field title="Resolution">
            <select
              aria-label="Export resolution"
              value={options.multiplier}
              onChange={(e) => set({ multiplier: Number(e.target.value) as 1 | 2 | 4 })}
            >
              {[1, 2, 4].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {format === 'pdf' && (
        <>
          <div className="field-row">
            <Field title="Paper">
              <select
                aria-label="PDF paper"
                value={options.page}
                onChange={(e) => set({ page: e.target.value as 'a4' | 'a3' })}
              >
                <option value="a4">A4</option>
                <option value="a3">A3</option>
              </select>
            </Field>
            <Field title="Orientation">
              <select
                aria-label="PDF orientation"
                value={options.orientation}
                onChange={(e) =>
                  set({ orientation: e.target.value as RenderOptions['orientation'] })
                }
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </Field>
          </div>
          <label className="check-field">
            <input
              aria-label="Tile across pages"
              type="checkbox"
              checked={options.tiled}
              onChange={(e) => set({ tiled: e.target.checked })}
            />
            Tile across multiple pages
          </label>
        </>
      )}
      <p className="muted">
        {format === 'json'
          ? 'Includes nodes, relationships, owners, metadata, layout and view settings. Import this file to restore the diagram.'
          : format === 'markdown'
            ? 'Exports graph meaning as headings, process steps and relationships.'
            : spatial
              ? 'PNG and PDF use the 2D diagram, including drawing marks. Complete includes off-screen and collapsed nodes. Saved 2D viewport uses your last 2D crop, or fits the diagram if none is saved.'
              : 'Rendered locally from the canvas. Complete export includes off-screen and collapsed nodes.'}
      </p>
      <StorageNotice />
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              flushSpatialCamera();
              await workspace.settled();
              const state = useEditor.getState();
              if (!state.graph) return;
              const g = ownersFor(state.graph, state.owners);
              const name = safeName(g.diagram.name);
              if (format === 'json') download(`${name}.json`, JSON.stringify(g, null, 2));
              else if (format === 'markdown') download(`${name}.md`, markdown(g), 'text/markdown');
              else {
                const { exportRendered } = await import('../export/rendered');
                await exportRendered(g, format, options, state.selectedNodes);
              }
              close();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={15} />
          {busy ? 'Rendering…' : 'Export'}
        </button>
      </div>
    </Modal>
  );
}
export function OwnersDialog({ close }: { close: () => void }) {
  const owners = useEditor((s) => s.owners);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Owner | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [kind, setKind] = useState<Owner['kind']>('person');
  const [color, setColor] = useState('#31766c');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choose = (o: Owner | null) => {
    setSelected(o);
    setName(o?.name ?? '');
    setEmail(o?.email ?? '');
    setTeam(o?.team ?? '');
    setRole(o?.role ?? '');
    setKind(o?.kind ?? 'person');
    setColor(o?.color ?? '#31766c');
    setError('');
  };
  return (
    <Modal title="Owners" close={close} wide>
      <div className="owner-dialog">
        <div className="owner-list">
          <input
            aria-label="Search owners"
            placeholder="Search owners…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="full" onClick={() => choose(null)}>
            <Plus size={14} />
            New owner
          </button>
          {owners
            .filter((o) =>
              `${o.name} ${o.email} ${o.team} ${o.role} ${JSON.stringify(o.metadata)}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((o) => (
              <button
                key={o.id}
                className={`owner-row ${selected?.id === o.id ? 'active' : ''}`}
                onClick={() => choose(o)}
              >
                <span className="avatar" style={{ background: `${o.color}20`, color: o.color }}>
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <b>{o.name}</b>
                  <small>{o.team || o.kind}</small>
                </span>
              </button>
            ))}
          {!owners.length && (
            <p className="muted">People, teams and systems can own steps in your diagram.</p>
          )}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const data = {
                name,
                email,
                team,
                role,
                kind,
                color,
                metadata: selected?.metadata ?? {},
                ...(selected ? { version: selected.version } : {}),
              };
              const o = await workspace.execute<Owner>(
                selected ? `/owners/${selected.id}` : '/owners',
                selected ? 'PATCH' : 'POST',
                data,
              );
              await workspace.refresh();
              choose(o);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{selected ? 'Edit owner' : 'New owner'}</h3>
          <Field title="Name">
            <input
              aria-label="Owner name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field title="Kind">
            <select
              aria-label="Owner kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {['person', 'team', 'department', 'system', 'organization', 'external'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field title="Team">
            <input aria-label="Owner team" value={team} onChange={(e) => setTeam(e.target.value)} />
          </Field>
          <Field title="Role">
            <input aria-label="Owner role" value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field title="Email">
            <input
              aria-label="Owner email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field title="Color">
            <input
              aria-label="Owner color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
          <button className="primary full" disabled={busy || !name.trim()}>
            <Users size={14} />
            {busy ? 'Saving…' : selected ? 'Save owner' : 'Create owner'}
          </button>
        </form>
      </div>
    </Modal>
  );
}
export function SearchDialog({ close }: { close: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { diagramId: string; nodeId?: string; title: string; kind: string }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      try {
        const data = await workspace.execute<typeof results>(
          `/search?q=${encodeURIComponent(query)}`,
        );
        if (active) {
          setResults(data);
          setError('');
        }
      } catch (error) {
        if (active) setError((error as Error).message);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <Modal title="Search your workspace" close={close}>
      <div className="search-input">
        <SearchIcon size={17} />
        <input
          aria-label="Global search"
          autoFocus
          placeholder="Diagrams, nodes, tags, owners, metadata…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="muted">{error}</p>}
      <div className="search-results">
        {results.map((r, i) => (
          <button
            key={`${r.nodeId ?? r.diagramId}-${i}`}
            onClick={async () => {
              await workspace.open(r.diagramId, r.nodeId);
              close();
            }}
          >
            {r.kind === 'node' ? <GitBranch size={16} /> : <FileText size={16} />}
            <span>
              <b>{r.title}</b>
              <small>
                {useEditor.getState().diagrams.find((d) => d.id === r.diagramId)?.name ?? r.kind}
              </small>
            </span>
            <span className="muted">↵</span>
          </button>
        ))}
        {query && !results.length && <p className="muted">No results for “{query}”.</p>}
      </div>
    </Modal>
  );
}
export function SettingsDialog({
  close,
  theme,
  setTheme,
  restore,
}: {
  close: () => void;
  theme: string;
  setTheme: (value: string) => void;
  restore: (backup: WorkspaceBackup) => void;
}) {
  return (
    <Modal title="Settings" close={close}>
      <Field title="Appearance">
        <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </Field>
      <DataPrivacy restore={restore} deleted={close} />
      <ImportSettings />
      <VoiceSettings />
      <McpSettings />
      <div className="property-section">Keyboard shortcuts</div>
      <div className="shortcuts">
        {[
          ['Undo', '⌘ / Ctrl Z'],
          ['Redo', '⌘ / Ctrl Shift Z'],
          ['Copy / paste', '⌘ / Ctrl C / V'],
          ['Duplicate', '⌘ / Ctrl D'],
          ['Group', '⌘ / Ctrl G'],
          ['Find', '⌘ / Ctrl F'],
          ['Fit diagram', 'F'],
          ['Rename project / topic', 'F2'],
          ['Add child / sibling', 'Tab / Enter'],
          ['Delete selection / branch', 'Delete / Shift Delete'],
          ['Pan', 'Space + drag'],
          ['Nudge selection', 'Arrow keys'],
        ].map(([label, key]) => (
          <div key={label}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <a href="/help/" target="_blank" rel="noopener noreferrer">
          Help & documentation
        </a>
        <button onClick={close}>Done</button>
      </div>
      <p className="author-credit">
        Created by Johan Caripson ·{' '}
        <a href="/license/" target="_blank" rel="noopener noreferrer">
          MPL-2.0
        </a>{' '}
        ·{' '}
        <a href="https://github.com/Caripson/visualnerve" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </p>
    </Modal>
  );
}
export function DeleteDialog({ close }: { close: () => void }) {
  const g = useEditor((s) => s.graph);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Delete diagram" close={close}>
      <p>Delete “{g?.diagram.name}” and its nodes and connections?</p>
      <p className="muted">
        Export JSON first if you want a restorable copy. Owners remain in your workspace.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            if (!g) return;
            setBusy(true);
            try {
              await workspace.remove(g.diagram.id);
              close();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <Trash2 size={14} />
          Delete permanently
        </button>
      </div>
    </Modal>
  );
}
export function ConnectDialog({ close }: { close: () => void }) {
  const g = useEditor((s) => s.graph);
  const selected = useEditor((s) => s.selectedNodes);
  const [source, setSource] = useState(selected[0] ?? g?.nodes[0]?.id ?? '');
  const [target, setTarget] = useState(selected[1] ?? g?.nodes[1]?.id ?? '');
  return (
    <Modal title="Connect nodes" close={close}>
      <p className="muted">You can also drag between handles on the canvas.</p>
      <Field title="From">
        <select
          aria-label="Connection from"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {g?.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </Field>
      <Field title="To">
        <select
          aria-label="Connection to"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {g?.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </Field>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!source || !target}
          onClick={() => {
            useEditor.getState().connect(source, target);
            close();
          }}
        >
          Connect
        </button>
      </div>
    </Modal>
  );
}
