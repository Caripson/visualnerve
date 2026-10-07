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
  return (
    <>
      <label className="simulation-field">
        Routing strategy
        <select
          aria-label="Routing strategy"
          value={node.router.mode}
          onChange={(event) =>
            patchNode({
              router: { ...node.router, mode: event.target.value as typeof node.router.mode },
            })
          }
        >
          {['first-match', 'weighted', 'least-queue', 'available-capacity'].map((mode) => (
            <option key={mode}>{mode}</option>
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
        label="Routing rules"
        value={node.router.rules ?? []}
        change={(value) =>
          patchNode({ router: { ...node.router, rules: value as typeof node.router.rules } })
        }
      />
      <label>
        Fallback connection
        <select
          aria-label="Fallback connection"
          value={node.router.fallbackEdgeId ?? ''}
          onChange={(event) =>
            patchNode({
              router: { ...node.router, fallbackEdgeId: event.target.value || undefined },
            })
          }
        >
          <option value="">First valid outgoing connection</option>
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
