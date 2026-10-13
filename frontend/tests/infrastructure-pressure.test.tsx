import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assertArchivedResult, assertArchivedState } from '../src/simulation/archive-validation';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { createBasicModel } from '../src/simulation/examples';
import { InfrastructureMetricsPanel } from '../src/simulation/infrastructure/InfrastructureMetricsPanel';
import { infrastructureReading } from '../src/simulation/infrastructure/metrics';
import { simulationNodeTraffic } from '../src/simulation/traffic';
import type { SimulationModel } from '../src/simulation/types';

type Availability = 'zero-capacity' | 'scheduled-off';
function linkModel(availability: Availability, startSeconds = 0, bytes = 125000): SimulationModel {
  const model = createBasicModel({ particles: 1 });
  model.schemaVersion = 2;
  model.infrastructure = { schemaVersion: 1 };
  model.nodes = model.nodes.filter((node) => node.type !== 'work');
  const source = model.nodes.find((node) => node.type === 'source')!;
  if (source.type !== 'source') throw Error('Source');
  source.source.startSeconds = startSeconds;
  source.processId = 'network';
  model.processes = [
    { id: 'network', name: 'Network' },
    { id: 'quiet', name: 'No traffic' },
  ];
  model.nodes.push({ id: 'link-view', name: 'WAN', type: 'resource', resourceId: 'link' });
  model.resources = [
    {
      id: 'link',
      name: 'WAN',
      capacity: availability === 'zero-capacity' ? 0 : 1,
      unit: 'Mbps',
      infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
      ...(availability === 'scheduled-off'
        ? { schedule: [{ startSeconds: 2, endSeconds: 4 }] }
        : {}),
    },
  ];
  model.edges = [
    {
      id: 'wire',
      sourceNodeId: source.id,
      targetNodeId: 'outcome',
      travelSeconds: 1,
      infrastructure: { transfer: { resourceId: 'link', bytes } },
    },
  ];
  model.defaults.durationSeconds = 6;
  return model;
}

describe('observed bandwidth availability pressure', () => {
  it.each<Availability>(['zero-capacity', 'scheduled-off'])(
    'reports an active %s serialization in actual state, replay, archive and UI',
    (availability) => {
      const model = linkModel(availability);
      const engine = new SimulationEngine(model);
      engine.advance(0.5);
      const state = engine.state();
      expect(state.infrastructure!.bandwidth.link).toMatchObject({
        activeTransfers: 1,
        usedMbps: 0,
        transferredBytes: 0,
      });
      expect(state.resources.link.queue.current).toBe(0);
      expect(state.resources.link.blockedNodeIds).toEqual([]);
      expect(state.metrics.currentBottleneck).toBe('link');
      expect(state.bottlenecks).toEqual([
        expect.objectContaining({
          id: 'link',
          score: 1,
          methodology: 'bandwidth-unavailable',
          averageQueue: 0,
          reason: 'Active transfers have no currently available bandwidth.',
        }),
      ]);
      expect(state.nodes['link-view'].status).toBe('blocked');
      expect(state.processes!.network.currentBottleneck).toBe('link');
      expect(state.processes!.quiet.bottlenecks).toEqual([]);
      expect(infrastructureReading(state, 'link')).toMatchObject({
        pressure: 'congested',
        usage: 0,
        reason: '1 active transfers · no currently available bandwidth',
      });
      const pool = model.nodes.find((node) => node.id === 'link-view')!;
      expect(simulationNodeTraffic(pool, state, model)).toMatchObject({
        level: 'congested',
        label: 'Constrained',
        queue: 0,
      });
      render(<InfrastructureMetricsPanel state={state} currency="SEK" />);
      expect(
        screen.getByText('Constrained · 1 active transfers · no currently available bandwidth'),
      ).toHaveAttribute('data-infrastructure-pressure', 'congested');

      const replay = new SimulationEngine(model);
      replay.advance(0.25);
      replay.advance(0.5);
      expect(replay.state()).toEqual(state);
      expect(() => assertArchivedState(JSON.parse(JSON.stringify(state)))).not.toThrow();
      const result = runSimulation(model, { durationSeconds: 0.5 });
      expect(result.bottlenecks[0].methodology).toBe('bandwidth-unavailable');
      expect(() => assertArchivedResult(JSON.parse(JSON.stringify(result)))).not.toThrow();
    },
  );

  it.each<Availability>(['zero-capacity', 'scheduled-off'])(
    'keeps a %s pool clear without an active serialization',
    (availability) => {
      const engine = new SimulationEngine(linkModel(availability, 1));
      engine.advance(0.5);
      const state = engine.state();
      expect(state.infrastructure!.bandwidth.link.activeTransfers).toBe(0);
      expect(state.bottlenecks).toEqual([]);
      expect(state.metrics.currentBottleneck).toBeNull();
      expect(state.nodes['link-view'].status).toBe('idle');
      expect(infrastructureReading(state, 'link')!.pressure).toBe('clear');
    },
  );

  it('clears unavailability when a window opens and clears serialization pressure during propagation', () => {
    const model = linkModel('scheduled-off');
    const engine = new SimulationEngine(model);
    engine.advance(0.5);
    expect(engine.state().bottlenecks[0].methodology).toBe('bandwidth-unavailable');
    engine.advance(2.5);
    const serializing = engine.state();
    expect(serializing.infrastructure!.bandwidth.link).toMatchObject({
      activeTransfers: 1,
      usedMbps: 1,
      transferredBytes: 62500,
    });
    expect(serializing.bottlenecks).toEqual([]);
    expect(infrastructureReading(serializing, 'link')!.pressure).toBe('busy');
    engine.advance(3.5);
    const propagating = engine.state();
    expect(propagating.metrics.completed).toBe(0);
    expect(propagating.particles[0]).toMatchObject({
      status: 'transit',
      departedAtSeconds: 3,
      arrivesAtSeconds: 4,
    });
    expect(propagating.particles[0].transferProgress).toBeCloseTo(0.95, 12);
    expect(propagating.infrastructure!.bandwidth.link).toMatchObject({
      activeTransfers: 0,
      usedMbps: 0,
      transferredBytes: 125000,
    });
    expect(propagating.bottlenecks).toEqual([]);
    expect(infrastructureReading(propagating, 'link')!.pressure).toBe('clear');
    engine.advance(4);
    expect(engine.state().metrics.completed).toBe(1);
  });

  it('does not report unavailability for a zero-byte propagation-only route', () => {
    const engine = new SimulationEngine(linkModel('zero-capacity', 0, 0));
    engine.advance(0.5);
    const state = engine.state();
    expect(state.particles[0].status).toBe('transit');
    expect(state.infrastructure!.bandwidth.link.activeTransfers).toBe(0);
    expect(state.bottlenecks).toEqual([]);
    expect(infrastructureReading(state, 'link')!.pressure).toBe('clear');
  });

  it('preserves explicit no-progress failure and exact partial byte totals', () => {
    const result = runSimulation(linkModel('zero-capacity'), { untilComplete: true });
    expect(result.status).toBe('failed');
    expect(result.failureCode).toBe('SIMULATION_INFRASTRUCTURE_STALLED');
    expect(result.metrics.completed).toBe(0);
    expect(result.infrastructure!.bandwidth.link).toMatchObject({
      activeTransfers: 0,
      transferredBytes: 0,
      busySeconds: 0,
    });
  });
});
