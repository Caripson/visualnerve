import { Field } from './Field';
export { Field } from './Field';
import {
  diagramModeLabel,
  edgeDirectionLabel,
  edgeStyleLabel,
  nodeKindLabel,
  statusLabel as displayStatus,
} from '../ui/editor-labels';
import { useI18n } from '../i18n';
import { PresentationNumberField } from '../presentation/NumberField';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { nodeStatuses } from '../ui/status';
import { SqlRelationshipDetails, SqlTableDetails } from './SqlTableSummary';
import { SqlQueryDetails, SqlQueryRelationshipDetails } from './SqlQuerySummary';
import { AnalysisDialog, AnalysisTools } from './AnalysisTools';
import {
  CodeAnalysisProperties,
  CodeObjectProperties,
  CodeRelationProperties,
} from './CodeProperties';
import { SpatialProperties } from './SpatialProperties';
export interface PropertiesProps {
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
  const { t, plural } = useI18n();
  const graph = useEditor((s) => s.graph);
  const selected = useEditor((s) => s.selectedNodes);
  const edges = useEditor((s) => s.selectedEdges);
  const owners = useEditor((s) => s.owners);
  if (!graph)
    return (
      <aside className="properties">
        <div className="panel-heading">{t('editor.properties.title')}</div>
        <div className="property-empty">{t('editor.properties.selectAnObjectToInspectIt')}</div>
      </aside>
    );
  const node = graph.nodes.find((n) => n.id === selected[0]);
  const edge = graph.edges.find((e) => e.id === edges[0]);
  const command = useEditor.getState().command;
  if (selected.length > 1)
    return (
      <aside className="properties">
        <div className="panel-heading">
          {plural(
            'editor.properties.selection.count.one',
            'editor.properties.selection.count.other',
            selected.length,
          )}
        </div>
        <div className="property-content">
          <AnalysisTools onOpen={onOpenAnalysis} />
          <p className="muted">{t('editor.properties.moveCopyGroupOrDeleteThisSelection')}</p>
          <button className="full" onClick={() => useEditor.getState().group()}>
            <Layers size={15} />
            {t('editor.properties.groupSelection')}{' '}
          </button>
          {selected.length === 2 && (
            <button
              className="full"
              onClick={() => useEditor.getState().connect(selected[0], selected[1])}
            >
              <ArrowRight size={15} />
              {t('editor.properties.connectSelectedNodes')}{' '}
            </button>
          )}
          <button className="full danger" onClick={() => useEditor.getState().remove()}>
            <Trash2 size={15} />
            {t('editor.properties.deleteSelection')}{' '}
          </button>
          <PropertyError />
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
          {t('editor.properties.node.heading')}{' '}
          <span className="muted">{nodeKindLabel(t, node.nodeType)}</span>
        </div>
        <div className="property-content" key={node.id}>
          <AnalysisTools onOpen={onOpenAnalysis} />
          <Field title={t('editor.properties.node.titleLabel')}>
            <input
              aria-label={t('editor.properties.nodeTitle')}
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
            <span>{t('editor.properties.areaIcon')}</span>
            <IconPicker
              label={t('editor.properties.nodeAreaIcon')}
              value={iconKey(node.metadata)}
              onChange={(icon) => update({ metadata: withIcon(node.metadata, icon) }, false)}
            />
          </div>
          <Field title={t('editor.properties.type')}>
            <select
              aria-label={t('editor.properties.nodeType')}
              value={node.nodeType}
              onChange={(e) => update({ nodeType: e.target.value as GraphNode['nodeType'] })}
            >
              {Object.entries(nodeRegistry).map(([key, entry]) => (
                <option key={key} value={key}>
                  {nodeKindLabel(t, key)}
                </option>
              ))}
            </select>
          </Field>
          <Field title={t('editor.properties.description')}>
            <textarea
              aria-label={t('editor.properties.nodeDescription')}
              rows={3}
              value={node.description ?? ''}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={t('editor.properties.addContext')}
            />
          </Field>
          <div className="property-section">{t('editor.properties.responsibility')}</div>
          <Field title={t('editor.properties.owner')}>
            <select
              aria-label={t('editor.properties.nodeOwner')}
              value={node.ownerIds[0] ?? ''}
              onChange={(e) => update({ ownerIds: e.target.value ? [e.target.value] : [] }, false)}
            >
              <option value="">{t('editor.properties.unassigned')}</option>
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
              <summary>{t('editor.properties.additionalOwners')}</summary>
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
            <Field title={t('editor.properties.status')}>
              <select
                aria-label={t('editor.properties.nodeStatus')}
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
                <option value="">{t('editor.properties.none')}</option>
                {nodeStatuses.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {displayStatus(t, choice.value)}
                  </option>
                ))}
                {node.status && !nodeStatuses.some((choice) => choice.value === node.status) && (
                  <option value={node.status}>{displayStatus(t, node.status)}</option>
                )}
              </select>
            </Field>
            <Field title={t('editor.properties.color')}>
              <input
                type="color"
                aria-label={t('editor.properties.nodeColor')}
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
          <Field title={t('editor.properties.tags')}>
            <input
              aria-label={t('editor.properties.nodeTags')}
              value={node.tags.join(', ')}
              onChange={(e) => update({ tags: e.target.value.split(',').map((t) => t.trim()) })}
              placeholder={t('editor.properties.launchResearch')}
            />
          </Field>
          <div className="property-section">{t('editor.properties.schedule')}</div>
          <div className="field-row">
            <Field title={t('editor.properties.startDate')}>
              <input
                type="date"
                aria-label={t('editor.properties.startDate')}
                value={node.startDate ?? ''}
                onChange={(e) => update({ startDate: e.target.value })}
              />
            </Field>
            <Field title={t('editor.properties.endDate')}>
              <input
                type="date"
                aria-label={t('editor.properties.endDate')}
                value={node.endDate ?? ''}
                onChange={(e) => update({ endDate: e.target.value })}
              />
            </Field>
          </div>
          <Field title={t('editor.properties.dueDate')}>
            <input
              type="date"
              aria-label={t('editor.properties.dueDate')}
              value={node.dueDate ?? ''}
              onChange={(e) => update({ dueDate: e.target.value })}
            />
          </Field>
          <Field title="URL">
            <input
              aria-label={t('editor.properties.nodeUrl')}
              type="url"
              value={node.url ?? ''}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://…"
            />
            {node.url?.match(/^https?:\/\//) && (
              <a className="text-link" href={node.url} target="_blank" rel="noopener noreferrer">
                <Link size={12} />
                {t('editor.properties.openLink')}{' '}
              </a>
            )}
          </Field>
          <div className="property-section">{t('editor.properties.structure')}</div>
          <Field title={t('editor.properties.parentContainer')}>
            <select
              aria-label={t('editor.properties.nodeParent')}
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
              <option value="">{t('editor.properties.noParent')}</option>
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
              {t('editor.properties.child')}{' '}
            </button>
            <button onClick={() => useEditor.getState().child(true)}>
              <ChevronRight size={13} />
              {t('editor.properties.sibling')}{' '}
            </button>
          </div>
          {node.nodeType === 'group' && (
            <button className="full" onClick={() => useEditor.getState().ungroup()}>
              {t('editor.properties.ungroup')}
            </button>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={node.collapsed}
              onChange={(e) => update({ collapsed: e.target.checked }, false)}
            />
            {t('editor.properties.collapseBranchGroup')}{' '}
          </label>
          <div className="property-section">{t('editor.properties.details')}</div>
          <Field title={t('editor.properties.notes')}>
            <textarea
              aria-label={t('editor.properties.nodeNotes')}
              rows={3}
              value={node.notes ?? ''}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </Field>
          <MetadataEditor value={node.metadata} apply={(metadata) => update({ metadata }, false)} />
          <details>
            <summary>{t('editor.properties.positionSize')}</summary>
            <div className="field-row">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <Field
                  key={key}
                  title={
                    key === 'x' || key === 'y'
                      ? key
                      : t(key === 'width' ? 'editor.properties.width' : 'editor.properties.height')
                  }
                >
                  <input
                    aria-label={t('editor.properties.geometry.accessible', {
                      propertyLabel:
                        key === 'x' || key === 'y'
                          ? key
                          : t(
                              key === 'width'
                                ? 'editor.properties.width'
                                : 'editor.properties.height',
                            ),
                    })}
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
            {t('editor.properties.deleteNode')}{' '}
          </button>
          <PropertyError />
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
          {t('editor.properties.edge.heading')}{' '}
        </div>
        <div className="property-content" key={edge.id}>
          <AnalysisTools onOpen={onOpenAnalysis} />
          <Field title={t('editor.properties.label')}>
            <input
              aria-label={t('editor.properties.connectionLabel')}
              value={edge.label ?? ''}
              onChange={(e) => update(edge.id, { label: e.target.value })}
              placeholder={t('editor.properties.yesNoDependsOn')}
            />
          </Field>
          <SqlRelationshipDetails edge={edge} />
          <SqlQueryRelationshipDetails edge={edge} />
          <CodeRelationProperties edge={edge} />
          <Field title={t('editor.properties.relationship')}>
            <input
              aria-label={t('editor.properties.relationshipType')}
              value={edge.edgeType}
              onChange={(e) => update(edge.id, { edgeType: e.target.value })}
            />
          </Field>
          <Field title={t('editor.properties.direction')}>
            <select
              aria-label={t('editor.properties.connectionDirection')}
              value={edge.direction}
              onChange={(e) =>
                update(edge.id, { direction: e.target.value as typeof edge.direction })
              }
            >
              {['forward', 'backward', 'both', 'none'].map((v) => (
                <option key={v} value={v}>
                  {edgeDirectionLabel(t, v)}
                </option>
              ))}
            </select>
          </Field>
          <Field title={t('editor.properties.style')}>
            <select
              aria-label={t('editor.properties.connectionStyle')}
              value={edge.style}
              onChange={(e) => update(edge.id, { style: e.target.value as typeof edge.style })}
            >
              {['solid', 'dashed', 'dotted'].map((v) => (
                <option key={v} value={v}>
                  {edgeStyleLabel(t, v)}
                </option>
              ))}
            </select>
          </Field>
          <Field title={t('editor.properties.source')}>
            <select
              aria-label={t('editor.properties.connectionSource')}
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
          <Field title={t('editor.properties.target')}>
            <select
              aria-label={t('editor.properties.connectionTarget')}
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
          <Field title={t('editor.properties.description')}>
            <textarea
              aria-label={t('editor.properties.connectionDescription')}
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
            {t('editor.properties.deleteConnection')}{' '}
          </button>
          <PropertyError />
        </div>
      </aside>
    );
  }
  const d = graph.diagram;
  const change = (patch: Partial<typeof d>) =>
    command('Edit diagram', (g) => ({ ...g, diagram: { ...g.diagram, ...patch } }), true);
  return (
    <aside className="properties">
      <div className="panel-heading">{t('editor.properties.diagram.heading')}</div>
      <div className="property-content">
        <AnalysisTools onOpen={onOpenAnalysis} />
        <SpatialProperties graph={graph} />
        <CodeAnalysisProperties graph={graph} />
        <div className="diagram-summary">
          <span className="eyebrow">{t('editor.properties.workspace')}</span>
          <h2>{d.name}</h2>
          <p>
            {plural('app.nodeCountOne', 'app.nodeCount', graph.nodes.length)} ·{' '}
            {plural('app.connectionCountOne', 'app.connectionCount', graph.edges.length)}
          </p>
        </div>
        <CsvProperties
          graph={graph}
          onEditCsv={editCsv}
          onFocusCsv={focusCsv}
          onPageCsv={pageCsv}
        />
        <Field title={t('editor.properties.diagram.nameLabel')}>
          <input
            aria-label={t('editor.properties.diagramName')}
            value={d.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </Field>
        <div className="field">
          <span>{t('editor.properties.projectIcon')}</span>
          <IconPicker
            label={t('editor.properties.diagramAreaIcon')}
            value={iconKey(d.metadata)}
            onChange={(icon) => change({ metadata: withIcon(d.metadata, icon) })}
          />
        </div>
        <Field title={t('editor.properties.mode')}>
          <select
            aria-label={t('editor.properties.diagramMode')}
            value={d.type}
            disabled={d.type === 'process-simulator'}
            onChange={(e) => change({ type: e.target.value as typeof d.type })}
          >
            {diagramTypes
              .filter((v) => v !== 'process-simulator' || d.type === v)
              .map((v) => (
                <option key={v} value={v}>
                  {diagramModeLabel(t, v)}
                </option>
              ))}
          </select>
        </Field>
        <Field title={t('editor.properties.description')}>
          <textarea
            aria-label={t('editor.properties.diagramDescription')}
            rows={3}
            value={d.description ?? ''}
            onChange={(e) => change({ description: e.target.value })}
          />
        </Field>
        <Field title={t('editor.nodes.directory.label')}>
          <input
            aria-label={t('editor.properties.diagramFolder')}
            value={d.folder ?? ''}
            onChange={(e) => change({ folder: e.target.value })}
            placeholder={t('editor.properties.projects2026')}
          />
        </Field>
        <Field title={t('editor.properties.tags')}>
          <input
            aria-label={t('editor.properties.diagramTags')}
            value={d.tags.join(', ')}
            onChange={(e) => change({ tags: e.target.value.split(',').map((t) => t.trim()) })}
          />
        </Field>
        <button
          className={`full ${d.favorite ? 'active' : ''}`}
          onClick={() => change({ favorite: !d.favorite })}
        >
          <Star size={14} fill={d.favorite ? 'currentColor' : 'none'} />
          {d.favorite
            ? t('editor.properties.removeFavorite')
            : t('editor.properties.addToFavorites')}
        </button>
        <MetadataEditor value={d.metadata} apply={(metadata) => change({ metadata })} />
        <div className="property-tip">
          <b>{t('editor.properties.makeRoomForAnIdea')}</b>
          <p>
            {t('editor.properties.dragToSelectHoldSpaceToPan')} <br />
            {t('editor.properties.connectTheHandlesBetweenNodes')}{' '}
          </p>
          <kbd>Tab</kbd> {t('editor.properties.shortcuts.child', { tabKey: '' })} <kbd>Enter</kbd>{' '}
          {t('editor.properties.shortcuts.sibling', { enterKey: '' })}
        </div>
      </div>
    </aside>
  );
}

/** Mobile Properties covers the canvas notice, so keep edit errors in the active sheet. */
function PropertyError() {
  const status = useEditor((state) => state.status);
  const message = useEditor((state) => state.message);
  const commandError = useEditor((state) => state.commandError);
  const error = commandError || (status === 'error' ? message : '');
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alert.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);
  return error ? (
    <p ref={alert} className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
function MetadataEditor({ value, apply }: { value: Metadata; apply: (value: Metadata) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <details className="metadata-editor">
      <summary>{t('editor.properties.customMetadata')}</summary>
      <textarea
        aria-label={t('editor.properties.customMetadata')}
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
        {t('editor.properties.applyMetadata')}
      </button>
      {error && (
        <p className="form-error">
          {error === 'Use a JSON object.' ? t('editor.properties.metadata.invalidObject') : error}
        </p>
      )}
    </details>
  );
}
