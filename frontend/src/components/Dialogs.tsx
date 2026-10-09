import { presentationMessage } from '../presentation/display-messages';
import { diagramModeLabel, templateLabel } from '../ui/editor-labels';
import { ownerKindKeys } from './ui-labels';
import { APP_LOCALES, useI18n, type AppLocale } from '../i18n';
import { VoiceSettings } from './VoiceSettings';
import { useEffect, useRef, useState } from 'react';
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
import { Field } from './Field';
import { useEditor } from '../state/editor';
import { flushSpatialCamera, workspace } from '../storage/workspace';
import { templates } from '../templates/templates';
import { createTemplateDiagram } from '../templates/create';
import { type Owner, type Graph, ownersFor } from '../model/types';
import { download, markdown, safeName } from '../export/semantic';
import { DataPrivacy, StorageNotice } from './DataPrivacy';
import { McpSettings } from './McpSettings';
import { ImportSettings } from './ImportSettings';
import { ProjectFileLimitSettings } from './ProjectFileLimitSettings';
import { exportAllData } from '../storage/backup';
import type { WorkspaceBackup } from '../storage/database';
import type { RenderOptions } from '../export/rendered';
import {
  assertExportActive,
  checkExportActive,
  waitForExport,
  type ExportGuard,
} from '../export/guard';
import type { WorkspaceOperation } from '../storage/contracts';
import { getSpatialView } from '../spatial/types';
import { BackupSecurityNotice } from '../security/BackupSecurityNotice';
import { VaultSettings } from '../security/VaultSettings';
import { vaultSession } from '../storage/runtime';
import { isEncryptedWorkspaceSurface } from '../security/surface';
export function NewDiagram({ close }: { close: () => void }) {
  const { t: translate } = useI18n();
  const [name, setName] = useState('Untitled diagram');
  const [template, setTemplate] = useState('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={translate('workspace.newDiagram')} close={close} wide>
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
        <Field title={translate('dialogs.nameField')}>
          <input
            aria-label={translate('dialogs.newDiagramName')}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            required
          />
        </Field>
        <div className="eyebrow template-label">{translate('dialogs.templateHeading')}</div>
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
              <b>{templateLabel(translate, t.key, t.name)}</b>
              <small>
                {t.key === 'process-simulator-blank'
                  ? translate('dialogs.templateGuidedProcessHint')
                  : t.key === 'process-simulator'
                    ? translate('dialogs.templateKioskHint')
                    : t.key === 'delivery-network-simulator'
                      ? translate('dialogs.templateNestedProcessHint')
                      : t.nodes
                        ? translate('dialogs.templateCounts', {
                            count: t.nodes,
                            type: diagramModeLabel(translate, t.type),
                          })
                        : translate('dialogs.blankTemplateHint')}
              </small>
            </button>
          ))}
        </div>
        {error && <p className="form-error">{presentationMessage(error, translate)}</p>}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            {translate('dialogs.cancel')}
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? translate('dialogs.creating') : translate('dialogs.createDiagram')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ExportDialog({ close }: { close: () => void }) {
  const { t } = useI18n();
  const mounted = useRef(true);
  const exporting = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exporting.current?.abort();
    };
  }, []);
  const cancel = () => {
    exporting.current?.abort();
    close();
  };
  const spatial = useEditor((state) =>
    state.graph ? getSpatialView(state.graph).mode === '3d' : false,
  );
  const [target, setTarget] = useState('diagram');
  const [format, setFormat] = useState<'json' | 'markdown' | 'svg' | 'png' | 'pdf'>('json');
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
    <Field title={t('dialogs.exportField')}>
      <select
        aria-label={t('dialogs.exportTarget')}
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      >
        <option value="diagram">{t('dialogs.exportDiagram')}</option>
        <option value="workspace">{t('dialogs.exportAllBackupLabel')}</option>
      </select>
    </Field>
  );
  if (target === 'workspace')
    return (
      <Modal title={t('dialogs.exportAllBackupLabel')} close={close}>
        {targetField}
        <p>{t('dialogs.exportPortableBackupHint')}</p>
        <StorageNotice />
        <BackupSecurityNotice encrypted={isEncryptedWorkspaceSurface()} />
        {error && <p className="form-error">{presentationMessage(error, t)}</p>}
        <div className="modal-actions">
          <button onClick={close}>{t('dialogs.cancel')}</button>
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
            {t('dialogs.exportAllDataAction')}
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title={t('dialogs.exportDiagram')} close={cancel}>
      {targetField}
      <Field title={t('dialogs.formatField')}>
        <select
          aria-label={t('dialogs.exportFormat')}
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
        >
          <option value="json">{t('dialogs.exportJsonOption')}</option>
          <option value="markdown">{t('dialogs.exportMarkdownOption')}</option>
          <option value="svg">{t('dialogs.exportSvgOption')}</option>
          <option value="png">{t('dialogs.exportPngOption')}</option>
          <option value="pdf">{t('dialogs.exportPdfOption')}</option>
        </select>
      </Field>
      {(format === 'json' || format === 'markdown') && (
        <BackupSecurityNotice encrypted={isEncryptedWorkspaceSurface()} />
      )}
      {(format === 'svg' || format === 'png' || format === 'pdf') && (
        <>
          <Field title={t('dialogs.exportAreaField')}>
            <select
              aria-label={t('dialogs.exportAreaAria')}
              value={options.scope}
              onChange={(e) => set({ scope: e.target.value as RenderOptions['scope'] })}
            >
              <option value="complete">{t('dialogs.exportCompleteArea')}</option>
              <option value="viewport">
                {spatial || format === 'svg'
                  ? t('dialogs.exportSaved2DViewport')
                  : t('dialogs.exportCurrentViewport')}
              </option>
              <option value="selected">{t('dialogs.exportSelectedNodes')}</option>
            </select>
          </Field>
          {format !== 'svg' && (
            <Field title={t('dialogs.exportResolutionField')}>
              <select
                aria-label={t('dialogs.exportResolutionAria')}
                value={options.multiplier}
                onChange={(e) => set({ multiplier: Number(e.target.value) as 1 | 2 | 4 })}
              >
                {[1, 2, 4].map((v) => (
                  <option key={v} value={v}>
                    {t('dialogs.exportMultiplier', { multiplier: v })}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      {format === 'pdf' && (
        <>
          <div className="field-row">
            <Field title={t('dialogs.exportPaperField')}>
              <select
                aria-label={t('dialogs.exportPaperAria')}
                value={options.page}
                onChange={(e) => set({ page: e.target.value as 'a4' | 'a3' })}
              >
                <option value="a4">A4</option>
                <option value="a3">A3</option>
              </select>
            </Field>
            <Field title={t('dialogs.exportOrientationField')}>
              <select
                aria-label={t('dialogs.exportOrientationAria')}
                value={options.orientation}
                onChange={(e) =>
                  set({ orientation: e.target.value as RenderOptions['orientation'] })
                }
              >
                <option value="landscape">{t('dialogs.exportLandscape')}</option>
                <option value="portrait">{t('dialogs.exportPortrait')}</option>
              </select>
            </Field>
          </div>
          <label className="check-field">
            <input
              aria-label={t('dialogs.exportTileAria')}
              type="checkbox"
              checked={options.tiled}
              onChange={(e) => set({ tiled: e.target.checked })}
            />
            {t('dialogs.exportTileLabel')}
          </label>
        </>
      )}
      <p className="muted">
        {format === 'json'
          ? t('dialogs.exportJsonHint')
          : format === 'markdown'
            ? t('dialogs.exportMarkdownHint')
            : format === 'svg'
              ? t('dialogs.exportSvgHint')
              : spatial
                ? t('dialogs.exportSpatialHint')
                : t('dialogs.exportRenderedHint')}
      </p>
      <StorageNotice />
      {error && <p className="form-error">{presentationMessage(error, t)}</p>}
      <div className="modal-actions">
        <button onClick={cancel}>{t('dialogs.cancel')}</button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (exporting.current) return;
            const controller = new AbortController();
            exporting.current = controller;
            let operation: WorkspaceOperation | undefined;
            let guard: ExportGuard | undefined;
            // Capture before settled/import/render awaits; a later unlock must not
            // authorize this original dialog or change which graph it exports.
            const captured = workspace.repo.db.captureOperation();
            setBusy(true);
            setError('');
            try {
              useEditor.getState().finishEditing();
              flushSpatialCamera();
              const state = useEditor.getState();
              const g = state.graph
                ? structuredClone(ownersFor(state.graph, state.owners))
                : undefined;
              const selection = [...state.selectedNodes];
              operation = await captured;
              guard = {
                signal: AbortSignal.any([operation.signal, controller.signal]),
                check: () => operation!.check(),
                assertCurrent: () => {
                  if (
                    !mounted.current ||
                    exporting.current !== controller ||
                    controller.signal.aborted
                  )
                    throw new DOMException('Diagram export cancelled.', 'AbortError');
                },
              };
              await checkExportActive(guard);
              assertExportActive(guard);
              if (!g) return;
              await waitForExport(workspace.settled(), guard);
              await checkExportActive(guard);
              assertExportActive(guard);
              const name = safeName(g.diagram.name);
              if (format === 'json') download(`${name}.json`, JSON.stringify(g, null, 2));
              else if (format === 'markdown') download(`${name}.md`, markdown(g), 'text/markdown');
              else if (format === 'svg') {
                const { exportSVG } = await waitForExport(import('../export/svg'), guard);
                assertExportActive(guard);
                await exportSVG(g, options.scope, selection, guard);
              } else {
                const { exportRendered } = await waitForExport(import('../export/rendered'), guard);
                assertExportActive(guard);
                await exportRendered(g, format, options, selection, guard);
              }
              assertExportActive(guard);
              close();
            } catch (e) {
              if (mounted.current && !controller.signal.aborted && !operation?.signal.aborted)
                setError((e as Error).message);
            } finally {
              // A synchronous snapshot error may occur before capture resolves.
              (operation ?? (await captured.catch(() => undefined)))?.dispose();
              if (exporting.current === controller) exporting.current = undefined;
              if (mounted.current) setBusy(false);
            }
          }}
        >
          <Download size={15} />
          {busy ? t('dialogs.exportRendering') : t('dialogs.exportField')}
        </button>
      </div>
    </Modal>
  );
}
export function OwnersDialog({ close }: { close: () => void }) {
  const { t } = useI18n();
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
    <Modal title={t('workspace.owners')} close={close} wide>
      <div className="owner-dialog">
        <div className="owner-list">
          <input
            aria-label={t('dialogs.searchOwners')}
            placeholder={t('dialogs.searchOwnersPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="full" onClick={() => choose(null)}>
            <Plus size={14} />
            {t('dialogs.newOwner')}
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
                  <small>{o.team || t(ownerKindKeys[o.kind])}</small>
                </span>
              </button>
            ))}
          {!owners.length && <p className="muted">{t('dialogs.ownersHint')}</p>}
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
          <h3>{selected ? t('dialogs.editOwner') : t('dialogs.newOwner')}</h3>
          <Field title={t('dialogs.nameField')}>
            <input
              aria-label={t('dialogs.ownerNameAria')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field title={t('dialogs.ownerKindField')}>
            <select
              aria-label={t('dialogs.ownerKindAria')}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {(
                ['person', 'team', 'department', 'system', 'organization', 'external'] as const
              ).map((v) => (
                <option key={v} value={v}>
                  {t(ownerKindKeys[v])}
                </option>
              ))}
            </select>
          </Field>
          <Field title={t('dialogs.ownerTeamField')}>
            <input
              aria-label={t('dialogs.ownerTeamAria')}
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            />
          </Field>
          <Field title={t('dialogs.ownerRoleField')}>
            <input
              aria-label={t('dialogs.ownerRoleAria')}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </Field>
          <Field title={t('dialogs.ownerEmailField')}>
            <input
              aria-label={t('dialogs.ownerEmailAria')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field title={t('dialogs.ownerColorField')}>
            <input
              aria-label={t('dialogs.ownerColorAria')}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{presentationMessage(error, t)}</p>}
          <button className="primary full" disabled={busy || !name.trim()}>
            <Users size={14} />
            {busy
              ? t('workspace.saving')
              : selected
                ? t('dialogs.saveOwner')
                : t('dialogs.createOwner')}
          </button>
        </form>
      </div>
    </Modal>
  );
}
export function SearchDialog({ close }: { close: () => void }) {
  const { t } = useI18n();
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
    <Modal title={t('dialogs.searchWorkspaceTitle')} close={close}>
      <div className="search-input">
        <SearchIcon size={17} />
        <input
          aria-label={t('dialogs.globalSearchAria')}
          autoFocus
          placeholder={t('dialogs.globalSearchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="muted">{presentationMessage(error, t)}</p>}
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
        {query && !results.length && (
          <p className="muted">{t('dialogs.globalNoResults', { query })}</p>
        )}
      </div>
    </Modal>
  );
}
export function SettingsDialog({
  close,
  theme,
  setTheme,
  restore,
  onReadBackup,
}: {
  close: () => void;
  theme: string;
  setTheme: (value: string) => void;
  restore: (backup: WorkspaceBackup) => void;
  onReadBackup?: (file: File) => Promise<WorkspaceBackup>;
}) {
  const {
    t,
    requestedLocale,
    selectLocale,
    loading,
    error: languageError,
    persistenceError,
    retry,
  } = useI18n();
  return (
    <Modal title={t('app.settings')} close={close}>
      <section className="app-language-settings" aria-label={t('settings.appLanguage')}>
        <Field title={t('settings.appLanguage')}>
          <select
            aria-label={t('settings.appLanguage')}
            data-testid="app-language"
            value={requestedLocale}
            onChange={(event) => selectLocale(event.target.value as AppLocale)}
          >
            {APP_LOCALES.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <p className="muted">{t('settings.languageHelp')}</p>
        {loading && <p role="status">{t('settings.languageLoading')}</p>}
        {languageError && (
          <div role="alert">
            <p>{t('settings.languageLoadFailed')}</p>
            <button type="button" onClick={retry}>
              {t('settings.retryLanguage')}
            </button>
          </div>
        )}
        {persistenceError && <p role="status">{t('settings.languageSaveFailed')}</p>}
      </section>
      <Field title={t('settings.appearanceField')}>
        <select
          aria-label={t('settings.themeField')}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
          <option value="system">{t('settings.themeSystem')}</option>
        </select>
      </Field>
      <DataPrivacy restore={restore} deleted={close} onReadBackup={onReadBackup} />
      {vaultSession && <VaultSettings session={vaultSession} />}
      <ImportSettings />
      <ProjectFileLimitSettings />
      <VoiceSettings />
      <McpSettings />
      <div className="property-section">{t('settings.shortcutsTitle')}</div>
      <div className="shortcuts">
        {[
          [t('toolbar.undo'), '⌘ / Ctrl Z'],
          [t('toolbar.redo'), '⌘ / Ctrl Shift Z'],
          [t('settings.shortcutCopyPaste'), '⌘ / Ctrl C / V'],
          [t('settings.shortcutDuplicate'), '⌘ / Ctrl D'],
          [t('settings.shortcutGroup'), '⌘ / Ctrl G'],
          [t('settings.shortcutFind'), '⌘ / Ctrl F'],
          [t('toolbar.fitDiagram'), 'F'],
          [t('settings.shortcutRename'), 'F2'],
          [t('settings.shortcutAddRelative'), 'Tab / Enter'],
          [t('settings.shortcutDelete'), 'Delete / Shift Delete'],
          [t('settings.shortcutPan'), t('settings.keySpaceDrag')],
          [t('settings.shortcutNudge'), t('settings.keyArrowKeys')],
        ].map(([label, key]) => (
          <div key={label}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <a href="/help/" target="_blank" rel="noopener noreferrer">
          {t('settings.helpDocumentation')}
        </a>
        <a
          href="https://github.com/Caripson/visualnerve/issues/new/choose"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('settings.reportIssue')}
        </a>
        <button onClick={close}>{t('dialogs.done')}</button>
      </div>
      <p className="author-credit">
        {t('settings.createdBy', { author: 'Johan Caripson' })} ·{' '}
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
  const { t } = useI18n();
  const g = useEditor((s) => s.graph);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t('dialogs.deleteDiagramTitle')} close={close}>
      <p>{t('dialogs.deleteDiagramQuestion', { name: g?.diagram.name ?? '' })}</p>
      <p className="muted">{t('dialogs.deleteDiagramHint')}</p>
      {error && <p className="form-error">{presentationMessage(error, t)}</p>}
      <div className="modal-actions">
        <button onClick={close}>{t('dialogs.cancel')}</button>
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
          {t('dialogs.deletePermanently')}
        </button>
      </div>
    </Modal>
  );
}
export function ConnectDialog({ close }: { close: () => void }) {
  const { t } = useI18n();
  const g = useEditor((s) => s.graph);
  const selected = useEditor((s) => s.selectedNodes);
  const [source, setSource] = useState(selected[0] ?? g?.nodes[0]?.id ?? '');
  const [target, setTarget] = useState(selected[1] ?? g?.nodes[1]?.id ?? '');
  return (
    <Modal title={t('toolbar.connectNodes')} close={close}>
      <p className="muted">{t('dialogs.connectCanvasHint')}</p>
      <Field title={t('dialogs.connectFromField')}>
        <select
          aria-label={t('dialogs.connectFromAria')}
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
      <Field title={t('dialogs.connectToField')}>
        <select
          aria-label={t('dialogs.connectToAria')}
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
        <button onClick={close}>{t('dialogs.cancel')}</button>
        <button
          className="primary"
          disabled={!source || !target}
          onClick={() => {
            useEditor.getState().connect(source, target);
            close();
          }}
        >
          {t('dialogs.connectAction')}
        </button>
      </div>
    </Modal>
  );
}
