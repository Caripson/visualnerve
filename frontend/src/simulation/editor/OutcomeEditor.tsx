import { runStatusLabel } from '../display';
import { useI18n } from '../../i18n';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { SimulationNode } from '../types';
import type { NodeSectionProps } from './types';
export function OutcomeEditor({
  draft,
  node,
  patchNode,
}: NodeSectionProps & { node: Extract<SimulationNode, { type: 'outcome' }> }) {
  const { t } = useI18n();
  return (
    <>
      <label>
        {t('simulator.editor.outcome.outcome')}{' '}
        <select
          aria-label={t('simulator.editor.outcome.statusLabel')}
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
            <option key={status} value={status}>
              {runStatusLabel(t, status)}
            </option>
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
        {t('simulator.editor.outcome.realizeRevenue')}{' '}
      </label>
      <NumberField
        label={t('simulator.editor.outcome.outcomeRevenueOverride')}
        value={node.outcome.revenueOverride}
        change={(value) => patchNode({ outcome: { ...node.outcome, revenueOverride: value } })}
      />
    </>
  );
}
