import { svgGraphSnapshot } from '../export/svg-snapshot';
import { canonicalSVGSelection } from '../export/selection';
import { exchangeGraphSnapshot } from '../export/exchange-scene';
import { presentationMessage } from '../presentation/display-messages';
import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { useEditor } from '../state/editor';
import { flushSpatialCamera, workspace } from '../storage/workspace';
import { ownersFor } from '../model/types';
import { download, markdown, safeName } from '../export/semantic';
import { StorageNotice } from './DataPrivacy';
import { exportAllData } from '../storage/backup';
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
import { isEncryptedWorkspaceSurface } from '../security/surface';
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
  const [format, setFormat] = useState<
    'json' | 'markdown' | 'svg' | 'png' | 'pdf' | 'drawio' | 'vsdx'
  >('json');
  const [options, setOptions] = useState<RenderOptions>({
    scope: 'complete',
    multiplier: 2,
    page: 'a4',
    orientation: 'landscape',
    tiled: false,
  });
  const [busy, setBusy] = useState(false);
  const [svgProgress, setSvgProgress] = useState<number | undefined>(undefined);
  const [error, setError] = useState('');
  const editable = format === 'drawio' || format === 'vsdx';
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
          onChange={(e) => {
            const next = e.target.value as typeof format;
            if ((next === 'drawio' || next === 'vsdx') && options.scope === 'viewport')
              set({ scope: 'complete' });
            setFormat(next);
          }}
        >
          <option value="json">{t('dialogs.exportJsonOption')}</option>
          <option value="markdown">{t('dialogs.exportMarkdownOption')}</option>
          <option value="drawio">{t('dialogs.exportDrawioOption')}</option>
          <option value="vsdx">{t('dialogs.exportVisioOption')}</option>
          <option value="svg">{t('dialogs.exportSvgOption')}</option>
          <option value="png">{t('dialogs.exportPngOption')}</option>
          <option value="pdf">{t('dialogs.exportPdfOption')}</option>
        </select>
      </Field>
      {(format === 'json' || format === 'markdown') && (
        <BackupSecurityNotice encrypted={isEncryptedWorkspaceSurface()} />
      )}
      {(format === 'svg' || format === 'png' || format === 'pdf' || editable) && (
        <>
          <Field title={t('dialogs.exportAreaField')}>
            <select
              aria-label={t('dialogs.exportAreaAria')}
              value={options.scope}
              onChange={(e) => set({ scope: e.target.value as RenderOptions['scope'] })}
            >
              <option value="complete">{t('dialogs.exportCompleteArea')}</option>
              {!editable && (
                <option value="viewport">
                  {spatial || format === 'svg'
                    ? t('dialogs.exportSaved2DViewport')
                    : t('dialogs.exportCurrentViewport')}
                </option>
              )}
              <option value="selected">{t('dialogs.exportSelectedNodes')}</option>
            </select>
          </Field>
          {!editable && format !== 'svg' && (
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
        {editable
          ? t('dialogs.exportEditable2DHint')
          : format === 'json'
            ? t('dialogs.exportJsonHint')
            : format === 'markdown'
              ? t('dialogs.exportMarkdownHint')
              : format === 'svg'
                ? t('dialogs.exportSvgHint')
                : spatial
                  ? t('dialogs.exportSpatialHint')
                  : t('dialogs.exportRenderedHint')}
      </p>
      {format === 'svg' && <p className="muted">{t('dialogs.exportSvgSourceHint')}</p>}
      {editable && options.scope !== 'selected' && (
        <p className="muted">{t('dialogs.exportEditableFullHint')}</p>
      )}
      {editable && <p className="muted">{t('dialogs.exportEditableHint')}</p>}
      {format === 'vsdx' && (
        <p role="note" className="storage-notice">
          {t('dialogs.exportVisioPreviewHint')}
        </p>
      )}
      {busy && svgProgress !== undefined && (
        <div role="status" aria-live="polite">
          <p>
            {t(editable ? 'dialogs.exportEditableProgress' : 'dialogs.exportSvgProgress', {
              percent: svgProgress,
            })}
          </p>
          <progress
            aria-label={t(
              editable ? 'dialogs.exportEditableProgress' : 'dialogs.exportSvgProgress',
              { percent: svgProgress },
            )}
            max={100}
            value={svgProgress}
            style={{ width: '100%' }}
          />
          <p className="muted">{t('dialogs.exportSvgBackgroundHint')}</p>
        </div>
      )}
      {!editable && <StorageNotice />}
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
            setSvgProgress(undefined);
            setError('');
            try {
              useEditor.getState().finishEditing();
              flushSpatialCamera();
              const state = useEditor.getState();
              const source = state.graph ? ownersFor(state.graph, state.owners) : undefined;
              const g = source
                ? editable
                  ? exchangeGraphSnapshot(source)
                  : format === 'svg'
                    ? svgGraphSnapshot(source)
                    : structuredClone(source)
                : undefined;
              const selection =
                editable && source
                  ? canonicalSVGSelection(source, state.selectedNodes)
                  : [...state.selectedNodes];
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
              else if (format === 'drawio' || format === 'vsdx') {
                const { exportExchangeSnapshot } = await waitForExport(
                  import('../export/exchange-download'),
                  guard,
                );
                await exportExchangeSnapshot(
                  g,
                  format,
                  options.scope === 'selected' ? 'selected' : 'complete',
                  selection,
                  guard,
                  (status) => {
                    if (mounted.current && !guard!.signal.aborted) setSvgProgress(status.progress);
                  },
                );
              } else if (format === 'svg') {
                const { exportSVG } = await waitForExport(import('../export/svg'), guard);
                assertExportActive(guard);
                await exportSVG(g, options.scope, selection, guard, (status) => {
                  if (mounted.current && !guard!.signal.aborted) setSvgProgress(status.progress);
                });
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
