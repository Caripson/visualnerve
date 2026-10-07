import { StorageError } from '../model/errors';
import type { SimulationModel, SimulationProcess } from './types';

/** One semantic hierarchy index, shared by execution, canvas navigation and dependency operations. */
export class ProcessHierarchy {
  readonly processes: ReadonlyMap<string, SimulationProcess>;
  private readonly ancestors = new Map<string, readonly string[]>();
  private readonly nodeScopes = new Map<string, readonly string[]>();
  private readonly processNodes = new Map<string, string[]>();
  private readonly childIds = new Map<string, string[]>();

  constructor(model: Pick<SimulationModel, 'processes' | 'nodes'>) {
    if (model.processes !== undefined && !Array.isArray(model.processes))
      this.invalid('processes must be an array.');
    const processes = model.processes ?? [];
    if (!Array.isArray(processes) || processes.length > 50000)
      this.invalid('processes must be an array with at most 50,000 scopes.');
    const index = new Map<string, SimulationProcess>();
    for (const process of processes) {
      if (
        !process ||
        typeof process !== 'object' ||
        typeof process.id !== 'string' ||
        !process.id ||
        process.id.length > 300 ||
        index.has(process.id) ||
        typeof process.name !== 'string' ||
        !process.name.trim() ||
        (process.description !== undefined && typeof process.description !== 'string') ||
        (process.parentId !== undefined && typeof process.parentId !== 'string') ||
        Object.keys(process).some((key) => !['id', 'name', 'description', 'parentId'].includes(key))
      )
        this.invalid('process contains an invalid ID, name, description or unsupported property.');
      index.set(process.id, process);
      this.processNodes.set(process.id, []);
      this.childIds.set(process.id, []);
    }
    this.processes = index;
    for (const process of processes) {
      if (process.parentId !== undefined) {
        if (!index.has(process.parentId)) this.invalid('unknown parent process.');
        this.childIds.get(process.parentId)!.push(process.id);
      }
      const seen = new Set<string>();
      const ancestors: string[] = [];
      let current: SimulationProcess | undefined = process;
      while (current) {
        if (seen.has(current.id)) this.invalid('process hierarchy contains a cycle.');
        if (ancestors.length >= 128) this.invalid('process hierarchy exceeds 128 nested scopes.');
        seen.add(current.id);
        ancestors.push(current.id);
        current = current.parentId === undefined ? undefined : index.get(current.parentId);
      }
      this.ancestors.set(process.id, ancestors);
    }
    for (const node of model.nodes) {
      if (node.processId !== undefined && !index.has(node.processId))
        this.invalid(`node ${node.id} references an unknown process.`);
      const scopes = node.processId === undefined ? [] : this.ancestry(node.processId);
      this.nodeScopes.set(node.id, scopes);
      for (const id of scopes) this.processNodes.get(id)!.push(node.id);
    }
  }

  private invalid(message: string): never {
    throw new StorageError(422, `Simulation: ${message}`);
  }
  /** Closest scope first, then its ancestors. */
  ancestry(processId: string): readonly string[] {
    return this.ancestors.get(processId) ?? [];
  }
  forNode(nodeId: string): readonly string[] {
    return this.nodeScopes.get(nodeId) ?? [];
  }
  nodeIds(processId: string): readonly string[] {
    return this.processNodes.get(processId) ?? [];
  }
  children(processId?: string): readonly string[] {
    return processId === undefined
      ? [...this.processes.values()]
          .filter((process) => process.parentId === undefined)
          .map((process) => process.id)
      : (this.childIds.get(processId) ?? []);
  }
  descendants(processId: string): string[] {
    const result: string[] = [],
      pending = [...this.children(processId)].reverse();
    while (pending.length) {
      const id = pending.pop()!;
      result.push(id);
      pending.push(...[...this.children(id)].reverse());
    }
    return result;
  }
}
