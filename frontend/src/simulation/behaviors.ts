import {
  behaviorHandlerLocation,
  compileBehavior,
  createBehaviorBudget,
  runBehavior,
  validateBehaviorBindings,
  type BehaviorBindings,
  type BehaviorEvent,
  type BehaviorProgram,
} from '../behaviors/language';
import {
  behaviorDocumentLimits,
  getBehaviorLibrary,
  validateBehaviorLibrary,
} from '../behaviors/document';
import { StorageError } from '../model/errors';
import type { Graph } from '../model/types';
import { BoundedRing } from './ring';
import type { SimulationBehaviorSnapshot, SimulationBehaviorTrace, SimulationModel } from './types';

/** Queue snapshots and directed delivery both run after phase 4 dispatch, in engine sequence order. */
export const simulationBehaviorPhase = 5;
export const simulationBehaviorTraceLimit = 500;

type Definition = SimulationBehaviorSnapshot['definitions'][number];
type Binding = SimulationBehaviorSnapshot['bindings'][number];
type ActiveBehavior = { binding: Binding; program: BehaviorProgram; parameters: BehaviorBindings };
export type QueuedSimulationBehavior = {
  nodeId: string;
  event: Exclude<BehaviorEvent, { kind: 'connectionAdded' }>;
  depth: number;
  messageId?: number;
};

type ReserveDecision = { decision: string; particleId?: number };
type Trace = Pick<
  SimulationBehaviorTrace,
  'nodeId' | 'timeSeconds' | 'phase' | 'messageId' | 'eventSequence'
>;
type TraceDetail = Omit<SimulationBehaviorTrace, keyof Trace | 'sequence'>;

function invalid(definition: Definition, error: { line: number; column: number; message: string }) {
  return new StorageError(
    422,
    `Behavior ${definition.name} (${error.line}:${error.column}): ${error.message}`,
  );
}

function compile(definition: Definition) {
  const compiled = compileBehavior(definition.source);
  if (!compiled.ok) throw invalid(definition, compiled.error);
  return compiled.program;
}

/** Freeze active simulation definitions only, in the document's binding order. */
export function captureSimulationBehaviors(graph: Graph): SimulationBehaviorSnapshot | undefined {
  const library = getBehaviorLibrary(graph);
  if (!library.bindings.length) return;
  validateBehaviorLibrary(library);
  const definitions = new Map(library.definitions.map((definition) => [definition.id, definition]));
  const simulation = new Map<string, Definition>();
  const editor = new Set<string>();
  const bindings: Binding[] = [];
  for (const binding of library.bindings) {
    if (!binding.enabled || editor.has(binding.definitionId)) continue;
    const definition = definitions.get(binding.definitionId)!;
    if (!definition.source) continue; // An unactivated draft never runs.
    if (!simulation.has(definition.id)) {
      if (!compile(definition).contexts.includes('simulation')) {
        editor.add(definition.id);
        continue;
      }
      const { id, name, version, source } = definition;
      simulation.set(id, { id, name, version, source });
    }
    const { id, definitionId, nodeId, parameters } = binding;
    bindings.push({ id, definitionId, nodeId, parameters: { ...parameters } });
  }
  if (bindings.length) return { definitions: [...simulation.values()], bindings };
}

export function remapSimulationBehaviors(
  snapshot: SimulationBehaviorSnapshot,
  nodeIds: ReadonlyMap<string, string>,
): SimulationBehaviorSnapshot {
  const nodeParameters = new Map(
    snapshot.definitions.map((definition) => [
      definition.id,
      compile(definition).parameters.filter(({ type }) => type === 'node'),
    ]),
  );
  return {
    ...snapshot,
    bindings: snapshot.bindings.map((binding) => {
      const parameters = { ...binding.parameters };
      for (const { name, defaultValue } of nodeParameters.get(binding.definitionId) ?? []) {
        const original = parameters[name] ?? defaultValue;
        if (typeof original === 'string') parameters[name] = nodeIds.get(original) ?? original;
      }
      return { ...binding, nodeId: nodeIds.get(binding.nodeId) ?? binding.nodeId, parameters };
    }),
  };
}

/** The simulator owns ordering and actions. The shared language only proposes them. */
export class SimulationBehaviors {
  private readonly active = new Map<string, ActiveBehavior[]>();
  private readonly queueListeners = new Set<string>();
  private readonly budget = createBehaviorBudget();
  private readonly rows = new BoundedRing<SimulationBehaviorTrace>(simulationBehaviorTraceLimit);
  private sequence = 0;
  private messageId = 0;

  constructor(input: unknown, model: SimulationModel) {
    const snapshot = input as SimulationBehaviorSnapshot | undefined;
    if (
      !snapshot ||
      !Array.isArray(snapshot.bindings) ||
      snapshot.bindings.length > behaviorDocumentLimits.bindings ||
      !Array.isArray(snapshot.definitions) ||
      snapshot.definitions.length > behaviorDocumentLimits.definitions
    )
      throw new StorageError(422, 'Invalid captured simulation Behaviors.');
    validateBehaviorLibrary({
      definitions: snapshot.definitions,
      bindings: snapshot.bindings.map((binding) => ({ ...binding, enabled: true })),
    });
    const programs = new Map(
      snapshot.definitions.map((definition) => [
        definition.id,
        { definition, program: compile(definition) },
      ]),
    );
    const workNodes = new Set(
      model.nodes.filter(({ type }) => type === 'work').map(({ id }) => id),
    );
    const resources = new Set(model.resources.map(({ id }) => id));
    for (const binding of snapshot.bindings) {
      const { definition, program } = programs.get(binding.definitionId)!;
      if (!workNodes.has(binding.nodeId) || !program.contexts.includes('simulation'))
        throw invalid(definition, {
          line: 1,
          column: 1,
          message: 'Simulation Behaviors must be attached to a Work node.',
        });
      const parameters = validateBehaviorBindings(program, binding.parameters, {
        nodeExists: (id) => workNodes.has(id),
        resourceExists: (id) => resources.has(id),
      });
      if (!parameters.ok) throw invalid(definition, parameters.error);
      const prepared = { binding, program, parameters: parameters.bindings };
      const active = this.active.get(binding.nodeId);
      if (active) active.push(prepared);
      else this.active.set(binding.nodeId, [prepared]);
      if (
        behaviorHandlerLocation(program, {
          kind: 'queueChanged',
          nodeId: binding.nodeId,
          previous: 0,
          current: 1,
        })
      )
        this.queueListeners.add(binding.nodeId);
    }
  }
  listensToQueue(nodeId: string) {
    return this.queueListeners.has(nodeId);
  }
  trace() {
    return this.rows.values();
  }
  private record(where: Trace, detail: TraceDetail) {
    this.rows.push({ ...where, ...detail, sequence: ++this.sequence });
  }
  execute(
    queued: QueuedSimulationBehavior,
    timeSeconds: number,
    eventSequence: number,
    send: (message: QueuedSimulationBehavior) => void,
    reserve: (nodeId: string, resourceId: string) => ReserveDecision,
  ) {
    const { nodeId, messageId, event, depth } = queued;
    const where = { nodeId, messageId, timeSeconds, eventSequence, phase: simulationBehaviorPhase };
    const eventDetail: TraceDetail =
      event.kind === 'queueChanged'
        ? { kind: event.kind, previousLength: event.previous, length: event.current }
        : { kind: event.kind, sourceNodeId: event.source, message: event.name };
    let handled = false;
    for (const { binding, program, parameters } of this.active.get(nodeId) ?? []) {
      const location = behaviorHandlerLocation(program, event);
      if (!location) continue;
      handled = true;
      const identity = { bindingId: binding.id, definitionId: binding.definitionId };
      this.record(where, { ...eventDetail, ...identity, ...location });
      const result = runBehavior(program, parameters, event, {
        budget: this.budget,
        depth,
        timeSeconds,
      });
      if (!result.ok) {
        const { line, column, message } = result.error;
        this.record(where, { ...identity, kind: 'error', line, column, decision: message });
        continue;
      }
      for (const action of result.actions) {
        const source = { ...identity, line: action.line, column: action.column };
        if (action.kind === 'send') {
          const sentId = ++this.messageId;
          this.record(
            { ...where, messageId: sentId },
            { ...source, kind: 'send', targetNodeId: action.nodeId, message: action.message },
          );
          send({
            nodeId: action.nodeId,
            event: { kind: 'message', name: action.message, source: nodeId, target: action.nodeId },
            messageId: sentId,
            depth: depth + 1,
          });
        } else if (action.kind === 'openReserve') {
          const result = reserve(action.nodeId, action.resourceId);
          this.record(where, {
            ...source,
            kind: 'reserve',
            resourceId: action.resourceId,
            ...result,
          });
        }
      }
    }
    if (!handled && event.kind === 'message')
      this.record(where, { ...eventDetail, decision: 'no-active-handler' });
  }
}
