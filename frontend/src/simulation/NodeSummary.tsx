import { nodeTrafficReason, simulationNodeTypeLabel, trafficStatusLabel } from './display';
import { useI18n } from '../i18n';
import type { CSSProperties } from 'react';
import { useSimulationSummary } from './summary-context';
import type { SimulationModel, SimulationNode, Resource } from './types';
import type { GraphNode } from '../model/types';
import { getSimulationCapacityCard, logicalNodeId } from './render-model';
import { getSimulationPresentationSlots } from './presentation-slots';
import { simulationNodeTraffic } from './traffic';
import './traffic.css';

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
  const { t, plural } = useI18n();
  const { model, view } = useSimulationSummary();
  if (!model) return null;
  const lookup = index(model);
  const logicalId = node ? logicalNodeId(node) : id;
  const card = node && getSimulationCapacityCard(node);
  const config = lookup.nodes.get(logicalId);
  if (!config) return null;
  const metric = view?.state?.nodes[logicalId];
  const resource =
    config.type === 'resource' ? view?.state?.resources[config.resourceId] : undefined;
  const traffic = simulationNodeTraffic(config, view?.state, model);
  const trafficLabel = trafficStatusLabel(t, traffic.label);
  const trafficReason = nodeTrafficReason(t, traffic);
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
      data-traffic={traffic.level}
      data-queue={
        card && card.unit > 1 ? undefined : (resource?.queue.current ?? metric?.queue.current ?? 0)
      }
    >
      <span className="simulation-node-state">
        <span className="simulation-node-kind">{simulationNodeTypeLabel(t, config.type)}</span>
        <span
          className="simulation-traffic-badge"
          title={trafficReason}
          aria-label={t('simulator.canvas.node.', { label: trafficLabel, reason: trafficReason })}
        >
          <span className="simulation-traffic-symbol" aria-hidden="true">
            {traffic.level === 'congested'
              ? '!'
              : traffic.level === 'busy'
                ? '◷'
                : traffic.level === 'clear'
                  ? '✓'
                  : '·'}
          </span>
          {trafficLabel}
        </span>
      </span>
      <div
        className="simulation-node-details nodrag nopan nowheel"
        data-node-scroll
        role="region"
        aria-label={t('simulator.canvas.node.simulationDetailsFor', {
          name: String(node?.title ?? config.name),
        })}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            [
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'PageUp',
              'PageDown',
              'Home',
              'End',
              ' ',
            ].includes(event.key)
          )
            event.stopPropagation();
        }}
      >
        {resourceNames.length > 0 && (
          <span
            className="simulation-node-resources"
            title={t('simulator.canvas.node.requiredResources', {
              fullResourceNames: String(fullResourceNames),
            })}
            aria-label={t('simulator.canvas.node.requiredResources', {
              fullResourceNames: String(fullResourceNames),
            })}
          >
            {t('simulator.node.resources.summary', { resourceNames: fullResourceNames })}
          </span>
        )}
        {config.type === 'source' && (
          <span>
            {metric
              ? t('simulator.canvas.node.created', { started: String(metric.started) })
              : t('simulator.canvas.node.arrivalsHour', {
                  arrivalsPerHour: String((config.source.ratePerHour ?? 0).toFixed(2)),
                })}
          </span>
        )}
        {config.type === 'outcome' && metric && (
          <span>
            {t('simulator.node.outcome.revenue', {
              revenue: metric.realizedRevenue.toFixed(2),
              currency: model.currency,
            })}
          </span>
        )}
        {(config.type === 'work' || config.type === 'resource') && capacity !== undefined && (
          <>
            <span className="simulation-node-capacity">
              {t('simulator.node.capacity.summary', {
                capacity,
                utilizationPercent: (
                  (resource?.currentUtilization ?? metric?.currentUtilization ?? 0) * 100
                ).toFixed(0),
              })}
            </span>
            <span
              className="simulation-utilization-track"
              aria-hidden="true"
              style={
                {
                  '--simulation-utilization': `${Math.min(100, Math.max(0, traffic.utilization * 100))}%`,
                } as CSSProperties
              }
            >
              <span />
            </span>
            {card ? (
              <>
                <span
                  className="simulation-capacity-card-unit"
                  data-capacity-occupied={capacity > 0 ? !!occupied : undefined}
                >
                  {capacity > 0
                    ? t(
                        occupied
                          ? 'simulator.node.capacity.occupied'
                          : 'simulator.node.capacity.idle',
                        { unitNumber: card.unit, capacity },
                      )
                    : t('simulator.canvas.node.noActiveCapacity')}
                </span>
                {card.hidden > 0 && (
                  <span
                    aria-label={t('simulator.canvas.node.additionalCapacityUnitsAggregated', {
                      hidden: String(card.hidden),
                    })}
                  >
                    {plural(
                      'simulator.node.capacity.aggregated.one',
                      'simulator.node.capacity.aggregated.other',
                      card.hidden,
                    )}
                  </span>
                )}
              </>
            ) : (
              <div
                className="simulation-capacity-units"
                aria-label={t('simulator.canvas.node.capacityUnits', {
                  capacity: String(capacity),
                })}
              >
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
      </div>
      {(metric || resource) &&
        (config.type === 'work' || config.type === 'resource') &&
        (!card || card.unit === 1) && (
          <span className="simulation-node-queue" data-has-queue={traffic.queue > 0}>
            {metric && config.type === 'work'
              ? t('simulator.node.queue.summary', {
                  queueCount: metric.queue.current,
                  completedCount: metric.completed,
                })
              : t('simulator.node.resourceQueue', {
                  queueCount: resource?.queue.current ?? metric?.queue.current ?? 0,
                })}
          </span>
        )}
    </div>
  );
}
