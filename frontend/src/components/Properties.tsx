import { PresentationNumberField } from '../presentation/NumberField';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Layers, Link, Plus, Trash2, ChevronRight, Star } from 'lucide-react';
import { useEditor } from '../state/editor';
import {
  diagramTypes,
  descendantIds,
  newEdge,
  type Metadata,
  type GraphNode,
} from '../model/types';
import { nodeRegistry } from '../nodes/registry';
import { mindmapTopics } from '../mindmap/tree';
import { IconPicker, iconKey, withIcon } from '../ui/icons';
import { CsvProperties } from './CsvProperties';
import type { CsvPathEntry } from '../data/types';
import { getCsvNode } from '../data/csv';
import { nodeStatuses, statusLabel } from '../ui/status';
import { SqlRelationshipDetails, SqlTableDetails } from './SqlTableSummary';
import { SqlQueryDetails, SqlQueryRelationshipDetails } from './SqlQuerySummary';
import { AnalysisDialog, AnalysisTools } from './AnalysisTools';
import {
  CodeAnalysisProperties,
  CodeObjectProperties,
  CodeRelationProperties,
} from './CodeProperties';
import { SpatialProperties } from './SpatialProperties';
interface PropertiesProps {
  editCsv?: (datasetId?: string) => void;
  focusCsv?: (path: CsvPathEntry[], datasetId?: string) => void;
  pageCsv?: (direction: 'next' | 'previous', datasetId?: string) => void;
}
export function Properties(props: PropertiesProps) {
  const graph = useEditor((state) => state.graph);
  const selected = useEditor((state) => state.selectedNodes);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const openAnalysis = useCallback(() => setAnalysisOpen(true), []);
  const closeAnalysis = useCallback(() => setAnalysisOpen(false), []);
  return (
    <>
      <PropertyPanel {...props} onOpenAnalysis={openAnalysis} />
      {analysisOpen && graph && (
        <AnalysisDialog key={graph.diagram.id} close={closeAnalysis} startId={selected[0]} />
      )}
    </>
  );
}
function PropertyPanel({
  editCsv,
  focusCsv,
  pageCsv,
  onOpenAnalysis,
}: PropertiesProps & { onOpenAnalysis: () => void }) {
  const graph = useEditor((s) => s.graph);
  const selected = useEditor((s) => s.selectedNodes);
  const edges = useEditor((s) => s.selectedEdges);
  const owners = useEditor((s) => s.owners);
  if (!graph)
    return (
      <aside className="properties">
        <div className="panel-heading">Properties</div>
        <div className="property-empty">Select an object to inspect it.</div>
      </aside>
    );
  const node = graph.nodes.find((n) => n.id === selected[0]);
  const edge = graph.edges.find((e) => e.id === edges[0]);
  const command = useEditor.getState().command;
  if (selected.length > 1)
    return (
      <aside className="properties">
        <div className="panel-heading">{selected.length} nodes selected</div>
        <div className="property-content">
          <AnalysisTools onOpen={onOpenAnalysis} />
          <p className="muted">Move, copy, group or delete this selection.</p>
          <button className="full" onClick={() => useEditor.getState().group()}>
            <Layers size={15} />
            Group selection
          </button>
          {selected.length === 2 && (
            <button
              className="full"
              onClick={() => useEditor.getState().connect(selected[0], selected[1])}
            >
              <ArrowRight size={15} />
              Connect selected nodes
            </button>
          )}
          <button className="full danger" onClick={() => useEditor.getState().remove()}>
            <Trash2 size={15} />
            Delete selection
          </button>
        </div>
      </aside>
    );
  if (node) {
    const update = (patch: Partial<GraphNode>, coalesce = true) =>
      useEditor.getState().updateNode(node.id, patch, coalesce);
    const blocked = descendantIds(graph.nodes, node.id);
    const config = nodeRegistry[node.nodeType];
    const Icon = config.icon;
    return (
      <aside className="properties">
        <div className="panel-heading">
          <Icon size={15} />
          Node properties<span className="muted">{config.label}</span>
        </div>
        <div className="property-content" key={node.id}>
          <AnalysisTools onOpen={onOpenAnalysis} />
          <Field title="Title">
            <input
              aria-label="Node title"
              value={node.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </Field>
          <PresentationNumberField graph={graph} nodeId={node.id} />
          <CsvProperties
            graph={graph}
            node={node}
            onEditCsv={editCsv}
            onFocusCsv={focusCsv}
            onPageCsv={pageCsv}
          />
          <SqlTableDetails node={node} />
          <SqlQueryDetails node={node} />
          <CodeObjectProperties node={node} />
          <SpatialProperties graph={graph} node={node} />
          <div className="field">
            <span>Area icon</span>
            <IconPicker
              label="Node area icon"
              value={iconKey(node.metadata)}
              onChange={(icon) => update({ metadata: withIcon(node.metadata, icon) }, false)}
            />
          </div>
          <Field title="Type">
            <select
              aria-label="Node type"
              value={node.nodeType}
              onChange={(e) => update({ nodeType: e.target.value as GraphNode['nodeType'] })}
            >
              {Object.entries(nodeRegistry).map(([key, entry]) => (
                <option key={key} value={key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Description">
            <textarea
              aria-label="Node description"
              rows={3}
              value={node.description ?? ''}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Add context…"
            />
          </Field>
          <div className="property-section">Responsibility</div>
          <Field title="Owner">
            <select
              aria-label="Node owner"
              value={node.ownerIds[0] ?? ''}
              onChange={(e) => update({ ownerIds: e.target.value ? [e.target.value] : [] }, false)}
            >
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.team ? ` · ${o.team}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {owners.length > 1 && (
            <details>
              <summary>Additional owners</summary>
              <div className="owner-checklist">
                {owners.map((o) => (
                  <label key={o.id}>
                    <input
                      type="checkbox"
                      checked={node.ownerIds.includes(o.id)}
                      onChange={(e) =>
                        update(
                          {
                            ownerIds: e.target.checked
                              ? [...node.ownerIds, o.id]
                              : node.ownerIds.filter((id) => id !== o.id),
                          },
                          false,
                        )
                      }
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="field-row">
            <Field title="Status">
              <select
                aria-label="Node status"
                value={node.status ?? ''}
                onChange={(e) => {
                  const status = e.target.value;
                  command('Set object status', (current) => ({
                    ...current,
                    nodes: current.nodes.map((item) =>
                      item.id === node.id ? { ...item, status } : item,
                    ),
                  }));
                }}
              >
                <option value="">None</option>
                {nodeStatuses.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
                {node.status && !nodeStatuses.some((choice) => choice.value === node.status) && (
                  <option value={node.status}>{statusLabel(node.status)}</option>
                )}
              </select>
            </Field>
            <Field title="Color">
              <input
                type="color"
                aria-label="Node color"
                value={
                  node.color ||
                  (graph.diagram.type === 'mindmap'
                    ? mindmapTopics(
                        graph.nodes.filter((item) => getCsvNode(item)?.visible !== false),
                      ).get(node.id)?.color
                    : owners.find((o) => o.id === node.ownerId)?.color) ||
                  '#31766c'
                }
                onChange={(e) => update({ color: e.target.value })}
              />
            </Field>
          </div>
          <Field title="Tags">
            <input
              aria-label="Node tags"
              value={node.tags.join(', ')}
              onChange={(e) => update({ tags: e.target.value.split(',').map((t) => t.trim()) })}
              placeholder="launch, research"
            />
          </Field>
          <div className="property-section">Schedule</div>
          <div className="field-row">
            <Field title="Start date">
              <input
                type="date"
                aria-label="Start date"
                value={node.startDate ?? ''}
                onChange={(e) => update({ startDate: e.target.value })}
              />
            </Field>
            <Field title="End date">
              <input
                type="date"
                aria-label="End date"
                value={node.endDate ?? ''}
                onChange={(e) => update({ endDate: e.target.value })}
              />
            </Field>
          </div>
          <Field title="Due date">
            <input
              type="date"
              aria-label="Due date"
              value={node.dueDate ?? ''}
              onChange={(e) => update({ dueDate: e.target.value })}
            />
          </Field>
          <Field title="URL">
            <input
              aria-label="Node URL"
              type="url"
              value={node.url ?? ''}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://…"
            />
            {node.url?.match(/^https?:\/\//) && (
              <a className="text-link" href={node.url} target="_blank" rel="noopener noreferrer">
                <Link size={12} />
                Open link
              </a>
            )}
          </Field>
          <div className="property-section">Structure</div>
          <Field title="Parent / container">
            <select
              aria-label="Node parent"
              value={node.parentId ?? ''}
              onChange={(e) =>
                command('Reparent node', (g) => ({
                  ...g,
                  nodes: g.nodes.map((n) =>
                    n.id === node.id ? { ...n, parentId: e.target.value || undefined } : n,
                  ),
                  edges: [
                    ...g.edges.filter(
                      (edge) => !(edge.edgeType === 'hierarchy' && edge.targetNodeId === node.id),
                    ),
                    ...(e.target.value &&
                    g.nodes.find((n) => n.id === e.target.value)?.nodeType !== 'group'
                      ? [newEdge(g.diagram.id, e.target.value, node.id, { edgeType: 'hierarchy' })]
                      : []),
                  ],
                }))
              }
            >
              <option value="">No parent</option>
              {graph.nodes
                .filter((n) => n.id !== node.id && !blocked.has(n.id))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
          </Field>
          <div className="button-row">
            <button onClick={() => useEditor.getState().child()}>
              <Plus size={13} />
              Child
            </button>
            <button onClick={() => useEditor.getState().child(true)}>
              <ChevronRight size={13} />
              Sibling
            </button>
          </div>
          {node.nodeType === 'group' && (
            <button className="full" onClick={() => useEditor.getState().ungroup()}>
              Ungroup
            </button>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={node.collapsed}
              onChange={(e) => update({ collapsed: e.target.checked }, false)}
            />
            Collapse branch / group
          </label>
          <div className="property-section">Details</div>
          <Field title="Notes">
            <textarea
              aria-label="Node notes"
              rows={3}
              value={node.notes ?? ''}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </Field>
          <MetadataEditor value={node.metadata} apply={(metadata) => update({ metadata }, false)} />
          <details>
            <summary>Position & size</summary>
            <div className="field-row">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <Field key={key} title={key}>
                  <input
                    aria-label={`Node ${key}`}
                    type="number"
                    value={node[key]}
                    onChange={(e) =>
                      Number.isFinite(e.target.valueAsNumber) &&
                      update({ [key]: e.target.valueAsNumber })
                    }
                  />
                </Field>
              ))}
            </div>
          </details>
          <div className="entity-id" title={node.id}>
            {node.id}
          </div>
          <button className="full danger" onClick={() => useEditor.getState().remove()}>
            <Trash2 size={14} />
            Delete node
          </button>
        </div>
      </aside>
    );
  }
  if (edge) {
    const update = useEditor.getState().updateEdge;
    return (
      <aside className="properties">
        <div className="panel-heading">
          <ArrowRight size={15} />
          Connection properties
        </div>
        <div className="property-content" key={edge.id}>
          <AnalysisTools onOpen={onOpenAnalysis} />
          <Field title="Label">
            <input
              aria-label="Connection label"
              value={edge.label ?? ''}
              onChange={(e) => update(edge.id, { label: e.target.value })}
              placeholder="Yes, No, depends on…"
            />
          </Field>
          <SqlRelationshipDetails edge={edge} />
          <SqlQueryRelationshipDetails edge={edge} />
          <CodeRelationProperties edge={edge} />
          <Field title="Relationship">
            <input
              aria-label="Relationship type"
              value={edge.edgeType}
              onChange={(e) => update(edge.id, { edgeType: e.target.value })}
            />
          </Field>
          <Field title="Direction">
            <select
              aria-label="Connection direction"
              value={edge.direction}
              onChange={(e) =>
                update(edge.id, { direction: e.target.value as typeof edge.direction })
              }
            >
              {['forward', 'backward', 'both', 'none'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field title="Style">
            <select
              aria-label="Connection style"
              value={edge.style}
              onChange={(e) => update(edge.id, { style: e.target.value as typeof edge.style })}
            >
              {['solid', 'dashed', 'dotted'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field title="Source">
            <select
              aria-label="Connection source"
              value={edge.sourceNodeId}
              onChange={(e) => update(edge.id, { sourceNodeId: e.target.value })}
            >
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Target">
            <select
              aria-label="Connection target"
              value={edge.targetNodeId}
              onChange={(e) => update(edge.id, { targetNodeId: e.target.value })}
            >
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Description">
            <textarea
              aria-label="Connection description"
              value={edge.description ?? ''}
              onChange={(e) => update(edge.id, { description: e.target.value })}
            />
          </Field>
          <MetadataEditor
            value={edge.metadata}
            apply={(metadata) => update(edge.id, { metadata })}
          />
          <button className="full danger" onClick={() => useEditor.getState().remove()}>
            <Trash2 size={14} />
            Delete connection
          </button>
        </div>
      </aside>
    );
  }
  const d = graph.diagram;
  const change = (patch: Partial<typeof d>) =>
    command('Edit diagram', (g) => ({ ...g, diagram: { ...g.diagram, ...patch } }), true);
  return (
    <aside className="properties">
      <div className="panel-heading">Diagram properties</div>
      <div className="property-content">
        <AnalysisTools onOpen={onOpenAnalysis} />
        <SpatialProperties graph={graph} />
        <CodeAnalysisProperties graph={graph} />
        <div className="diagram-summary">
          <span className="eyebrow">WORKSPACE</span>
          <h2>{d.name}</h2>
          <p>
            {graph.nodes.length} nodes · {graph.edges.length} connections
          </p>
        </div>
        <CsvProperties
          graph={graph}
          onEditCsv={editCsv}
          onFocusCsv={focusCsv}
          onPageCsv={pageCsv}
        />
        <Field title="Name">
          <input
            aria-label="Diagram name"
            value={d.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </Field>
        <div className="field">
          <span>Project icon</span>
          <IconPicker
            label="Diagram area icon"
            value={iconKey(d.metadata)}
            onChange={(icon) => change({ metadata: withIcon(d.metadata, icon) })}
          />
        </div>
        <Field title="Mode">
          <select
            aria-label="Diagram mode"
            value={d.type}
            onChange={(e) => change({ type: e.target.value as typeof d.type })}
          >
            {diagramTypes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field title="Description">
          <textarea
            aria-label="Diagram description"
            rows={3}
            value={d.description ?? ''}
            onChange={(e) => change({ description: e.target.value })}
          />
        </Field>
        <Field title="Folder">
          <input
            aria-label="Diagram folder"
            value={d.folder ?? ''}
            onChange={(e) => change({ folder: e.target.value })}
            placeholder="Projects / 2026"
          />
        </Field>
        <Field title="Tags">
          <input
            aria-label="Diagram tags"
            value={d.tags.join(', ')}
            onChange={(e) => change({ tags: e.target.value.split(',').map((t) => t.trim()) })}
          />
        </Field>
        <button
          className={`full ${d.favorite ? 'active' : ''}`}
          onClick={() => change({ favorite: !d.favorite })}
        >
          <Star size={14} fill={d.favorite ? 'currentColor' : 'none'} />
          {d.favorite ? 'Remove favorite' : 'Add to favorites'}
        </button>
        <MetadataEditor value={d.metadata} apply={(metadata) => change({ metadata })} />
        <div className="property-tip">
          <b>Make room for an idea</b>
          <p>
            Drag to select. Hold Space to pan.
            <br />
            Connect the handles between nodes.
          </p>
          <kbd>Tab</kbd> child <kbd>Enter</kbd> sibling
        </div>
      </div>
    </aside>
  );
}
export function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
function MetadataEditor({ value, apply }: { value: Metadata; apply: (value: Metadata) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <details className="metadata-editor">
      <summary>Custom metadata</summary>
      <textarea
        aria-label="Custom metadata"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <button
        onClick={() => {
          try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
              throw new Error('Use a JSON object.');
            apply(parsed);
            setError('');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Apply metadata
      </button>
      {error && <p className="form-error">{error}</p>}
    </details>
  );
}
