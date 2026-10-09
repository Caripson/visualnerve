import type { Particle } from './engine-state';
import { Distribution } from './statistics';
import type {
  JoinMetrics,
  ParallelGroupSnapshot,
  ParallelState,
  QueueMetrics,
  SimulationModel,
  SimulationNode,
} from './types';

export interface ForkGroup {
  id: number;
  rootId: number;
  parent: Particle;
  forkNodeId: string;
  joinNodeId: string;
  createdAt: number;
  expectedRevenue: number;
  branches: Map<string, Particle>;
  arrived: Map<string, number>;
}
interface JoinCounter {
  waitingGroups: number;
  arrivedBranches: number;
  expectedBranches: number;
  completedGroups: number;
  cancelledGroups: number;
  maximum: number;
  area: number;
  last: number;
  wait: Distribution;
}

/** Bounded live correlation, distinct from business population and presentation sampling. */
export class ParallelExecution {
  private sequence = 0;
  private groups = new Map<number, ForkGroup>();
  private roots = new Map<number, Set<number>>();
  private joins = new Map<string, JoinCounter>();
  private createdBranches = 0;
  private joinedBranches = 0;
  private cancelledBranches = 0;
  private activeBranches = 0;
  constructor(model: SimulationModel) {
    for (const node of model.nodes)
      if (node.type === 'join')
        this.joins.set(node.id, {
          waitingGroups: 0,
          arrivedBranches: 0,
          expectedBranches: 0,
          completedGroups: 0,
          cancelledGroups: 0,
          maximum: 0,
          area: 0,
          last: 0,
          wait: new Distribution(),
        });
  }
  create(
    parent: Particle,
    node: Extract<SimulationNode, { type: 'fork' }>,
    clock: number,
  ): ForkGroup {
    const rootId = parent.rootParticleId ?? parent.id;
    const group: ForkGroup = {
      id: ++this.sequence,
      rootId,
      parent,
      forkNodeId: node.id,
      joinNodeId: node.fork.joinNodeId,
      createdAt: clock,
      expectedRevenue: parent.expectedRevenue,
      branches: new Map(),
      arrived: new Map(),
    };
    this.groups.set(group.id, group);
    const groups = this.roots.get(rootId) ?? new Set<number>();
    groups.add(group.id);
    this.roots.set(rootId, groups);
    return group;
  }
  addBranch(group: ForkGroup, edgeId: string, child: Particle) {
    group.branches.set(edgeId, child);
    this.createdBranches++;
    this.activeBranches++;
  }
  group(child: Particle): ForkGroup | undefined {
    return child.forkGroupId === undefined ? undefined : this.groups.get(child.forkGroupId);
  }
  forRoot(rootId: number) {
    return [...(this.roots.get(rootId) ?? [])]
      .map((id) => this.groups.get(id)!)
      .sort((a, b) => b.id - a.id);
  }
  arrive(child: Particle, joinNodeId: string, clock: number): ForkGroup | undefined {
    const group = this.group(child);
    if (
      !group ||
      group.joinNodeId !== joinNodeId ||
      !child.branchEdgeId ||
      group.branches.get(child.branchEdgeId) !== child ||
      group.arrived.has(child.branchEdgeId)
    )
      return;
    const counter = this.joins.get(joinNodeId)!;
    this.touch(counter, clock);
    if (!group.arrived.size) {
      counter.waitingGroups++;
      counter.expectedBranches += group.branches.size;
    }
    group.arrived.set(child.branchEdgeId, clock);
    counter.arrivedBranches++;
    counter.maximum = Math.max(counter.maximum, counter.arrivedBranches);
    return group;
  }
  close(group: ForkGroup, cancelled: boolean, clock: number) {
    const counter = this.joins.get(group.joinNodeId)!;
    this.touch(counter, clock);
    if (group.arrived.size) {
      counter.waitingGroups--;
      counter.expectedBranches -= group.branches.size;
      counter.arrivedBranches -= group.arrived.size;
      for (const arrived of group.arrived.values()) counter.wait.add((clock - arrived) / 1000);
    }
    if (cancelled) {
      counter.cancelledGroups++;
      this.cancelledBranches += group.branches.size;
    } else {
      counter.completedGroups++;
      this.joinedBranches += group.branches.size;
    }
    this.activeBranches -= group.branches.size;
    this.groups.delete(group.id);
    const siblings = this.roots.get(group.rootId)!;
    siblings.delete(group.id);
    if (!siblings.size) this.roots.delete(group.rootId);
  }
  private touch(counter: JoinCounter, clock: number) {
    counter.area += counter.arrivedBranches * (clock - counter.last);
    counter.last = clock;
  }
  joinMetrics(id: string): JoinMetrics | undefined {
    const counter = this.joins.get(id);
    if (!counter) return;
    return {
      waitingGroups: counter.waitingGroups,
      arrivedBranches: counter.arrivedBranches,
      expectedBranches: counter.expectedBranches,
      completedGroups: counter.completedGroups,
      cancelledGroups: counter.cancelledGroups,
      wait: counter.wait.metrics(),
    };
  }
  queueMetrics(id: string, clock: number): QueueMetrics {
    const counter = this.joins.get(id)!;
    return {
      current: counter.arrivedBranches,
      average: clock
        ? (counter.area + counter.arrivedBranches * (clock - counter.last)) / clock
        : 0,
      maximum: counter.maximum,
      wait: counter.wait.metrics(),
    };
  }
  state(limit: number): ParallelState {
    const groups: ParallelGroupSnapshot[] = [];
    for (const group of this.groups.values()) {
      if (groups.length >= limit) break;
      groups.push({
        groupId: group.id,
        rootParticleId: group.rootId,
        parentParticleId: group.parent.id,
        forkNodeId: group.forkNodeId,
        joinNodeId: group.joinNodeId,
        branchParticleIds: [...group.branches.values()].map((child) => child.id),
        arrivedBranchEdgeIds: [...group.arrived.keys()],
        pendingBranchEdgeIds: [...group.branches.keys()].filter((id) => !group.arrived.has(id)),
        createdAtSeconds: group.createdAt / 1000,
      });
    }
    return {
      activeGroups: this.groups.size,
      activeBranches: this.activeBranches,
      waitingParents: this.groups.size,
      createdBranches: this.createdBranches,
      joinedBranches: this.joinedBranches,
      cancelledBranches: this.cancelledBranches,
      groups,
      droppedGroups: this.groups.size - groups.length,
    };
  }
}
