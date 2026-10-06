import { useMemo, useRef, useState } from 'react';
import { Copy, Download, ExternalLink } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../state/editor';
import type { Graph } from '../model/types';
import { getCsvNode } from '../data/csv';
import { getDrawingLayer } from '../drawing/types';
import { getCodeObject } from '../code/schema';
import { getSqlQuerySource, getSqlQueryResult } from '../sql/query-schema';
import { buildLovablePrompt, lovableLink, type LovableScope } from '../export/lovable';
import { download, safeName } from '../export/semantic';
import './lovable.css';
import { BuildSpecificationEditor } from './BuildSpecificationEditor';

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
    <Modal title="Build with Lovable" close={close} wide>
      <div className="lovable-dialog">
        <p className="lovable-intro">
          Turn your diagram into an app specification. Lovable opens with a prefilled prompt; review
          it and Send there to build.
        </p>
        <label className="field lovable-instructions">
          App instructions
          <textarea
            aria-label="App instructions"
            value={instructions}
            rows={4}
            placeholder="Describe the app, its audience, and anything the diagram does not explain."
            onChange={(event) => update({ instructions: event.target.value })}
          />
          <span className="muted">Your instructions are saved locally with this diagram.</span>
        </label>
        <label className="field">
          Include
          <select
            aria-label="Lovable scope"
            value={scope}
            onChange={(event) => update({ scope: event.target.value as LovableScope })}
          >
            <option value="diagram">Entire diagram</option>
            <option value="selected" disabled={!selectedIds.length}>
              Selected objects{selectedIds.length ? ` (${selectedIds.length})` : ' · none selected'}
            </option>
            <option value="csv-view" disabled={!hasCsv}>
              Current CSV groups
            </option>
          </select>
        </label>
        <p className="lovable-scope-note">
          {scope === 'diagram'
            ? 'Includes every object, including collapsed branches and objects outside the current view.'
            : scope === 'selected'
              ? 'Includes exactly the selected objects. Connections to other objects appear as boundary context.'
              : 'Includes visible CSV groups and all manual objects. Other groups appear only where needed as boundary context.'}
        </p>
        <dl className="lovable-counts" aria-label="Build brief contents">
          <div>
            <dt>Objects</dt>
            <dd>{prompt.nodeCount}</dd>
          </div>
          <div>
            <dt>Relationships</dt>
            <dd>{prompt.edgeCount}</dd>
          </div>
          <div>
            <dt>Boundary connections</dt>
            <dd>{prompt.boundaryCount}</dd>
          </div>
        </dl>
        <p className="lovable-disclosure">
          The prompt includes user descriptions, notes and imported SQL schemas. Source CSV rows,
          SQL data rows and arbitrary metadata are excluded. Review the exact text below before
          sharing it with Lovable.
        </p>
        {graph.nodes.some((node) => getSqlQuerySource(node) || getSqlQueryResult(node)) && (
          <p className="lovable-disclosure">
            SQL query expressions and conditions, including literal values, are included in the
            prompt. Review them before sharing.
          </p>
        )}
        {graph.nodes.some((node) => getCodeObject(node)) && (
          <p className="lovable-disclosure">
            Code identifiers, file paths, source locations and relationship confidence are included.
            Original source is excluded. Review the paths and unresolved behavior before sharing.
          </p>
        )}
        {!!getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length && (
          <p className="lovable-drawing-note">
            Drawing marks are visual notes. Describe anything important in your instructions.
          </p>
        )}
        <BuildSpecificationEditor specification={prompt.specification} />
        <label className="field lovable-preview">
          Exact build prompt
          <textarea
            ref={preview}
            aria-label="Lovable build prompt"
            readOnly
            value={prompt.text}
            rows={10}
            spellCheck={false}
          />
        </label>
        {link.reason && <p className="lovable-link-note">{link.reason}</p>}
        {notice && (
          <p role="status" className="lovable-copy-notice">
            {notice}
          </p>
        )}
        <div className="modal-actions lovable-actions">
          <button type="button" onClick={() => void copy()}>
            <Copy size={16} />
            Copy build prompt
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
            Download build brief
          </button>
          {link.url ? (
            <a className="lovable-open" href={link.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              Open in Lovable
            </a>
          ) : (
            <button type="button" className="primary" disabled>
              <ExternalLink size={16} />
              Open in Lovable
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
            Open Lovable and paste the prompt
          </a>
        )}
      </div>
    </Modal>
  );
}
