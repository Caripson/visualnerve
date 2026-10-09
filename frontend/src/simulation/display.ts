import type { MessageId, Translate } from '../i18n';
import type { SimulationTraffic } from './traffic';

const simulationNodeTypeMessages: Record<string, MessageId> = {
  source: 'simulator.editor.nodeType.source',
  work: 'simulator.editor.nodeType.work',
  router: 'simulator.editor.nodeType.router',
  resource: 'simulator.editor.nodeType.resource',
  outcome: 'simulator.editor.nodeType.outcome',
};
export const simulationNodeTypeLabel = (t: Translate, value: string): string =>
  Object.hasOwn(simulationNodeTypeMessages, value) ? t(simulationNodeTypeMessages[value]) : value;

const particleShapeMessages: Record<string, MessageId> = {
  circle: 'simulator.editor.particleShape.circle',
  square: 'simulator.editor.particleShape.square',
  triangle: 'simulator.editor.particleShape.triangle',
};
export const particleShapeLabel = (t: Translate, value: string): string =>
  Object.hasOwn(particleShapeMessages, value) ? t(particleShapeMessages[value]) : value;

const routingModeMessages: Record<string, MessageId> = {
  'first-match': 'simulator.editor.routingMode.firstMatch',
  weighted: 'simulator.editor.routingMode.weighted',
  'least-queue': 'simulator.editor.routingMode.leastQueue',
  'available-capacity': 'simulator.editor.routingMode.availableCapacity',
};
export const routingModeLabel = (t: Translate, value: string): string =>
  Object.hasOwn(routingModeMessages, value) ? t(routingModeMessages[value]) : value;

const routingFieldMessages: Record<string, MessageId> = {
  particleTypeId: 'simulator.editor.conditionField.particleTypeId',
  complexity: 'simulator.editor.conditionField.complexity',
  priority: 'simulator.editor.conditionField.priority',
  revenue: 'simulator.editor.conditionField.revenue',
  attribute: 'simulator.editor.conditionField.attribute',
  queue: 'simulator.editor.conditionField.queue',
  availableCapacity: 'simulator.editor.conditionField.availableCapacity',
  utilization: 'simulator.editor.conditionField.utilization',
};
export const routingFieldLabel = (t: Translate, value: string): string =>
  Object.hasOwn(routingFieldMessages, value) ? t(routingFieldMessages[value]) : value;

const routingOperatorMessages: Record<string, MessageId> = {
  eq: 'simulator.editor.operator.eq',
  neq: 'simulator.editor.operator.neq',
  gt: 'simulator.editor.operator.gt',
  gte: 'simulator.editor.operator.gte',
  lt: 'simulator.editor.operator.lt',
  lte: 'simulator.editor.operator.lte',
};
export const routingOperatorLabel = (t: Translate, value: string): string =>
  Object.hasOwn(routingOperatorMessages, value) ? t(routingOperatorMessages[value]) : value;

const runStatusMessages: Record<string, MessageId> = {
  ready: 'simulator.run.status.ready',
  running: 'simulator.run.status.running',
  paused: 'simulator.run.status.paused',
  stopped: 'simulator.run.status.stopped',
  completed: 'simulator.run.status.completed',
  failed: 'simulator.run.status.failed',
  rejected: 'simulator.editor.outcome.rejected',
};
export const runStatusLabel = (t: Translate, value: string): string =>
  Object.hasOwn(runStatusMessages, value) ? t(runStatusMessages[value]) : value;

const modelSectionMessages: Record<string, MessageId> = {
  nodes: 'simulator.editor.section.nodes.desktop',
  processes: 'simulator.editor.section.processes.desktop',
  connections: 'simulator.editor.section.connections.desktop',
  particles: 'simulator.editor.section.particles.desktop',
  resources: 'simulator.editor.section.resources.desktop',
  improvements: 'simulator.editor.section.improvements.desktop',
  economics: 'simulator.editor.section.economics.desktop',
  'complete model': 'simulator.editor.section.completeModel.desktop',
};
const mobileModelSectionMessages: Record<string, MessageId> = {
  economics: 'simulator.editor.section.economics.mobile',
  nodes: 'simulator.editor.section.nodes.mobile',
  processes: 'simulator.editor.section.processes.mobile',
  connections: 'simulator.editor.section.connections.mobile',
  particles: 'simulator.editor.section.particles.mobile',
  resources: 'simulator.editor.section.resources.mobile',
  improvements: 'simulator.editor.section.improvements.mobile',
  'complete model': 'simulator.editor.section.completeModel.mobile',
};
export const modelSectionLabel = (t: Translate, value: string, mobile = false): string => {
  const messages = mobile ? mobileModelSectionMessages : modelSectionMessages;
  return Object.hasOwn(messages, value) ? t(messages[value]) : value;
};

const wizardStepMessages: Record<string, MessageId> = {
  Workload: 'simulator.wizard.workload',
  Process: 'simulator.wizard.process',
  Economics: 'simulator.editor.section.economics.mobile',
  Review: 'simulator.wizard.review',
};
export const wizardStepLabel = (t: Translate, value: string): string =>
  Object.hasOwn(wizardStepMessages, value) ? t(wizardStepMessages[value]) : value;

const trafficStatusMessages: Record<string, MessageId> = {
  Ready: 'simulator.traffic.ready',
  Failed: 'simulator.metrics.failed',
  'Resource blocked': 'simulator.traffic.resourceBlocked',
  'Scaling · congested': 'simulator.traffic.scalingCongested',
  Blocked: 'simulator.traffic.blocked',
  Congested: 'simulator.metrics.congested',
  Scaling: 'simulator.traffic.scaling',
  'Queued demand': 'simulator.traffic.queuedDemand',
  'Queue building': 'simulator.traffic.queueBuilding',
  'At capacity': 'simulator.traffic.atCapacity',
  Busy: 'simulator.canvas.resource.busy',
  Flowing: 'simulator.traffic.flowing',
  Clear: 'simulator.metrics.clear',
  'Bottleneck inside': 'simulator.hierarchy.traffic.bottleneckInside',
  'Pressure building': 'simulator.hierarchy.traffic.pressureBuilding',
};
export const trafficStatusLabel = (t: Translate, value: string): string =>
  Object.hasOwn(trafficStatusMessages, value) ? t(trafficStatusMessages[value]) : value;

const simulationDiagnosticMessages: Record<string, MessageId> = {
  'The model changed while setup was open. Close and reopen setup to use the current model.':
    'simulator.wizard.theModelChangedWhileSetupWasOpenCloseAndReopenSetupTo',
  'The process could not be created.': 'simulator.wizard.theProcessCouldNotBeCreated',
  'Fix the JSON error before applying.': 'simulator.editor.model.fixTheJsonErrorBeforeApplying',
  'The model changed while settings were open. Reopen settings to edit the current model.':
    'simulator.editor.model.theModelChangedWhileSettingsWereOpenReopenSettingsToEditThe',

  work: 'simulator.editor.nodeType.work',
  resource: 'simulator.editor.nodeType.resource',
  failed: 'simulator.run.status.failed',
  idle: 'simulator.canvas.node.idle',
  'Give the work item a name, such as Order or Customer.':
    'simulator.wizard.validation.giveTheWorkItemANameSuchAsOrderOrCustomer',
  'Name the main process.': 'simulator.wizard.validation.nameTheMainProcess',
  'Name the work step, such as Pack order.':
    'simulator.wizard.validation.nameTheWorkStepSuchAsPackOrder',
  'Use a three-letter currency code, such as SEK, EUR or USD.':
    'simulator.wizard.validation.useAThreeLetterCurrencyCodeSuchAsSekEurOrUsd',
  'Give the shared resource a name.': 'simulator.wizard.validation.giveTheSharedResourceAName',
  'Add between one and twelve subprocesses.':
    'simulator.wizard.validation.addBetweenOneAndTwelveSubprocesses',
  'the supported limit': 'simulator.wizard.validation.theSupportedLimit',
  'Waiting for shared resource capacity.':
    'simulator.metrics.bottleneck.waitingForSharedResourceCapacity',
  'Queue pressure and utilized processing capacity.':
    'simulator.metrics.bottleneck.queuePressureAndUtilizedProcessingCapacity',
  'Shared resource contention.': 'simulator.metrics.bottleneck.sharedResourceContention',
  'Different seeds.': 'simulator.results.warning.differentSeeds',
  'Different simulation durations.': 'simulator.results.warning.differentSimulationDurations',
  'Arrivals per hour': 'simulator.wizard.validation.arrivalsPerHour',
  'Batch size': 'simulator.wizard.validation.batchSize',
  'Simulation hours': 'simulator.wizard.validation.simulationHours',
  'Transfer seconds': 'simulator.wizard.validation.transferSeconds',
  'Patience minutes': 'simulator.wizard.validation.patienceMinutes',
  'Revenue per completed item': 'simulator.wizard.validation.revenuePerCompletedItem',
  'Shared resource capacity': 'simulator.wizard.validation.sharedResourceCapacity',
  'Shared resource cost per hour': 'simulator.wizard.validation.sharedResourceCostPerHour',
};
const stepFieldMessages: Record<string, MessageId> = {
  'processing minutes': 'simulator.wizard.validation.stepProcessing',
  capacity: 'simulator.wizard.validation.stepCapacity',
  'hourly cost': 'simulator.wizard.validation.stepHourlyCost',
};
function validationFieldLabel(t: Translate, field: string): string | undefined {
  if (Object.hasOwn(simulationDiagnosticMessages, field))
    return t(simulationDiagnosticMessages[field]);
  const step = /^Step ([1-9]\d*) (processing minutes|capacity|hourly cost)$/.exec(field);
  return step && Number(step[1]) <= 12
    ? t(stepFieldMessages[step[2]], { stepNumber: step[1] })
    : undefined;
}
/** Translate only recognized local display diagnostics; arbitrary engine/parser errors stay intact. */
export function simulationDiagnosticLabel(t: Translate, value: string): string {
  if (Object.hasOwn(simulationDiagnosticMessages, value))
    return t(simulationDiagnosticMessages[value]);
  const nameStep = /^Name subprocess ([1-9]\d*) and its work step\.$/.exec(value);
  if (nameStep && Number(nameStep[1]) <= 12)
    return t('simulator.wizard.validation.nameSubprocessAndItsWorkStep', {
      stepNumber: nameStep[1],
    });
  const range =
    /^(.+) must be (a whole number|a number) between (-?\d+(?:\.\d+)?) and (-?\d+(?:\.\d+)?|the supported limit)\.$/.exec(
      value,
    );
  if (!range) return value;
  const fieldLabel = validationFieldLabel(t, range[1]);
  return fieldLabel
    ? t(
        range[2] === 'a whole number'
          ? 'simulator.wizard.validation.mustBeAWholeNumberBetweenAnd'
          : 'simulator.wizard.validation.mustBeANumberBetweenAnd',
        {
          fieldLabel,
          minimum: range[3],
          maximum:
            range[4] === 'the supported limit'
              ? t('simulator.wizard.validation.theSupportedLimit')
              : range[4],
        },
      )
    : value;
}

/** Traffic remains canonical engine evidence; translation is only a display adapter. */
export function nodeTrafficReason(t: Translate, traffic: SimulationTraffic): string {
  if (traffic.reason === 'Run to observe traffic')
    return t('simulator.traffic.runToObserveTraffic');
  if (traffic.reason === 'Processing failed') return t('simulator.traffic.processingFailed');
  if (traffic.waitingResources.length)
    return t('simulator.traffic.waitingForQueued', {
      resourceNames: traffic.waitingResources.join(', '),
      queueCount: traffic.queue,
    });
  return t(
    traffic.queue ? 'simulator.traffic.queuedOccupied' : 'simulator.traffic.noQueueOccupied',
    {
      queueCount: traffic.queue,
      utilizationPercent: Math.round(traffic.utilization * 100),
    },
  );
}
export function processTrafficReason(
  t: Translate,
  traffic: SimulationTraffic,
  constraintName?: string,
): string {
  if (traffic.reason === 'Run to observe this process')
    return t('simulator.hierarchy.traffic.runToObserveThisProcess');
  if (constraintName)
    return t('simulator.hierarchy.traffic.constrainedStep', { stepName: constraintName });
  return t('simulator.hierarchy.traffic.observedChildProcessState');
}
