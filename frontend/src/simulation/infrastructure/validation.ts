import { StorageError } from '../../model/errors';
import { ParallelTopology } from '../parallel-topology';
import { infrastructureResourceIds } from './runtime';
import type { SimulationModel, Resource } from '../types';
import { infrastructureLimits as limits } from './types';

function invalid(path: string, message: string): never {
  throw Object.assign(new StorageError(422, `Infrastructure: ${message}`), {
    code: 'SIMULATION_INFRASTRUCTURE_INVALID',
    issues: [{ path, message }],
  });
}
function record(
  value: unknown,
  fields: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(path, 'Expected an object.');
  for (const key of Object.keys(value))
    if (!fields.includes(key)) invalid(`${path}.${key}`, 'Unsupported property.');
}
function quantity(
  value: unknown,
  path: string,
  min: number = 0,
  max: number = limits.amount,
  integer = false,
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid(path, `Expected a finite ${integer ? 'integer ' : ''}quantity in ${min}..${max}.`);
}
export function validateInfrastructureModel(model: SimulationModel) {
  const opted = model.infrastructure !== undefined;
  if (!opted) {
    if (model.schemaVersion !== 1)
      invalid('schemaVersion', 'Model version 2 requires an infrastructure profile.');
    if (
      model.resources.some((r) => r.infrastructure !== undefined) ||
      model.nodes.some((n) => n.type === 'work' && n.work.infrastructure !== undefined) ||
      model.edges.some((e) => e.infrastructure !== undefined)
    )
      invalid(
        'infrastructure',
        'Infrastructure fields require model version 2 and an explicit profile.',
      );
    return;
  }
  record(model.infrastructure, ['schemaVersion'], 'infrastructure');
  if (model.infrastructure.schemaVersion !== 1 || model.schemaVersion !== 2)
    invalid('infrastructure.schemaVersion', 'Infrastructure version 1 requires model version 2.');
  const resources = new Map(model.resources.map((r) => [r.id, r]));
  const resource = (id: unknown, kind: string, path: string): Resource => {
    const found = typeof id === 'string' ? resources.get(id) : undefined;
    if (!found || found.infrastructure?.kind !== kind)
      invalid(path, `Expected a ${kind} resource reference.`);
    return found;
  };
  for (const r of model.resources) {
    if (r.infrastructure === undefined) continue;
    const p = `resources.${r.id}.infrastructure`,
      d = r.infrastructure;
    record(
      d,
      d.kind === 'energy'
        ? ['kind', 'unit', 'generation', 'gridImportLimitKW', 'pricePerKWh', 'battery']
        : ['kind', 'unit'],
      p,
    );
    const expected = { cpu: 'cores', memory: 'MiB', bandwidth: 'Mbps', energy: 'kW' }[d.kind];
    if (!expected || d.unit !== expected || r.unit !== expected)
      invalid(`${p}.unit`, 'Resource and descriptor units must match the canonical dimension.');
    quantity(r.capacity, `resources.${r.id}.capacity`, 0, limits.capacity);
    if (r.minCapacity !== undefined)
      quantity(r.minCapacity, `resources.${r.id}.minCapacity`, 0, limits.capacity);
    if (r.maxCapacity !== undefined)
      quantity(r.maxCapacity, `resources.${r.id}.maxCapacity`, 0, limits.capacity);
    if (r.scaling) {
      quantity(r.scaling.maxCapacity, `resources.${r.id}.scaling.maxCapacity`, 0, limits.capacity);
      if (r.scaling.minCapacity !== undefined)
        quantity(
          r.scaling.minCapacity,
          `resources.${r.id}.scaling.minCapacity`,
          0,
          limits.capacity,
        );
      if (r.scaling.increment !== undefined)
        quantity(
          r.scaling.increment,
          `resources.${r.id}.scaling.increment`,
          limits.positiveMinimum,
          limits.capacity,
        );
    }
    let hourly = r.costPerHour ?? 0;
    for (const f of model.improvements)
      if (f.enabled && f.resourceId === r.id) hourly *= f.costMultiplier ?? 1;
    quantity(hourly, `resources.${r.id}.effectiveCostPerHour`, 0, limits.amount);
    if ((d.kind === 'bandwidth' || d.kind === 'energy') && r.scaling !== undefined)
      invalid(`${p}.scaling`, 'Rate-resource scaling is unsupported in version 1.');
    if (d.kind !== 'energy') continue;
    if (r.schedule !== undefined)
      invalid(`${p}.schedule`, 'Use explicit generation windows for energy supply.');
    if (d.gridImportLimitKW !== undefined)
      quantity(d.gridImportLimitKW, `${p}.gridImportLimitKW`, 0, limits.capacity);
    if (d.pricePerKWh !== undefined) quantity(d.pricePerKWh, `${p}.pricePerKWh`);
    if (!Array.isArray(d.generation) || d.generation.length > limits.generationWindows)
      invalid(`${p}.generation`, 'Expected a bounded array of generation windows.');
    let end = 0;
    for (let i = 0; i < d.generation.length; i++) {
      const w = d.generation[i],
        wp = `${p}.generation.${i}`;
      record(w, ['startSeconds', 'endSeconds', 'powerKW'], wp);
      quantity(w.startSeconds, `${wp}.startSeconds`, end, limits.durationSeconds);
      quantity(w.endSeconds, `${wp}.endSeconds`, w.startSeconds, limits.durationSeconds);
      if (w.endSeconds === w.startSeconds)
        invalid(wp, 'Generation windows must have positive duration.');
      quantity(w.powerKW, `${wp}.powerKW`, 0, limits.capacity);
      end = w.endSeconds;
    }
    if (d.battery !== undefined) {
      const b = d.battery,
        bp = `${p}.battery`;
      record(
        b,
        [
          'capacityKWh',
          'initialKWh',
          'maxChargeKW',
          'maxDischargeKW',
          'chargeEfficiency',
          'dischargeEfficiency',
        ],
        bp,
      );
      quantity(b.capacityKWh, `${bp}.capacityKWh`, limits.positiveMinimum);
      quantity(b.initialKWh, `${bp}.initialKWh`, 0, b.capacityKWh);
      quantity(b.maxChargeKW, `${bp}.maxChargeKW`, 0, limits.capacity);
      quantity(b.maxDischargeKW, `${bp}.maxDischargeKW`, 0, limits.capacity);
      quantity(b.chargeEfficiency, `${bp}.chargeEfficiency`, limits.positiveMinimum, 1);
      quantity(b.dischargeEfficiency, `${bp}.dischargeEfficiency`, limits.positiveMinimum, 1);
    }
  }
  const regions = [...new ParallelTopology(model).regions.values()];
  for (const node of model.nodes) {
    if (node.type !== 'work') continue;
    for (const q of node.work.resourceRequirements ?? [])
      if (resources.get(q.resourceId)?.infrastructure)
        invalid(
          `nodes.${node.id}.work.resourceRequirements`,
          'Typed infrastructure pools require their dedicated activity or lease fields.',
        );
    const d = node.work.infrastructure,
      p = `nodes.${node.id}.work.infrastructure`;
    if (d === undefined) continue;
    record(d, ['cpu', 'memory', 'releaseMemoryResourceIds', 'energy'], p);
    if (d.cpu && d.energy) invalid(p, 'CPU and energy activities are mutually exclusive.');
    const used = new Set<string>();
    const bind = (id: unknown, kind: string, path: string) => {
      const r = resource(id, kind, path);
      if (used.has(r.id) || node.work.resourceRequirements?.some((q) => q.resourceId === r.id))
        invalid(path, 'Resource demand is duplicated.');
      used.add(r.id);
      return r;
    };
    if (d.cpu !== undefined) {
      record(d.cpu, ['resourceId', 'coreSeconds', 'cores'], `${p}.cpu`);
      bind(d.cpu.resourceId, 'cpu', `${p}.cpu.resourceId`);
      quantity(d.cpu.coreSeconds, `${p}.cpu.coreSeconds`, limits.positiveMinimum);
      quantity(d.cpu.cores, `${p}.cpu.cores`, limits.positiveMinimum, limits.capacity);
      const factor =
        model.particleTypes.reduce((max, t) => Math.max(max, t.complexity.max), 1) *
        (node.work.complexityMultiplier ?? 1);
      quantity(
        (node.work.processingSeconds + d.cpu.coreSeconds / d.cpu.cores) * factor,
        `${p}.cpu.nominalDurationSeconds`,
        0,
        limits.durationSeconds,
      );
    }
    if (d.energy !== undefined) {
      record(d.energy, ['resourceId', 'energyKWh', 'powerKW'], `${p}.energy`);
      bind(d.energy.resourceId, 'energy', `${p}.energy.resourceId`);
      quantity(d.energy.energyKWh, `${p}.energy.energyKWh`, limits.positiveMinimum);
      quantity(d.energy.powerKW, `${p}.energy.powerKW`, limits.positiveMinimum, limits.capacity);
      if (node.work.processingSeconds !== 0)
        invalid(
          `${p}.energy`,
          'Energy work uses delivered energy and requires zero fixed processing time.',
        );
      const factor =
        model.particleTypes.reduce((max, t) => Math.max(max, t.complexity.max), 1) *
        (node.work.complexityMultiplier ?? 1);
      quantity(d.energy.energyKWh * factor, `${p}.energy.effectiveEnergyKWh`, 0, limits.amount);
      quantity(
        (d.energy.energyKWh * factor * 3600) / d.energy.powerKW,
        `${p}.energy.nominalDurationSeconds`,
        0,
        limits.durationSeconds,
      );
    }
    if (d.memory !== undefined) {
      if (!Array.isArray(d.memory) || d.memory.length > limits.memoryRequirements)
        invalid(`${p}.memory`, 'Expected a bounded memory-demand array.');
      const scopes = new Set<string>();
      for (const m of d.memory) {
        record(m, ['resourceId', 'amountMiB', 'scope'], `${p}.memory`);
        const r = resource(m.resourceId, 'memory', `${p}.memory.resourceId`);
        quantity(m.amountMiB, `${p}.memory.amountMiB`, limits.positiveMinimum, limits.capacity);
        if (m.scope !== 'stage' && m.scope !== 'case')
          invalid(`${p}.memory.scope`, 'Memory scope must be stage or case.');
        const key = `${r.id}:${m.scope}`;
        if (scopes.has(key)) invalid(`${p}.memory`, 'Duplicate memory pool and scope.');
        scopes.add(key);
        used.add(r.id);
      }
    }
    if (d.releaseMemoryResourceIds !== undefined) {
      const ids = d.releaseMemoryResourceIds;
      if (
        !Array.isArray(ids) ||
        ids.length > limits.memoryRequirements ||
        new Set(ids).size !== ids.length
      )
        invalid(`${p}.releaseMemoryResourceIds`, 'Expected unique bounded memory references.');
      for (const id of ids) {
        resource(id, 'memory', `${p}.releaseMemoryResourceIds`);
        if (used.has(id))
          invalid(
            `${p}.releaseMemoryResourceIds`,
            'Cannot acquire and explicitly release the same memory pool in one stage.',
          );
      }
      if (ids.length && regions.some((region) => region.has(node.id)))
        invalid(
          `${p}.releaseMemoryResourceIds`,
          'Case memory cannot be released inside a parallel region.',
        );
    }
  }
  for (const edge of model.edges) {
    if (edge.infrastructure === undefined) continue;
    const d = edge.infrastructure,
      p = `edges.${edge.id}.infrastructure`;
    record(d, ['transfer'], p);
    record(d.transfer, ['resourceId', 'bytes'], `${p}.transfer`);
    resource(d.transfer.resourceId, 'bandwidth', `${p}.transfer.resourceId`);
    quantity(d.transfer.bytes, `${p}.transfer.bytes`, 0, limits.amount, true);
  }
  for (const f of model.improvements) {
    const target = f.resourceId ? resources.get(f.resourceId)?.infrastructure?.kind : undefined;
    const node = model.nodes.find((n) => n.id === f.nodeId);
    const energy =
      target === 'energy' || (node?.type === 'work' && node.work.infrastructure?.energy);
    const energyConsumer =
      !!f.resourceId &&
      model.nodes.some(
        (n) =>
          n.type === 'work' &&
          n.work.infrastructure?.energy &&
          infrastructureResourceIds(n.work).includes(f.resourceId!),
      );
    if (
      energyConsumer &&
      f.processingTimeMultiplier !== undefined &&
      f.processingTimeMultiplier !== 1
    )
      invalid(
        `improvements.${f.id}`,
        'A resource consumed by an energy activity cannot change its processing time; edit explicit energy/power.',
      );
    if (
      energy &&
      ((f.processingTimeMultiplier !== undefined && f.processingTimeMultiplier !== 1) ||
        (f.resourceUnitsMultiplier !== undefined && f.resourceUnitsMultiplier !== 1))
    )
      invalid(
        `improvements.${f.id}`,
        'Energy activities require explicit energy/power edits; time or reservation multipliers are unsupported.',
      );
    if (
      target === 'bandwidth' &&
      ((f.processingTimeMultiplier ?? 1) !== 1 ||
        (f.resourceUnitsMultiplier ?? 1) !== 1 ||
        (f.revenueMultiplier ?? 1) !== 1 ||
        (f.failureProbability ?? 0) !== 0 ||
        f.failureNodeId !== undefined)
    )
      invalid(
        `improvements.${f.id}`,
        'Link improvements support capacity and economic effects only.',
      );
  }
  for (const n of model.nodes) {
    if (n.type !== 'work' || !n.work.infrastructure) continue;
    const d = n.work.infrastructure,
      ids = new Set(infrastructureResourceIds(n.work));
    const features = model.improvements.filter(
      (f) => f.enabled && (f.nodeId === n.id || (!!f.resourceId && ids.has(f.resourceId))),
    );
    const multiplier = (id: string) =>
      features.reduce(
        (m, f) =>
          m * (f.nodeId === n.id || f.resourceId === id ? (f.resourceUnitsMultiplier ?? 1) : 1),
        1,
      );
    if (d.cpu) {
      const cores = d.cpu.cores * multiplier(d.cpu.resourceId);
      quantity(
        cores,
        `nodes.${n.id}.work.infrastructure.cpu.effectiveCores`,
        limits.positiveMinimum,
        limits.capacity,
      );
      const time = features.reduce((m, f) => m * (f.processingTimeMultiplier ?? 1), 1);
      const factor =
        model.particleTypes.reduce((max, t) => Math.max(max, t.complexity.max), 1) *
        (n.work.complexityMultiplier ?? 1);
      quantity(
        (n.work.processingSeconds + d.cpu.coreSeconds / cores) * factor * time,
        `nodes.${n.id}.work.infrastructure.cpu.effectiveDurationSeconds`,
        0,
        limits.durationSeconds,
      );
    }
    for (const m of d.memory ?? [])
      quantity(
        m.amountMiB * multiplier(m.resourceId),
        `nodes.${n.id}.work.infrastructure.memory.effectiveMiB`,
        limits.positiveMinimum,
        limits.capacity,
      );
  }
}
