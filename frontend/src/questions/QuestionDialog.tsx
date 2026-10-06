import { useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { useEditor } from '../state/editor';
import { askDiagram } from './client';
import { questionGraph } from './evidence';
import type { Graph } from '../model/types';
import type { DiagramQuestion, DiagramQuestionResult } from './types';
import '../components/analysis-tools.css';
import './questions.css';

const fingerprint = (graph: Graph) => {
  const { graphVersion: _version, ...content } = questionGraph(graph);
  return JSON.stringify(content);
};
export function QuestionDialog({ close }: { close: () => void }) {
  const graph = useEditor((state) => state.graph);
  const selected = useEditor((state) => state.selectedNodes);
  const [startId, setStartId] = useState(selected[0] ?? graph?.nodes[0]?.id ?? '');
  const [targetId, setTargetId] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<DiagramQuestion['kind']>('downstream');
  const [depth, setDepth] = useState(16);
  const [edgeType, setEdgeType] = useState('');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [includeUncertain, setIncludeUncertain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [response, setResponse] = useState<{ result: DiagramQuestionResult; signature: string }>();
  const signature = useMemo(() => (graph ? fingerprint(graph) : ''), [graph]);
  const objects = useMemo(() => {
    const matching = (graph?.nodes ?? [])
      .filter((node) => node.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .slice(0, 100);
    const map = new Map(matching.map((node) => [node.id, node]));
    for (const node of graph?.nodes ?? [])
      if (node.id === startId || node.id === targetId) map.set(node.id, node);
    return [...map.values()];
  }, [graph?.nodes, search, startId, targetId]);
  const types = useMemo(
    () => [...new Set(graph?.edges.map((edge) => edge.edgeType))].sort(),
    [graph?.edges],
  );
  if (!graph) return null;
  const stale = !!response && response.signature !== signature;
  const ask = async (offset = 0, config?: DiagramQuestion) => {
    const snapshot = useEditor.getState().graph;
    if (!snapshot) return;
    const currentSignature = fingerprint(snapshot);
    setBusy(true);
    setNotice('');
    try {
      const result = await askDiagram(
        snapshot,
        config
          ? { ...config, offset }
          : {
              startId,
              kind,
              ...(kind === 'path' ? { targetId } : {}),
              maxDepth: depth,
              edgeTypes: edgeType ? [edgeType] : [],
              includeHidden,
              includeUncertain,
              offset,
              limit: 25,
            },
      );
      const current = useEditor.getState().graph;
      if (
        !current ||
        current.diagram.id !== snapshot.diagram.id ||
        fingerprint(current) !== currentSignature
      )
        throw new Error(
          'The diagram changed during analysis. Ask again to use the latest relationships.',
        );
      setResponse({ result, signature: currentSignature });
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const focus = (target?: string) => {
    if (!response || stale) return;
    const query = response.result.question;
    const destination = target ?? (query.kind === 'path' ? query.targetId : undefined);
    useEditor.getState().explore({
      version: 1,
      mode: destination ? 'path' : 'impact',
      startId: destination && query.kind === 'upstream' ? destination : query.startId,
      ...(destination ? { targetId: query.kind === 'upstream' ? query.startId : destination } : {}),
      direction: query.kind === 'upstream' ? 'incoming' : 'outgoing',
      steps: destination ? 1 : query.maxDepth,
      directed: true,
      includeHidden: query.includeHidden,
      edgeTypes: query.edgeTypes,
      includeUncertain: query.includeUncertain,
    });
    setNotice(
      'Relationship focus applied. Large views are bounded; the complete answer remains available here.',
    );
  };
  return (
    <Modal title="Ask about this diagram" close={close} wide>
      <div className="analysis-dialog question-dialog">
        <p>
          Investigate modeled connections and inspect the evidence behind each path. AI can use the
          same questions through MCP.
        </p>
        <label className="field">
          Find objects
          <input
            aria-label="Find question objects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search titles; up to 100 matches"
          />
        </label>
        <div className="analysis-fields">
          <label className="field">
            Start object
            <select
              aria-label="Question start object"
              value={startId}
              onChange={(event) => setStartId(event.target.value)}
            >
              {objects.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title} · {node.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Question
            <select
              aria-label="Diagram question"
              value={kind}
              onChange={(event) => setKind(event.target.value as DiagramQuestion['kind'])}
            >
              <option value="downstream">What is downstream of this object?</option>
              <option value="upstream">What is upstream of this object?</option>
              <option value="path">How are these objects connected?</option>
            </select>
          </label>
        </div>
        {kind === 'path' && (
          <label className="field">
            Destination
            <select
              aria-label="Question destination"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Choose destination</option>
              {objects.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title} · {node.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="analysis-fields">
          <label className="field">
            Maximum steps
            <input
              aria-label="Question maximum steps"
              type="number"
              min={1}
              max={64}
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            />
          </label>
          <label className="field">
            Relationship type
            <select
              aria-label="Question relationship type"
              value={edgeType}
              onChange={(event) => setEdgeType(event.target.value)}
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="analysis-check">
          <input
            type="checkbox"
            checked={includeUncertain}
            onChange={(event) => setIncludeUncertain(event.target.checked)}
          />
          Include heuristic and unresolved connections
        </label>
        <label className="analysis-check">
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(event) => setIncludeHidden(event.target.checked)}
          />
          Include retained CSV groups outside the current view
        </label>
        <button
          className="primary"
          disabled={busy || !startId || (kind === 'path' && !targetId)}
          onClick={() => void ask()}
        >
          {busy ? 'Investigating…' : 'Ask diagram'}
        </button>
        {notice && <p role="status">{notice}</p>}
        {stale && (
          <p role="alert">The relationships changed. Ask again before focusing these results.</p>
        )}
        {response && (
          <section aria-label="Question answers">
            <h3>{response.result.summary}</h3>
            {response.result.warnings.map((warning) => (
              <p className="muted" key={warning}>
                {warning}
              </p>
            ))}
            <button disabled={busy || stale || !response.result.found} onClick={() => focus()}>
              Focus related objects
            </button>
            <ol className="question-answers" start={response.result.offset + 1}>
              {response.result.answers.map((answer) => (
                <li key={answer.nodeId}>
                  <strong>{answer.title}</strong>
                  <span>
                    {answer.distance} steps · {answer.confidence}
                  </span>
                  <details>
                    <summary>Why is this connected?</summary>
                    <ol>
                      {answer.edgeIds.map((id, index) => {
                        const evidence = response.result.evidence.find(
                          (entry) => entry.edgeId === id,
                        )!;
                        const from = graph.nodes.find((node) => node.id === answer.nodeIds[index]);
                        const to = graph.nodes.find(
                          (node) => node.id === answer.nodeIds[index + 1],
                        );
                        return (
                          <li key={`${id}:${index}`}>
                            <strong>
                              {from?.title}{' '}
                              {response.result.question.kind === 'upstream' ? '←' : '→'} {to?.title}
                            </strong>
                            <p>
                              {evidence.source} · {evidence.kind} · {evidence.confidence}
                            </p>
                            <p>{evidence.description}</p>
                            {evidence.path && (
                              <code>
                                {evidence.path}
                                {evidence.line ? `:${evidence.line}` : ''}
                              </code>
                            )}
                            {evidence.shortened && (
                              <p>
                                Expression shortened. The complete expression is available on the
                                connection.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                  <button disabled={stale || busy} onClick={() => focus(answer.nodeId)}>
                    Focus this path
                  </button>
                </li>
              ))}
            </ol>
            <div className="analysis-actions">
              <button
                disabled={busy || stale || response.result.offset === 0}
                onClick={() =>
                  void ask(Math.max(0, response.result.offset - 25), response.result.question)
                }
              >
                Previous answers
              </button>
              <span>{response.result.total} matching objects</span>
              <button
                disabled={busy || stale || !response.result.hasMore}
                onClick={() => void ask(response.result.offset + 25, response.result.question)}
              >
                Next answers
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
