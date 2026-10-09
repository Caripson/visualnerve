import { useI18n } from '../i18n';
import { useMemo, useRef, useState } from 'react';
import { Copy, Download, ExternalLink } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../state/editor';
import type { Graph } from '../model/types';
import { getCsvNode } from '../data/csv';
import { getDrawingLayer } from '../drawing/types';
import { getCodeAnalysis, getCodeObject, getProjectDirectory } from '../code/schema';
import { getSqlQuerySource, getSqlQueryResult } from '../sql/query-schema';
import { buildLovablePrompt, lovableLink, type LovableScope } from '../export/lovable';
import { download, safeName } from '../export/semantic';
import './lovable.css';
import { BuildSpecificationEditor } from './BuildSpecificationEditor';
import { lovableDisplayMessage } from './lovable-display';

const scopes: LovableScope[] = ['diagram', 'selected', 'csv-view'];
type Draft = { version: 1; instructions: string; scope: LovableScope };

function readDraft(graph: Graph, defaultScope: LovableScope): Draft {
  const value = graph.diagram.settings.lovable;
  const draft =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  return {
    version: 1,
    instructions:
      draft?.version === 1 && typeof draft.instructions === 'string' ? draft.instructions : '',
    scope:
      draft?.version === 1 && scopes.includes(draft.scope as LovableScope)
        ? (draft.scope as LovableScope)
        : defaultScope,
  };
}

export function LovableDialog({ close }: { close: () => void }) {
  const { t, number } = useI18n();
  const graph = useEditor((state) => state.graph);
  const owners = useEditor((state) => state.owners);
  const selectedNodes = useEditor((state) => state.selectedNodes);
  const preview = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState('');
  const hasCsv = useMemo(
    () => !!graph?.dataset || !!graph?.nodes.some((node) => getCsvNode(node)),
    [graph?.dataset, graph?.nodes],
  );
  const selectedIds = useMemo(() => {
    const existing = new Set(graph?.nodes.map((node) => node.id));
    return selectedNodes.filter((id) => existing.has(id));
  }, [graph?.nodes, selectedNodes]);
  const defaultScope: LovableScope = hasCsv ? 'csv-view' : 'diagram';
  const draft = graph ? readDraft(graph, defaultScope) : undefined;
  const scope =
    draft?.scope === 'selected' && !selectedIds.length
      ? defaultScope
      : draft?.scope === 'csv-view' && !hasCsv
        ? 'diagram'
        : (draft?.scope ?? defaultScope);
  const instructions = draft?.instructions ?? '';
  const prompt = useMemo(() => {
    if (!graph) return undefined;
    const combinedOwners = new Map([...graph.owners, ...owners].map((owner) => [owner.id, owner]));
    return buildLovablePrompt({ ...graph, owners: [...combinedOwners.values()] }, instructions, {
      scope,
      selectedIds,
    });
  }, [graph, owners, instructions, scope, selectedIds]);
  const link = useMemo(() => lovableLink(prompt?.text ?? ''), [prompt?.text]);
  if (!graph || !prompt) return null;

  const update = (patch: Partial<Pick<Draft, 'instructions' | 'scope'>>) => {
    setNotice('');
    useEditor.getState().command(
      patch.scope ? 'Change Lovable scope' : 'Edit Lovable brief',
      (current) => ({
        ...current,
        diagram: {
          ...current.diagram,
          settings: {
            ...current.diagram.settings,
            lovable: { ...readDraft(current, defaultScope), scope, ...patch },
          },
        },
      }),
      !patch.scope,
    );
  };
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(prompt.text);
      setNotice('Build prompt copied.');
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setNotice(
        'Clipboard access is unavailable. The complete prompt is selected; copy it with your keyboard or device copy menu.',
      );
    }
  };

  return (
    <Modal title={t('lovable.title')} close={close} wide>
      <div className="lovable-dialog">
        <p className="lovable-intro">{t('lovable.introduction')}</p>
        <label className="field lovable-instructions">
          {t('lovable.instructions')}
          <textarea
            aria-label={t('lovable.instructions')}
            value={instructions}
            rows={4}
            placeholder={t('lovable.instructionsHint')}
            onChange={(event) => update({ instructions: event.target.value })}
          />
          <span className="muted">{t('lovable.localInstructions')}</span>
        </label>
        <label className="field">
          {t('lovable.include')}
          <select
            aria-label={t('lovable.scope')}
            value={scope}
            onChange={(event) => update({ scope: event.target.value as LovableScope })}
          >
            <option value="diagram">{t('lovable.entireDiagram')}</option>
            <option value="selected" disabled={!selectedIds.length}>
              {selectedIds.length
                ? t('lovable.selected', { count: number(selectedIds.length) })
                : t('lovable.noneSelected')}
            </option>
            <option value="csv-view" disabled={!hasCsv}>
              {t('lovable.csvGroups')}
            </option>
          </select>
        </label>
        <p className="lovable-scope-note">
          {scope === 'diagram'
            ? t('lovable.scopeDiagram')
            : scope === 'selected'
              ? t('lovable.scopeSelected')
              : t('lovable.scopeCsv')}
        </p>
        <dl className="lovable-counts" aria-label={t('lovable.contents')}>
          <div>
            <dt>{t('lovable.objects')}</dt>
            <dd>{number(prompt.nodeCount)}</dd>
          </div>
          <div>
            <dt>{t('lovable.relationships')}</dt>
            <dd>{number(prompt.edgeCount)}</dd>
          </div>
          <div>
            <dt>{t('lovable.boundary')}</dt>
            <dd>{number(prompt.boundaryCount)}</dd>
          </div>
        </dl>
        <p className="lovable-disclosure">{t('lovable.disclosure')}</p>
        {graph.nodes.some((node) => getSqlQuerySource(node) || getSqlQueryResult(node)) && (
          <p className="lovable-disclosure">{t('lovable.sqlDisclosure')}</p>
        )}
        {(getCodeAnalysis(graph) ||
          graph.nodes.some((node) => getCodeObject(node) || getProjectDirectory(node))) && (
          <p className="lovable-disclosure">{t('lovable.codeDisclosure')}</p>
        )}
        {!!getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length && (
          <p className="lovable-drawing-note">{t('lovable.drawingNote')}</p>
        )}
        <BuildSpecificationEditor specification={prompt.specification} />
        <label className="field lovable-preview">
          {t('lovable.exactPrompt')}
          <textarea
            ref={preview}
            aria-label={t('lovable.promptAria')}
            readOnly
            value={prompt.text}
            rows={10}
            spellCheck={false}
          />
        </label>
        {link.reason && (
          <p className="lovable-link-note">{lovableDisplayMessage(link.reason, t, number)}</p>
        )}
        {notice && (
          <p role="status" className="lovable-copy-notice">
            {lovableDisplayMessage(notice, t, number)}
          </p>
        )}
        <div className="modal-actions lovable-actions">
          <button type="button" onClick={() => void copy()}>
            <Copy size={16} />
            {t('lovable.copy')}
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                `${safeName(graph.diagram.name)}-lovable-brief.md`,
                prompt.text,
                'text/markdown',
              )
            }
          >
            <Download size={16} />
            {t('lovable.download')}
          </button>
          {link.url ? (
            <a className="lovable-open" href={link.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              {t('lovable.open')}
            </a>
          ) : (
            <button type="button" className="primary" disabled>
              <ExternalLink size={16} />
              {t('lovable.open')}
            </button>
          )}
        </div>
        {!link.url && (
          <a
            className="lovable-manual-link"
            href="https://lovable.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} />
            {t('lovable.openManual')}
          </a>
        )}
      </div>
    </Modal>
  );
}
