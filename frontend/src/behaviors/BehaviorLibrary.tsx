import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Braces, GripVertical } from 'lucide-react';
import { ToolbarMenu } from '../components/ToolbarMenu';
import { useEditor } from '../state/editor';
import type { Graph } from '../model/types';
import {
  behaviorDocumentLimits,
  getBehaviorLibrary,
  removeBehaviorDefinition,
  saveBehaviorDefinition,
  type BehaviorDefinition,
} from './document';
import { BEHAVIOR_PREVIEW_VERSION, compilePreviewBehavior } from './language';
import { BehaviorDiagnosticMessage } from './BehaviorDiagnosticMessage';
import {
  attachBehavior,
  behaviorEditAllowed,
  canAttachBehavior,
  editBehaviors,
  endBehaviorDrag,
  startBehaviorDrag,
} from './interaction';
import './behaviors.css';

const starterSource = `parameter nextName as text = "Quality check"

on connectionAdded
  rename event.target to nextName
end`;

export function BehaviorLibrary() {
  const graph = useEditor((state) => state.graph);
  const selected = useEditor((state) => state.selectedNodes);
  const trace = useEditor((state) => state.behaviorTrace);
  const [editing, setEditing] = useState<BehaviorDefinition>();
  const [dragging, setDragging] = useState(false);
  if (!graph) return null;
  const library = getBehaviorLibrary(graph);
  if (!behaviorEditAllowed(graph.diagram.id)) return null;
  const selectedNode =
    selected.length === 1 ? graph.nodes.find((node) => node.id === selected[0]) : undefined;
  return (
    <ToolbarMenu label="Behavior library" icon={<Braces size={17} />} closeOnAction={false}>
      <div className="behavior-library" data-dragging={dragging || undefined}>
        <div className="behavior-library-header">
          <h3>Behavior library</h3>
          {!editing && (
            <button
              type="button"
              disabled={library.definitions.length >= behaviorDocumentLimits.definitions}
              onClick={() =>
                setEditing({
                  id: crypto.randomUUID(),
                  name: '',
                  version: BEHAVIOR_PREVIEW_VERSION,
                  source: '',
                  draftSource: starterSource,
                })
              }
            >
              New behavior
            </button>
          )}
        </div>
        {editing ? (
          <BehaviorSourceEditor
            key={editing.id}
            definition={editing}
            setDefinition={setEditing}
            graph={graph}
            close={() => setEditing(undefined)}
          />
        ) : (
          <>
            {library.definitions.length === 0 ? (
              <p>No behaviors in this diagram yet.</p>
            ) : (
              <p>Drag an active behavior to a compatible card, or select a card to add it.</p>
            )}
            {library.definitions.map((definition) => (
              <BehaviorDefinitionRow
                key={definition.id}
                graph={graph}
                definition={definition}
                selectedNodeId={selectedNode?.id}
                edit={() => setEditing(definition)}
                onDragging={setDragging}
              />
            ))}
          </>
        )}
        {!!trace.length && (
          <details className="behavior-trace" key={graph.diagram.id}>
            <summary>Behavior trace ({trace.length})</summary>
            <ol>
              {trace.map((entry, index) => (
                <li key={index}>
                  <strong>{entry.definitionName}</strong> · Line {entry.line}, column {entry.column}
                  <div>
                    {entry.previousName}
                    {entry.proposedName === undefined ? '' : ` → ${entry.proposedName}`}
                  </div>
                  <div>
                    {entry.outcome}
                    {entry.message ? ` · ${entry.message}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </ToolbarMenu>
  );
}

function BehaviorDefinitionRow({
  graph,
  definition,
  selectedNodeId,
  edit,
  onDragging,
}: {
  graph: Graph;
  definition: BehaviorDefinition;
  selectedNodeId?: string;
  edit: () => void;
  onDragging: (dragging: boolean) => void;
}) {
  const compiled = useMemo(
    () => compilePreviewBehavior(definition.source, definition.version),
    [definition.source, definition.version],
  );
  const active = compiled.ok;
  const unsupported = !compiled.ok && compiled.error.code === 'version';
  const context = active
    ? compiled.program.contexts
        .map((item) => (item === 'editor' ? 'Editing · Cards' : 'Simulation · Work nodes'))
        .join(' / ')
    : unsupported
      ? 'Unsupported language version'
      : 'Draft only';
  return (
    <article className="behavior-definition" aria-label={definition.name}>
      <div
        className={active ? 'behavior-drag-handle' : undefined}
        draggable={active}
        data-behavior-drag={active ? definition.id : undefined}
        onDragStart={(event) => {
          if (!active) return;
          startBehaviorDrag(event.dataTransfer, {
            diagramId: graph.diagram.id,
            definitionId: definition.id,
          });
          onDragging(true);
        }}
        onDragEnd={() => {
          endBehaviorDrag();
          onDragging(false);
        }}
      >
        {active && <GripVertical size={14} aria-hidden="true" />}
        <strong>{definition.name}</strong>
      </div>
      <p>
        {context}
        {active && (definition.draftSource === undefined ? ' · Active' : ' · Active, draft saved')}
      </p>
      {unsupported && <BehaviorDiagnosticMessage diagnostic={compiled.error} />}
      <div className="behavior-actions">
        <button type="button" aria-label={`Edit ${definition.name}`} onClick={edit}>
          Edit
        </button>
        {selectedNodeId && (
          <button
            type="button"
            disabled={!canAttachBehavior(graph, selectedNodeId, definition)}
            onClick={() => attachBehavior(graph.diagram.id, selectedNodeId, definition.id)}
          >
            Add to selected node
          </button>
        )}
      </div>
    </article>
  );
}

function BehaviorSourceEditor({
  definition,
  setDefinition,
  graph,
  close,
}: {
  definition: BehaviorDefinition;
  setDefinition: (definition: BehaviorDefinition) => void;
  graph: Graph;
  close: () => void;
}) {
  const diagnosticId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => nameInput.current?.focus({ preventScroll: true }), []);
  const { name } = definition;
  const source = definition.draftSource ?? definition.source;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const compiled = useMemo(
    () => compilePreviewBehavior(source, definition.version),
    [source, definition.version],
  );
  const diagnostic = compiled.ok ? undefined : compiled.error;
  const existing = getBehaviorLibrary(graph).definitions.find((item) => item.id === definition.id);
  const relatedBindings = getBehaviorLibrary(graph).bindings.filter(
    (binding) => binding.definitionId === definition.id,
  ).length;
  const save = (activate: boolean) => {
    if (!name.trim() || (activate && !compiled.ok)) return;
    const next: BehaviorDefinition = {
      id: definition.id,
      version: definition.version,
      name: name.trim(),
      source: activate ? source : (existing?.source ?? ''),
      ...(activate ? {} : { draftSource: source }),
    };
    editBehaviors(
      graph.diagram.id,
      activate ? 'Activate behavior source' : 'Save behavior draft',
      (current) => saveBehaviorDefinition(current, next),
    );
    const current = useEditor.getState().graph;
    const saved =
      current && getBehaviorLibrary(current).definitions.find((item) => item.id === next.id);
    if (
      saved?.name === next.name &&
      saved?.version === next.version &&
      saved?.source === next.source &&
      saved?.draftSource === next.draftSource
    )
      close();
    else setError('The behavior could not be saved.');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save(false);
  };
  return (
    <form className="behavior-source-form" onSubmit={submit}>
      <label>
        Behavior name
        <input
          ref={nameInput}
          required
          value={name}
          maxLength={behaviorDocumentLimits.name}
          onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
        />
      </label>
      <label>
        Behavior source
        <textarea
          value={source}
          maxLength={behaviorDocumentLimits.source}
          spellCheck={false}
          rows={9}
          aria-invalid={!!diagnostic}
          aria-describedby={diagnostic ? diagnosticId : undefined}
          onChange={(event) => setDefinition({ ...definition, draftSource: event.target.value })}
        />
      </label>
      <div id={diagnosticId} aria-live="polite">
        {diagnostic ? (
          <BehaviorDiagnosticMessage diagnostic={diagnostic} />
        ) : (
          <p>Valid source. Activate to use it in bindings.</p>
        )}
      </div>
      {existing?.source && (
        <details>
          <summary>{diagnostic?.code === 'version' ? 'Saved source' : 'Active source'}</summary>
          <pre>{existing.source}</pre>
        </details>
      )}
      {error && (
        <p className="behavior-diagnostic" role="alert">
          {error}
        </p>
      )}
      <div className="behavior-actions">
        <button type="submit" disabled={!name.trim()}>
          Save draft
        </button>
        <button type="button" disabled={!name.trim() || !!diagnostic} onClick={() => save(true)}>
          Activate source
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
      {existing &&
        (confirmRemove ? (
          <div>
            <p>Delete this definition and its {relatedBindings} bindings?</p>
            <div className="behavior-actions">
              <button
                type="button"
                onClick={() => {
                  editBehaviors(graph.diagram.id, 'Delete behavior', (current) =>
                    removeBehaviorDefinition(current, definition.id),
                  );
                  close();
                }}
              >
                Confirm deletion
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)}>
                Keep definition
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)}>
            Delete definition
          </button>
        ))}
    </form>
  );
}
