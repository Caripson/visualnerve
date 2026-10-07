import { useEditor } from '../state/editor';
import { useSimulation } from './useSimulation';
import type { SimulationModel, SimulationNode, Resource } from './types';
import type { GraphNode } from '../model/types';
import {
  getSimulationCapacityCard,
  logicalNodeId,
  resolveSimulationRenderModel,
} from './render-model';
import { getSimulationPresentationSlots } from './presentation-slots';

const indices = new WeakMap<
  SimulationModel,
  { nodes: Map<string, SimulationNode>; resources: Map<string, Resource> }
>();
function index(model: SimulationModel) {
  let value = indices.get(model);
  if (!value) {
    value = {
      nodes: new Map(model.nodes.map((node) => [node.id, node])),
      resources: new Map(model.resources.map((resource) => [resource.id, resource])),
    };
    indices.set(model, value);
  }
  return value;
}

export function SimulationNodeSummary({ id, node }: { id: string; node?: GraphNode }) {
  const baseModel = useEditor((state) => state.graph?.simulation);
  const diagramId = useEditor((state) =>
    state.graph?.simulation ? state.graph.diagram.id : undefined,
  );
  const view = useSimulation(diagramId);
  if (!baseModel) return null;
  const model = resolveSimulationRenderModel(view?.run.model ?? baseModel, view?.run.options);
  const lookup = index(model);
  const logicalId = node ? logicalNodeId(node) : id;
  const card = node && getSimulationCapacityCard(node);
  const config = lookup.nodes.get(logicalId);
  if (!config) return null;
  const metric = view?.state?.nodes[logicalId];
  const resource =
    config.type === 'resource' ? view?.state?.resources[config.resourceId] : undefined;
  const capacity =
    resource?.capacity ??
    metric?.capacity ??
    card?.total ??
    (config.type === 'work'
      ? config.work.capacity
      : config.type === 'resource'
        ? lookup.resources.get(config.resourceId)?.capacity
        : undefined);
  const resourceNames =
    config.type === 'work'
      ? (config.work.resourceRequirements ?? []).map(
          (requirement) =>
            lookup.resources.get(requirement.resourceId)?.name ?? requirement.resourceId,
        )
      : config.type === 'resource'
        ? [lookup.resources.get(config.resourceId)?.name ?? config.resourceId]
        : [];
  const fullResourceNames = resourceNames.join(', ');
  const shortResourceNames =
    fullResourceNames.length > 56
      ? `${fullResourceNames.slice(0, 55).trimEnd()}…`
      : fullResourceNames;
  const workSlots =
    config.type === 'work' && view?.state
      ? getSimulationPresentationSlots(view.run.id, view.state).occupancy(logicalId)
      : undefined;
  const occupied =
    card &&
    capacity !== undefined &&
    capacity > 0 &&
    (workSlots
      ? workSlots.displayedBusyUnits.some(
          (unit) => unit === card.unit || (card.hidden > 0 && unit >= card.unit),
        ) ||
        (card.hidden > 0 && workSlots.busy > workSlots.displayedCapacity)
      : (resource?.busy ?? metric?.busy ?? 0) > card.unit - 1);
  return (
    <div
      className="simulation-node-summary"
      data-simulation-node={id}
      data-simulation-logical-node={logicalId}
      data-queue={
        card && card.unit > 1 ? undefined : (resource?.queue.current ?? metric?.queue.current ?? 0)
      }
    >
      <span>
        {config.type} {metric ? `· ${metric.status}` : ''}
      </span>
      {resourceNames.length > 0 && (
        <span
          className="simulation-node-resources"
          title={`Required resources: ${fullResourceNames}`}
          aria-label={`Required resources: ${fullResourceNames}`}
        >
          Resources: {shortResourceNames}
        </span>
      )}
      {config.type === 'source' && (
        <span>
          {metric
            ? `Created ${metric.started}`
            : `${(config.source.ratePerHour ?? 0).toFixed(2)} arrivals / hour`}
        </span>
      )}
      {config.type === 'outcome' && metric && (
        <span>
          {metric.realizedRevenue.toFixed(2)} {model.currency} revenue
        </span>
      )}
      {(config.type === 'work' || config.type === 'resource') && capacity !== undefined && (
        <>
          <span>
            Capacity {capacity} ·{' '}
            {((resource?.currentUtilization ?? metric?.currentUtilization ?? 0) * 100).toFixed(0)}%
            busy
          </span>
          {card ? (
            <>
              <span
                className="simulation-capacity-card-unit"
                data-capacity-occupied={capacity > 0 ? !!occupied : undefined}
              >
                {capacity > 0
                  ? `Unit ${card.unit} of ${capacity} · ${occupied ? 'occupied' : 'idle'}`
                  : 'No active capacity'}
              </span>
              {card.hidden > 0 && (
                <span aria-label={`${card.hidden} additional capacity units aggregated`}>
                  +{card.hidden} units aggregated
                </span>
              )}
            </>
          ) : (
            <div className="simulation-capacity-units" aria-label={`${capacity} capacity units`}>
              {Array.from({ length: Math.min(8, capacity) }, (_, index) => (
                <i
                  key={index}
                  className={index < (resource?.busy ?? metric?.busy ?? 0) ? 'occupied' : ''}
                >
                  {index + 1}
                </i>
              ))}
              {capacity > 8 && <span>+{capacity - 8}</span>}
            </div>
          )}
        </>
      )}
      {(metric || resource) &&
        (config.type === 'work' || config.type === 'resource') &&
        (!card || card.unit === 1) && (
          <span>
            Queue {resource?.queue.current ?? metric?.queue.current ?? 0}
            {metric && config.type === 'work' ? ` · done ${metric.completed}` : ''}
          </span>
        )}
    </div>
  );
}
