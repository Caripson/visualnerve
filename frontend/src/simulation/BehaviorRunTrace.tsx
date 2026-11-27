import type { SimulationView } from './service';
import type { SimulationBehaviorTrace } from './types';

const decisions: Record<string, string> = {
  'already-open': 'Reserve slot is already open',
  'not-a-work-node': 'Receiver is not a Work node',
  'unsupported-staffing-configuration': 'Staffing configuration is unsupported in this preview',
  'schedule-closed': 'Work or staff schedule is closed',
  'queue-empty': 'No customer is waiting in the queue',
  'staff-busy': 'Staff busy',
  'capacity-limit': 'Work capacity limit reached',
  'opened-and-allocated': 'Reserve slot opened and staff allocated',
  'no-active-handler': 'No active handler received this message',
};

export function BehaviorRunTrace({ view }: { view: SimulationView }) {
  const snapshot = view.run.options.behaviors;
  if (!snapshot) return null;
  const rows = view.state?.behaviorTrace ?? view.run.result?.behaviorTrace ?? [];
  const definitions = new Map(
    snapshot.definitions.map((definition) => [definition.id, definition]),
  );
  const nodes = new Map(view.run.model.nodes.map((node) => [node.id, node.name]));
  const resources = new Map(
    view.run.model.resources.map((resource) => [resource.id, resource.name]),
  );
  const node = (id: string) => nodes.get(id) ?? id;
  const describe = (entry: SimulationBehaviorTrace) => {
    switch (entry.kind) {
      case 'queueChanged':
        return `queueChanged ${entry.previousLength} → ${entry.length}`;
      case 'send':
        return `Send “${entry.message}” to ${node(entry.targetNodeId!)}`;
      case 'message':
        return `Message “${entry.message}” from ${node(entry.sourceNodeId!)}`;
      case 'reserve':
        return `Reserve slot using ${resources.get(entry.resourceId!) ?? entry.resourceId}`;
      case 'error':
        return 'Behavior stopped';
    }
  };
  return (
    <details className="simulation-behavior-trace" open>
      <summary>Behavior trace</summary>
      {!rows.length && <p>No Behavior events at this time.</p>}
      <ol aria-label="Simulated Behavior events">
        {rows.map((entry) => (
          <li key={entry.sequence}>
            <time>{entry.timeSeconds} s</time> · phase {entry.phase} · event {entry.eventSequence} ·{' '}
            {node(entry.nodeId)}
            {entry.definitionId && ` · ${definitions.get(entry.definitionId)?.name}`}
            {entry.bindingId && (
              <>
                {' '}
                · <span title={entry.bindingId}>instance {entry.bindingId.slice(0, 8)}</span>
              </>
            )}
            {entry.line && ` · line ${entry.line}:${entry.column}`} · {describe(entry)}
            {entry.messageId && ` · message #${entry.messageId}`}
            {entry.decision &&
              ` · ${Object.hasOwn(decisions, entry.decision) ? decisions[entry.decision] : entry.decision}`}
            {entry.particleId !== undefined && ` · customer #${entry.particleId}`}
          </li>
        ))}
      </ol>
      <details>
        <summary>Captured Behavior source</summary>
        {snapshot.definitions.map((definition) => (
          <section key={definition.id} aria-label={definition.name}>
            <strong>{definition.name}</strong>
            <pre>
              <code>{definition.source}</code>
            </pre>
          </section>
        ))}
      </details>
    </details>
  );
}
