/// <reference lib="webworker" />
import { SimulationEngine } from './engine';
import type { WorkerCommand, WorkerUpdate, SimulationSpeed, ExecutionOptions } from './protocol';
import type { SimulationModel } from './types';

// Execution lives here, independently of the canvas, React, and requestAnimationFrame.
const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: SimulationEngine | undefined;
let model: SimulationModel;
let options: ExecutionOptions;
let speed: SimulationSpeed = 1;
let paused = false;
let stopped = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastPublish = 0;
let target = 0;
const post = (update: WorkerUpdate) => scope.postMessage(update);
function publish(final = false) {
  if (!engine) return;
  const state = engine.state();
  if (stopped) state.status = 'stopped';
  else if (paused && state.status !== 'completed' && state.status !== 'failed')
    state.status = 'paused';
  else if (state.status === 'ready') state.status = 'running';
  post({
    kind: 'state',
    state,
    ...(final ? { result: { ...engine.result(), status: state.status } } : {}),
  });
  lastPublish = performance.now();
}
function tick() {
  timer = undefined;
  if (!engine || paused || stopped) return;
  try {
    // Wall time controls pacing only. DES timestamps and ordering are never derived from it.
    target = speed === 'max' ? options.durationSeconds : target + 0.025 * speed;
    const reached = engine.advance(Math.min(target, options.durationSeconds), 5000);
    const status = engine.getStatus();
    const final = status === 'completed' || status === 'failed';
    if (final || performance.now() - lastPublish >= 50) publish(final);
    if (!final) timer = setTimeout(tick, speed === 'max' || !reached ? 0 : 25);
  } catch (error) {
    stopped = true;
    post({ kind: 'error', message: (error as Error).message });
  }
}
scope.onmessage = (event: MessageEvent<WorkerCommand>) => {
  try {
    const command = event.data;
    if (command.kind === 'start') {
      if (timer) clearTimeout(timer);
      model = command.model;
      options = command.options;
      speed = options.animated === false ? 'max' : (options.speed ?? 1);
      engine = new SimulationEngine(model, options);
      target = 0;
      paused = !!options.startPaused;
      stopped = false;
      publish();
      timer = setTimeout(tick, 0);
    } else if (command.kind === 'pause') {
      paused = true;
      if (timer) clearTimeout(timer);
      publish();
    } else if (command.kind === 'resume') {
      if (stopped || !engine || engine.state().status === 'completed') return;
      paused = false;
      publish();
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, 0);
    } else if (command.kind === 'stop') {
      stopped = true;
      if (timer) clearTimeout(timer);
      publish(true);
    } else if (command.kind === 'speed') {
      speed = command.speed;
    } else if (command.kind === 'seek') {
      if (timer) clearTimeout(timer);
      const horizon = Math.max(0, command.timeSeconds);
      engine = new SimulationEngine(model, options);
      paused = true;
      stopped = false;
      // Replay reconstructs semantic state using the same deterministic engine.
      const seek = () => {
        if (!engine) return;
        if (engine.advance(horizon, 5000, true)) {
          target = horizon;
          publish();
        } else timer = setTimeout(seek, 0);
      };
      seek();
    }
  } catch (error) {
    post({ kind: 'error', message: (error as Error).message });
  }
};
