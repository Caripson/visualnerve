import { useI18n } from '../i18n';
import { useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { useEditor } from '../state/editor';
import { askDiagram } from './client';
import { questionGraph } from './evidence';
import type { Graph } from '../model/types';
import type { DiagramQuestion, DiagramQuestionResult } from './types';
import { questionDisplayMessage, questionSummary, questionEvidenceLabel } from './display';
import '../components/analysis-tools.css';
import './questions.css';

const fingerprint = (graph: Graph) => {
  const { graphVersion: _version, ...content } = questionGraph(graph);
  return JSON.stringify(content);
};
export function QuestionDialog({ close }: { close: () => void }) {
  const { t, number } = useI18n();
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
    <Modal title={t('questions.title')} close={close} wide>
      <div className="analysis-dialog question-dialog">
        <p>{t('questions.introduction')}</p>
        <label className="field">
          {t('questions.find')}
          <input
            aria-label={t('questions.findAria')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('questions.searchHint')}
          />
        </label>
        <div className="analysis-fields">
          <label className="field">
            {t('questions.start')}
            <select
              aria-label={t('questions.startAria')}
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
            {t('questions.question')}
            <select
              aria-label={t('questions.questionAria')}
              value={kind}
              onChange={(event) => setKind(event.target.value as DiagramQuestion['kind'])}
            >
              <option value="downstream">{t('questions.downstream')}</option>
              <option value="upstream">{t('questions.upstream')}</option>
              <option value="path">{t('questions.path')}</option>
            </select>
          </label>
        </div>
        {kind === 'path' && (
          <label className="field">
            {t('questions.destination')}
            <select
              aria-label={t('questions.destinationAria')}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">{t('questions.chooseDestination')}</option>
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
            {t('questions.maximumSteps')}
            <input
              aria-label={t('questions.maximumStepsAria')}
              type="number"
              min={1}
              max={64}
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            />
          </label>
          <label className="field">
            {t('questions.relationshipType')}
            <select
              aria-label={t('questions.relationshipTypeAria')}
              value={edgeType}
              onChange={(event) => setEdgeType(event.target.value)}
            >
              <option value="">{t('questions.allTypes')}</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
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
          {t('questions.includeUncertain')}
        </label>
        <label className="analysis-check">
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(event) => setIncludeHidden(event.target.checked)}
          />
          {t('questions.includeHidden')}
        </label>
        <button
          className="primary"
          disabled={busy || !startId || (kind === 'path' && !targetId)}
          onClick={() => void ask()}
        >
          {busy ? t('questions.busy') : t('questions.ask')}
        </button>
        {notice && <p role="status">{questionDisplayMessage(notice, t)}</p>}
        {stale && <p role="alert">{t('questions.stale')}</p>}
        {response && (
          <section aria-label={t('questions.answers')}>
            <h3>{questionSummary(response.result, graph, t)}</h3>
            {response.result.warnings.map((warning) => (
              <p className="muted" key={warning}>
                {questionDisplayMessage(warning, t, response.result.question.maxDepth)}
              </p>
            ))}
            <button disabled={busy || stale || !response.result.found} onClick={() => focus()}>
              {t('questions.focusRelated')}
            </button>
            <ol className="question-answers" start={response.result.offset + 1}>
              {response.result.answers.map((answer) => (
                <li key={answer.nodeId}>
                  <strong>{answer.title}</strong>
                  <span>
                    {t('questions.distance', {
                      steps: number(answer.distance),
                      confidence: questionEvidenceLabel(answer.confidence, t),
                    })}
                  </span>
                  <details>
                    <summary>{t('questions.why')}</summary>
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
                              {questionEvidenceLabel(evidence.source, t)} · {evidence.kind} ·{' '}
                              {questionEvidenceLabel(evidence.confidence, t)}
                            </p>
                            <p>{evidence.description}</p>
                            {evidence.path && (
                              <code>
                                {evidence.path}
                                {evidence.line ? `:${evidence.line}` : ''}
                              </code>
                            )}
                            {evidence.shortened && <p>{t('questions.shortened')}</p>}
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                  <button disabled={stale || busy} onClick={() => focus(answer.nodeId)}>
                    {t('questions.focusPath')}
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
                {t('questions.previous')}
              </button>
              <span>{t('questions.matches', { count: number(response.result.total) })}</span>
              <button
                disabled={busy || stale || !response.result.hasMore}
                onClick={() => void ask(response.result.offset + 25, response.result.question)}
              >
                {t('questions.next')}
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
