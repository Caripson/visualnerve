import { useState } from 'react';
import { Shapes, Plus, Trash2 } from 'lucide-react';
import type { Graph, GraphNode, GraphEdge } from '../model/types';
import { useEditor } from '../state/editor';
import { ToolbarMenu } from '../components/ToolbarMenu';
import {
  notationCollections,
  notationSymbols,
  notationEdgeSymbols,
  getNotationSymbol,
  umlAttachmentTargets,
  notationCompartmentDefaults,
  notationCompartmentLimit,
} from './registry';
import type { NodeNotation, EdgeNotation, NotationCollectionId, NotationProfile } from './types';
import { NotationGlyph } from './Glyph';
import { NotationPropertyFields, type NotationPropertyValue } from './PropertyFields';
import {
  notationIssues,
  validateNodeNotation,
  validateEdgeNotation,
  validateNotationGraph,
} from './validation';
import { NotationDraftInput } from './DraftInput';
import { editNodeProperty, editableNodeFields } from './property-model';
import './controls.css';
import './node.css';

const withProperty = <T extends NodeNotation | EdgeNotation>(
  value: T,
  key: string,
  next: NotationPropertyValue,
): T => {
  const properties: Record<string, unknown> = { ...value.properties, [key]: next };
  if (next === undefined) delete properties[key];
  return { ...value, properties } as T;
};
function CollectionSelect({
  value,
  change,
  clear = false,
}: {
  value: string;
  change: (value: string) => void;
  clear?: boolean;
}) {
  return (
    <label className="field">
      <span>Notation collection</span>
      <select
        aria-label="Notation collection"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        {clear && <option value="">Default appearance</option>}
        {notationCollections.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function NotationPalette({
  add,
  compact = false,
  graph,
}: {
  add: (node: Partial<GraphNode>) => void;
  compact?: boolean;
  graph: Graph;
}) {
  const [collection, setCollection] = useState<NotationCollectionId>(
    graph.diagram.notation?.collection ?? 'uml',
  );
  const [kind, setKind] = useState<string>(graph.diagram.notation?.diagramKind ?? '');
  const [search, setSearch] = useState('');
  const selected = notationCollections.find((item) => item.id === collection)!;
  const symbols = notationSymbols.filter(
    (item) =>
      item.collection === collection &&
      (!kind || item.diagramKinds.includes(kind as never)) &&
      `${item.label} ${item.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <ToolbarMenu label="Notation collections" icon={<Shapes size={18} />} text={!compact}>
      <h3>Notation collections</h3>
      <p>Choose a symbol, then edit its properties and relationships.</p>
      <CollectionSelect
        value={collection}
        change={(value) => {
          setCollection(value as NotationCollectionId);
          setKind('');
        }}
      />
      <label className="field">
        <span>Diagram family</span>
        <select
          aria-label="Notation diagram family"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">All families</option>
          {selected.diagramKinds.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Find a symbol</span>
        <input
          type="search"
          aria-label="Find a notation symbol"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="notation-palette">
        {symbols.map((item) => (
          <button
            key={item.id}
            aria-label={`Add ${selected.label} ${item.label}`}
            onClick={() => {
              const value = {
                collection,
                symbol: item.id,
                ...(kind ? { diagramKind: kind } : {}),
              } as NodeNotation;
              add({
                nodeType: item.container ? 'group' : 'generic',
                title: item.label,
                ...item.defaultSize,
                notation: {
                  ...value,
                  ...(item.compartments
                    ? { compartments: notationCompartmentDefaults(value, item.compartments) }
                    : {}),
                },
              });
            }}
          >
            <NotationGlyph value={{ collection, symbol: item.id } as NodeNotation} size={36} />
            <span>
              {item.label}
              <small>{item.category}</small>
            </span>
          </button>
        ))}
      </div>
      {!symbols.length && <p role="status">No matching symbols.</p>}
      <a href="/help/notation-collections/" target="_blank" rel="noreferrer">
        When to use each notation
      </a>
    </ToolbarMenu>
  );
}
export function NotationNodeProperties({
  node,
  graph,
  update,
}: {
  node: GraphNode;
  graph: Graph;
  update: (patch: Partial<GraphNode>, coalesce?: boolean) => void;
}) {
  const [error, setError] = useState('');
  const notation = node.notation;
  const symbol = notation && getNotationSymbol(notation.collection, notation.symbol);
  const attachmentHosts =
    notation?.collection === 'bpmn' && notation.symbol === 'boundary-event'
      ? graph.nodes.filter(
          (item) =>
            item.notation?.collection === 'bpmn' &&
            [
              'task',
              'subprocess',
              'call-activity',
              'transaction',
              'event-subprocess',
              'ad-hoc-subprocess',
            ].includes(item.notation.symbol),
        )
      : notation?.collection === 'uml' && umlAttachmentTargets[notation.symbol]
        ? graph.nodes.filter(
            (item) =>
              item.notation?.collection === 'uml' &&
              umlAttachmentTargets[notation.symbol].includes(item.notation.symbol),
          )
        : [];
  const change = (value: NodeNotation | undefined) => {
    try {
      if (value) validateNodeNotation(value);
      validateNotationGraph({
        ...graph,
        nodes: graph.nodes.map((item) =>
          item.id === node.id ? { ...item, notation: value } : item,
        ),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invalid notation.');
      return;
    }
    setError('');
    update({ notation: value, ...(value ? { flowchartSymbol: undefined } : {}) }, false);
  };
  return (
    <section className="notation-properties" aria-label="Notation properties">
      <CollectionSelect
        value={notation?.collection ?? ''}
        clear
        change={(value) => {
          const first = notationSymbols.find((item) => item.collection === value);
          change(
            first
              ? ({ collection: first.collection, symbol: first.id } as NodeNotation)
              : undefined,
          );
        }}
      />
      {notation && symbol && (
        <>
          <label className="field">
            <span>Notation symbol</span>
            <select
              aria-label="Notation symbol"
              value={notation.symbol}
              onChange={(e) =>
                change({ collection: notation.collection, symbol: e.target.value } as NodeNotation)
              }
            >
              {notationSymbols
                .filter((item) => item.collection === notation.collection)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">
            {symbol.category}. Rename directly on the canvas with F2 or a double tap.
          </p>
          <button
            onClick={() =>
              update(
                { ...symbol.defaultSize, nodeType: symbol.container ? 'group' : node.nodeType },
                false,
              )
            }
          >
            Use recommended size
          </button>
          <NotationPropertyFields
            definitions={editableNodeFields(notation, symbol.properties)}
            value={notation.properties}
            change={(key, value) => change(editNodeProperty(notation, key, value))}
          />
          {(notation.compartments ?? []).map((section, index) => (
            <div className="notation-compartment-editor" key={section.id}>
              <label className="field">
                <span>Section name</span>
                <input
                  aria-label={`Section ${index + 1} name`}
                  value={section.title ?? ''}
                  onChange={(e) =>
                    change({
                      ...notation,
                      compartments: notation.compartments!.map((item) =>
                        item.id === section.id ? { ...item, title: e.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Entries, one per line</span>
                <textarea
                  aria-label={`Section ${index + 1} entries`}
                  rows={3}
                  value={section.lines.join('\n')}
                  onChange={(e) =>
                    change({
                      ...notation,
                      compartments: notation.compartments!.map((item) =>
                        item.id === section.id
                          ? { ...item, lines: e.target.value.split('\n') }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  change({
                    ...notation,
                    compartments: notation.compartments!.filter((item) => item.id !== section.id),
                  })
                }
              >
                <Trash2 size={14} />
                Remove section
              </button>
            </div>
          ))}
          {symbol.compartments &&
            (notation.compartments?.length ?? 0) < notationCompartmentLimit(notation) && (
              <button
                onClick={() =>
                  change({
                    ...notation,
                    compartments: [
                      ...(notation.compartments ?? []),
                      { id: `section-${crypto.randomUUID()}`, title: 'Section', lines: [] },
                    ],
                  })
                }
              >
                <Plus size={14} />
                Add section
              </button>
            )}
          {(notation.attachmentId || attachmentHosts.length > 0) && (
            <label className="field">
              <span>Attached to</span>
              <select
                aria-label="Notation attachment"
                value={notation.attachmentId ?? ''}
                onChange={(e) => change({ ...notation, attachmentId: e.target.value || undefined })}
              >
                <option value="">No attachment</option>
                {attachmentHosts
                  .filter((item) => item.id !== node.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Related module or classifier</span>
            <select
              aria-label="Notation related node"
              value={notation.relatedNodeId ?? ''}
              onChange={(e) => change({ ...notation, relatedNodeId: e.target.value || undefined })}
            >
              <option value="">No reference</option>
              {graph.nodes
                .filter((item) => item.id !== node.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          {(notation.ports ?? []).map((port, index) => (
            <div className="notation-compartment-editor" key={port.id}>
              <label className="field">
                <span>Port label</span>
                <input
                  aria-label={`Port ${index + 1} label`}
                  value={port.label ?? ''}
                  onChange={(e) =>
                    change({
                      ...notation,
                      ports: notation.ports!.map((item) =>
                        item.id === port.id ? { ...item, label: e.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Port side</span>
                <select
                  aria-label={`Port ${index + 1} side`}
                  value={port.side}
                  onChange={(e) =>
                    change({
                      ...notation,
                      ports: notation.ports!.map((item) =>
                        item.id === port.id
                          ? { ...item, side: e.target.value as typeof port.side }
                          : item,
                      ),
                    })
                  }
                >
                  {['left', 'right', 'top', 'bottom'].map((side) => (
                    <option key={side}>{side}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Port direction</span>
                <select
                  aria-label={`Port ${index + 1} direction`}
                  value={port.direction ?? 'both'}
                  onChange={(e) =>
                    change({
                      ...notation,
                      ports: notation.ports!.map((item) =>
                        item.id === port.id
                          ? { ...item, direction: e.target.value as typeof port.direction }
                          : item,
                      ),
                    })
                  }
                >
                  {['in', 'out', 'both'].map((direction) => (
                    <option key={direction}>{direction}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Position along side (0–1)</span>
                <NotationDraftInput
                  label={`Port ${index + 1} position`}
                  type="number"
                  min={0}
                  max={1}
                  step="any"
                  value={port.offset ?? 0.5}
                  commit={(next) =>
                    change({
                      ...notation,
                      ports: notation.ports!.map((item) =>
                        item.id === port.id
                          ? { ...item, offset: next === undefined ? undefined : Number(next) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  change({
                    ...notation,
                    ports: notation.ports!.filter((item) => item.id !== port.id),
                  })
                }
              >
                Remove port
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              change({
                ...notation,
                ports: [
                  ...(notation.ports ?? []),
                  { id: `port-${crypto.randomUUID()}`, side: 'right', direction: 'both' },
                ],
              })
            }
          >
            Add named port
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <a href="/help/notation-collections/" target="_blank" rel="noreferrer">
        Notation guide
      </a>
    </section>
  );
}
export function NotationEdgeProperties({
  edge,
  graph,
  update,
}: {
  edge: GraphEdge;
  graph: Graph;
  update: (patch: Partial<GraphEdge>) => void;
}) {
  const [error, setError] = useState('');
  const notation = edge.notation;
  const definition =
    notation &&
    notationEdgeSymbols.find(
      (item) => item.collection === notation.collection && item.id === notation.symbol,
    );
  const change = (value: EdgeNotation | undefined) => {
    try {
      if (value) validateEdgeNotation(value);
      validateNotationGraph({
        ...graph,
        edges: graph.edges.map((item) =>
          item.id === edge.id ? { ...item, notation: value } : item,
        ),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invalid notation.');
      return;
    }
    setError('');
    update({ notation: value });
  };
  return (
    <section className="notation-properties" aria-label="Notation relationship properties">
      <CollectionSelect
        value={notation?.collection ?? ''}
        clear
        change={(value) => {
          const first = notationEdgeSymbols.find((item) => item.collection === value);
          change(
            first
              ? ({ collection: first.collection, symbol: first.id } as EdgeNotation)
              : undefined,
          );
        }}
      />
      {notation && (
        <>
          <label className="field">
            <span>Relationship notation</span>
            <select
              aria-label="Relationship notation"
              value={notation.symbol}
              onChange={(e) =>
                change({ collection: notation.collection, symbol: e.target.value } as EdgeNotation)
              }
            >
              {notationEdgeSymbols
                .filter((item) => item.collection === notation.collection)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          {definition && (
            <NotationPropertyFields
              definitions={definition.properties}
              value={notation.properties}
              change={(key, value) => change(withProperty(notation, key, value))}
            />
          )}
          {(
            [
              'sourceLabel',
              'targetLabel',
              ...(notation.collection === 'uml'
                ? (['sourceMultiplicity', 'targetMultiplicity'] as const)
                : []),
            ] as const
          ).map((key) => (
            <label className="field" key={key}>
              <span>{key.replace(/([A-Z])/g, ' $1')}</span>
              <NotationDraftInput
                label={`Notation ${key}`}
                value={notation[key]}
                commit={(next) => change({ ...notation, [key]: next })}
              />
            </label>
          ))}
          {(['source', 'target'] as const).map((end) => {
            const key = `${end}Port` as const;
            const node = graph.nodes.find(
              (item) => item.id === (end === 'source' ? edge.sourceNodeId : edge.targetNodeId),
            );
            return (
              <label className="field" key={end}>
                <span>{end} port</span>
                <select
                  aria-label={`Notation ${key}`}
                  value={notation[key] ?? ''}
                  onChange={(event) =>
                    change({ ...notation, [key]: event.target.value || undefined })
                  }
                >
                  <option value="">Automatic</option>
                  {['left', 'right', 'top', 'bottom'].map((side) => (
                    <option key={side} value={side}>
                      {side}
                    </option>
                  ))}
                  {node?.notation?.ports
                    ?.filter((port) => port.direction !== (end === 'source' ? 'in' : 'out'))
                    .map((port) => (
                      <option key={port.id} value={port.id}>
                        {port.label || port.id}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <a href="/help/notation-collections/" target="_blank" rel="noreferrer">
        Relationship guide
      </a>
    </section>
  );
}
export function NotationDiagramProperties({ graph }: { graph: Graph }) {
  const profile = graph.diagram.notation;
  const collection = notationCollections.find((item) => item.id === profile?.collection);
  const change = (notation: NotationProfile | undefined) =>
    useEditor.getState().command('Change notation profile', (current) => ({
      ...current,
      diagram: { ...current.diagram, notation },
    }));
  const issues = notationIssues(graph);
  return (
    <section className="notation-properties" aria-label="Document notation">
      <CollectionSelect
        value={profile?.collection ?? ''}
        clear
        change={(value) => {
          const item = notationCollections.find((item) => item.id === value);
          change(
            item
              ? ({
                  schemaVersion: 1,
                  collection: item.id,
                  diagramKind: item.diagramKinds[0].id,
                } as NotationProfile)
              : undefined,
          );
        }}
      />
      {profile && collection && (
        <label className="field">
          <span>Diagram family</span>
          <select
            aria-label="Document notation family"
            value={profile.diagramKind}
            onChange={(e) => change({ ...profile, diagramKind: e.target.value } as NotationProfile)}
          >
            {collection.diagramKinds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted">The profile guides new objects. Existing objects keep their notation.</p>
      {issues.length ? (
        <details>
          <summary>Review notation ({issues.length})</summary>
          <ul className="notation-validation">
            {issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </details>
      ) : (
        <p>Notation validation: no issues found.</p>
      )}
    </section>
  );
}
