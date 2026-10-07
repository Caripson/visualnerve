import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { SimulationNode } from '../types';
import type { NodeSectionProps } from './types';
export function OutcomeEditor({
  draft,
  node,
  patchNode,
}: NodeSectionProps & { node: Extract<SimulationNode, { type: 'outcome' }> }) {
  return (
    <>
      <label>
        Outcome
        <select
          aria-label="Outcome status"
          value={node.outcome.status}
          onChange={(event) =>
            patchNode({
              outcome: {
                ...node.outcome,
                status: event.target.value as typeof node.outcome.status,
              },
            })
          }
        >
          {['completed', 'failed', 'rejected'].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={node.outcome.revenue}
          onChange={(event) =>
            patchNode({ outcome: { ...node.outcome, revenue: event.target.checked } })
          }
        />{' '}
        Realize revenue
      </label>
      <NumberField
        label="Outcome revenue override"
        value={node.outcome.revenueOverride}
        change={(value) => patchNode({ outcome: { ...node.outcome, revenueOverride: value } })}
      />
    </>
  );
}
