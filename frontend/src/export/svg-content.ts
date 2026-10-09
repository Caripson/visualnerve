import type { CanvasNode } from '../canvas/projection';
import type { SimulationSummarySnapshot } from '../simulation/summary-context';
import { getCodeObject, getProjectDirectory } from '../code/schema';
import { codeLanguages } from '../code/catalog';
import { getSqlTable } from '../sql/schema';
import { getSqlQuerySource, getSqlQueryResult } from '../sql/query-schema';
import { getCsvNode } from '../data/csv';
import { nodeKindLabel, statusLabel, sqlSourceKindLabel } from '../ui/editor-labels';
import type { MessageFormatter } from '../i18n/message-formatter';
import { logicalNodeId, getSimulationCapacityCard } from '../simulation/render-model';
import { simulationNodeTraffic, simulationTrafficColors } from '../simulation/traffic';
import { simulationProcessTraffic } from '../simulation/process-traffic';
import { simulationNodeTypeLabel, trafficStatusLabel } from '../simulation/display';
import { overviewNodeGroup } from '../overview/types';
import type { SvgTextRun } from './svg-native';

const kindIcons: Record<string, string> = {
  generic: 'box',
  process: 'square',
  decision: 'diamond',
  start: 'play',
  end: 'circle',
  milestone: 'flag',
  timeline: 'calendar-days',
  person: 'user',
  team: 'users',
  system: 'server',
  external: 'globe',
  input: 'arrow-down-to-line',
  output: 'arrow-up-from-line',
  document: 'file-text',
  database: 'database',
  note: 'sticky-note',
  group: 'layers',
};
const areaIcons: Record<string, string> = {
  work: 'briefcase-business',
  ideas: 'lightbulb',
  people: 'users',
  learning: 'graduation-cap',
  technology: 'cpu',
  design: 'palette',
  finance: 'banknote',
  health: 'heart-pulse',
  travel: 'compass',
  home: 'house',
  calendar: 'calendar-days',
  goals: 'target',
  nature: 'leaf',
  music: 'music',
  launch: 'rocket',
  research: 'flask-conical',
};
export function svgNodeIcon(node: CanvasNode) {
  if (node.type === 'simulation-resource-pool') return 'users';
  if (node.type === 'simulation-process' || node.type === 'overview-group') return 'layers';
  const metadata = node.data.node.metadata.visualNerve as { icon?: string } | undefined;
  const custom = metadata?.icon && areaIcons[metadata.icon];
  return (
    custom ||
    (getProjectDirectory(node.data.node)
      ? 'folder'
      : node.data.mindmap?.depth === 0
        ? 'lightbulb'
        : kindIcons[node.data.node.nodeType])
  );
}
export class SvgNodeContent {
  private readonly nodes;
  private readonly resources;
  private readonly processes;
  constructor(
    private readonly summary: SimulationSummarySnapshot,
    private readonly formatter: MessageFormatter,
  ) {
    this.nodes = new Map(summary.model?.nodes.map((node) => [node.id, node]));
    this.resources = new Map(summary.model?.resources.map((resource) => [resource.id, resource]));
    this.processes = new Map(summary.model?.processes?.map((process) => [process.id, process]));
  }
  read(view: CanvasNode) {
    const { node, owners } = view.data,
      { t, number, plural } = this.formatter;
    const runs: SvgTextRun[] = [];
    const add = (text: string, mono = false, color?: string) =>
      runs.push({ text, size: 10, weight: 400, mono, color, gap: 3 });
    let kind = nodeKindLabel(t, node.nodeType);
    const group = overviewNodeGroup(view);
    if (group) {
      kind = t(
        group.reason === 'partition'
          ? 'overview.partition'
          : group.reason === 'area'
            ? 'overview.layoutArea'
            : 'overview.semanticGroup',
      );
      add(t('overview.objectCount', { count: number(group.nodeIds.length) }));
      for (const [status, count] of Object.entries(group.statusCounts))
        add(`${statusLabel(t, status === 'none' ? '' : status)} ${number(count)}`);
      if (group.internalEdgeCount)
        add(t('overview.internalRelations', { count: number(group.internalEdgeCount) }));
    } else {
      const config = this.nodes.get(logicalNodeId(node)),
        model = this.summary.model,
        state = this.summary.view?.state;
      const processId = node.metadata.simulationProcessId;
      if (typeof processId === 'string' && model) {
        kind = t('simulator.common.processGroup');
        const process = this.processes.get(processId),
          metric = state?.processes?.[processId],
          traffic = simulationProcessTraffic(processId, model, state);
        add(trafficStatusLabel(t, traffic.label), false, simulationTrafficColors[traffic.level]);
        if (metric) {
          add(
            t('simulator.hierarchy.queue.summary', {
              queueCount: metric.queue.current,
              inSystemCount: metric.inSystem,
            }),
          );
          add(
            t('simulator.hierarchy.utilization.summary', {
              utilizationPercent: (metric.currentUtilization * 100).toFixed(0),
              minutes: (metric.queue.wait.average / 60).toFixed(1),
            }),
          );
          add(
            t('simulator.hierarchy.cycleCost.summary', {
              minutes: (metric.cycleTime.average / 60).toFixed(1),
              cost: metric.cost.toFixed(2),
              currency: model.currency,
            }),
          );
        } else if (process?.description) add(process.description);
      } else if (config && model) {
        const metric = state?.nodes[config.id],
          resource = config.type === 'resource' ? state?.resources[config.resourceId] : undefined;
        const traffic = simulationNodeTraffic(config, state, model);
        kind = simulationNodeTypeLabel(t, config.type);
        add(
          `${traffic.level === 'congested' ? '!' : traffic.level === 'busy' ? '◷' : traffic.level === 'inactive' ? '·' : '✓'} ${trafficStatusLabel(t, traffic.label)}`,
          false,
          simulationTrafficColors[traffic.level],
        );
        const requirements =
          config.type === 'work'
            ? (config.work.resourceRequirements ?? []).map(
                (req) => this.resources.get(req.resourceId)?.name ?? req.resourceId,
              )
            : config.type === 'resource'
              ? [this.resources.get(config.resourceId)?.name ?? config.resourceId]
              : [];
        if (requirements.length)
          add(t('simulator.node.resources.summary', { resourceNames: requirements.join(', ') }));
        if (config.type === 'source')
          add(
            metric
              ? t('simulator.canvas.node.created', { started: String(metric.started) })
              : t('simulator.canvas.node.arrivalsHour', {
                  arrivalsPerHour: String((config.source.ratePerHour ?? 0).toFixed(2)),
                }),
          );
        if (config.type === 'outcome' && metric)
          add(
            t('simulator.node.outcome.revenue', {
              revenue: metric.realizedRevenue.toFixed(2),
              currency: model.currency,
            }),
          );
        if (config.type === 'fork')
          add(t('simulator.parallel.branchCount', { count: config.fork.branchEdgeIds.length }));
        if (config.type === 'join')
          add(
            t('simulator.parallel.waitingSummary', {
              groups: metric?.join?.waitingGroups ?? 0,
              arrived: metric?.join?.arrivedBranches ?? 0,
              expected: metric?.join?.expectedBranches ?? 0,
            }),
          );
        const card = getSimulationCapacityCard(node),
          capacity =
            resource?.capacity ??
            metric?.capacity ??
            card?.total ??
            (config.type === 'work'
              ? config.work.capacity
              : config.type === 'resource'
                ? this.resources.get(config.resourceId)?.capacity
                : undefined);
        if ((config.type === 'work' || config.type === 'resource') && capacity !== undefined) {
          add(
            t('simulator.node.capacity.summary', {
              capacity,
              utilizationPercent: (
                (resource?.currentUtilization ?? metric?.currentUtilization ?? 0) * 100
              ).toFixed(0),
            }),
          );
          if (card)
            add(
              t(
                (resource?.busy ?? metric?.busy ?? 0) > card.unit - 1
                  ? 'simulator.node.capacity.occupied'
                  : 'simulator.node.capacity.idle',
                { unitNumber: card.unit, capacity },
              ),
            );
          if (card?.hidden)
            add(
              plural(
                'simulator.node.capacity.aggregated.one',
                'simulator.node.capacity.aggregated.other',
                card.hidden,
              ),
            );
          if ((metric || resource) && (!card || card.unit === 1))
            add(
              config.type === 'work' && metric
                ? t('simulator.node.queue.summary', {
                    queueCount: metric.queue.current,
                    completedCount: metric.completed,
                  })
                : t('simulator.node.resourceQueue', {
                    queueCount: resource?.queue.current ?? metric?.queue.current ?? 0,
                  }),
            );
        }
      }
      const csv = getCsvNode(node);
      if (csv) {
        const hidden = new Set(csv.hiddenMetricIds ?? []);
        for (const measure of csv.measures)
          if (!hidden.has(measure.id))
            add(
              `${measure.label}  ${measure.value === null ? '—' : number(measure.value, { maximumFractionDigits: 6 })}`,
            );
        if (csv.hiddenChildren)
          add(t('data.metricSummary.moreGroups', { count: number(csv.hiddenChildren) }));
      }
      const table = getSqlTable(node);
      if (table) {
        if (table.external) add(t('editor.sql.table.externalTableDefinitionMissing'));
        else
          for (const column of table.columns)
            add(
              `${column.name}  ${column.dataType}  ${[column.primaryKey ? 'PK' : '', column.foreignKey ? 'FK' : '', column.unique ? 'UQ' : '', column.nullable ? '?' : 'NN'].filter(Boolean).join(' ')}`,
              true,
            );
      }
      const source = getSqlQuerySource(node),
        query = getSqlQueryResult(node);
      if (source) {
        add(`${sqlSourceKindLabel(t, source.kind)} ${source.alias}`);
        add(source.qualifiedName.join('.') || source.queryScope || source.scope, true);
        for (const column of source.columns) add(column, true);
      }
      if (query) {
        add(`SELECT${query.distinct ? ' DISTINCT' : ''}`);
        for (const column of query.columns) add(`${column.name}  ${column.expression}`, true);
        for (const [key, value] of Object.entries(query.clauses))
          if (value) add(`${key.toUpperCase()} ${value}`, true);
      }
      const directory = getProjectDirectory(node),
        object = getCodeObject(node);
      if (directory) {
        kind = t('editor.nodes.directory.label');
        add(t('data.codeSummary.folderCount', { count: directory.fileCount }));
        add(directory.path === '.' ? t('data.code.projectRoot') : directory.path, true);
        add(
          directory.languages
            .map((id) => codeLanguages.find((language) => language.id === id)?.name ?? id)
            .join(', '),
        );
      } else if (object) {
        add(
          `${codeLanguages.find((language) => language.id === object.language)?.name ?? object.language} · ${object.kind}${object.external ? t('data.codeSummary.unresolvedSuffix') : ''}`,
        );
        if (object.kind !== 'file')
          add(`${t('data.codeSummary.symbolLabel')} ${object.name}`, true);
        add(
          `${object.path}${object.line ? ':' + object.line : ''}${object.endLine && object.endLine !== object.line ? '–' + object.endLine : ''}`,
          true,
        );
        for (const line of object.summary ?? []) add(line, true);
        if (object.summary?.length)
          add(t('data.codeSummary.declarationCount', { count: object.summary.length }));
      }
    }
    if (owners.length) add(owners.map((owner) => owner.name).join(', '));
    if (node.startDate)
      add(`${node.startDate.slice(5)}${node.endDate ? ' → ' + node.endDate.slice(5) : ''}`);
    return {
      kind,
      runs,
      status: node.status ? statusLabel(t, node.status) : undefined,
      icon: svgNodeIcon(view),
    };
  }
}
