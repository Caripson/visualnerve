import { useI18n } from '../../i18n';
import type { SimulationNode } from '../types';
import type { NodeSectionProps } from './types';

/** Synchronization uses a declared pair and mandatory branches, never a visual heuristic. */
export function ParallelFlowEditor({
  draft,
  node,
}: NodeSectionProps & {
  node: Extract<SimulationNode, { type: 'fork' | 'join' }>;
}) {
  const { t } = useI18n();
  if (node.type === 'join') {
    const fork = draft.nodes.find((entry) => entry.id === node.join.forkNodeId);
    return (
      <section className="simulation-panel" aria-label={t('simulator.parallel.join')}>
        <p>{t('simulator.parallel.joinExplanation')}</p>
        <p>
          <strong>{t('simulator.parallel.pairedFork')}</strong> {fork?.name ?? node.join.forkNodeId}
        </p>
        <p>{t('simulator.parallel.failureExplanation')}</p>
      </section>
    );
  }
  const join = draft.nodes.find((entry) => entry.id === node.fork.joinNodeId);
  return (
    <section className="simulation-panel" aria-label={t('simulator.parallel.fork')}>
      <p>{t('simulator.parallel.forkExplanation')}</p>
      <p>
        <strong>{t('simulator.parallel.pairedJoin')}</strong> {join?.name ?? node.fork.joinNodeId}
      </p>
      <p>
        <strong>{t('simulator.parallel.requiredBranches')}</strong>
      </p>
      <ul>
        {draft.edges
          .filter((edge) => edge.sourceNodeId === node.id)
          .map((edge) => (
            <li key={edge.id}>
              {draft.nodes.find((entry) => entry.id === edge.targetNodeId)?.name ??
                edge.targetNodeId}
            </li>
          ))}
      </ul>
      <p className="muted">{t('simulator.parallel.connectExplanation')}</p>
      <p>{t('simulator.parallel.failureExplanation')}</p>
    </section>
  );
}
