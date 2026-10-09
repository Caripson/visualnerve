import { routingModeLabel } from '../display';
import { useI18n } from '../../i18n';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import { RoutingRules } from './RoutingRules';
import type { SimulationNode } from '../types';
import type { NodeSectionProps } from './types';
export function RouterEditor({
  draft,
  node,
  patchNode,
}: NodeSectionProps & { node: Extract<SimulationNode, { type: 'router' }> }) {
  const { t } = useI18n();
  return (
    <>
      <label className="simulation-field">
        {t('simulator.editor.router.strategyLabel')}{' '}
        <select
          aria-label={t('simulator.editor.router.strategyLabel')}
          value={node.router.mode}
          onChange={(event) =>
            patchNode({
              router: { ...node.router, mode: event.target.value as typeof node.router.mode },
            })
          }
        >
          {['first-match', 'weighted', 'least-queue', 'available-capacity'].map((mode) => (
            <option key={mode} value={mode}>
              {routingModeLabel(t, mode)}
            </option>
          ))}
        </select>
      </label>
      <RoutingRules
        model={draft}
        nodeId={node.id}
        rules={node.router.rules ?? []}
        change={(rules) => patchNode({ router: { ...node.router, rules } })}
      />
      <JsonField
        fieldId={`routing-rules:${node.id}`}
        label={t('simulator.editor.router.routingRules')}
        value={node.router.rules ?? []}
        change={(value) =>
          patchNode({ router: { ...node.router, rules: value as typeof node.router.rules } })
        }
      />
      <label>
        {t('simulator.editor.router.fallbackConnection')}{' '}
        <select
          aria-label={t('simulator.editor.router.fallbackConnection')}
          value={node.router.fallbackEdgeId ?? ''}
          onChange={(event) =>
            patchNode({
              router: { ...node.router, fallbackEdgeId: event.target.value || undefined },
            })
          }
        >
          <option value="">{t('simulator.editor.router.firstValidOutgoingConnection')}</option>
          {draft.edges
            .filter((edge) => edge.sourceNodeId === node.id)
            .map((edge) => (
              <option key={edge.id} value={edge.id}>
                {draft.nodes.find((target) => target.id === edge.targetNodeId)?.name}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
