import { useEffect, useMemo, useRef } from 'react';
import { getSmoothStepPath, Position, useViewport } from '@xyflow/react';
import { useEditor } from '../state/editor';
import { useSimulation } from './useSimulation';
import { resolveSimulationRenderModel } from './render-model';
import type { Graph, GraphEdge } from '../model/types';
import { getSimulationPresentationSlots } from './presentation-slots';
import { indexSimulationParticleView, type SimulationParticleVisibility } from './particle-view';
import { buildSimulationParticleScene, particleTransitFraction } from './particle-scene';
import { ObservedSimulationClock } from './render-clock';
import { simulationTrafficColors } from './traffic';
import type { SimulationState } from './types';
import { projectedProcessPath } from './process-connections';

export { MAX_RENDERED_PARTICLES } from './particle-scene';
const MAX_CACHED_PATHS = 1600;
interface PathGeometry {
  coordinates: string;
  path: SVGPathElement;
  canvasPath: Path2D;
  length: number;
}

/** One bounded canvas. Actual engine timestamps govern every moving particle. */
export function ParticleOverlay({
  renderGraph,
  visibility,
}: {
  renderGraph?: Graph;
  visibility?: SimulationParticleVisibility;
}) {
  const baseGraph = useEditor((state) => state.graph);
  const graph = renderGraph ?? baseGraph;
  const view = useSimulation(baseGraph?.simulation ? baseGraph.diagram.id : undefined);
  const model = useMemo(
    () =>
      graph?.simulation
        ? resolveSimulationRenderModel(view?.run.model ?? graph.simulation, view?.run.options)
        : undefined,
    [
      graph?.simulation,
      view?.run.model,
      view?.run.options.scenarioId,
      view?.run.options.demandMultiplier,
    ],
  );
  const viewport = useViewport();
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef(new ObservedSimulationClock());
  const observed = useRef<{ state: SimulationState; runId: string; animate: boolean } | undefined>(
    undefined,
  );
  const projected = useMemo(
    () => graph && indexSimulationParticleView(graph, visibility),
    [graph?.nodes, graph?.edges, visibility],
  );
  const paths = useRef(new Map<string, PathGeometry>()).current;

  useEffect(() => {
    const element = canvas.current;
    if (!element || !graph || !model || !projected) return;
    const state = view?.state;
    const animate =
      state?.status === 'running' &&
      view?.replayTimeSeconds === undefined &&
      view?.run.options.speed !== 'max' &&
      view?.run.options.animated !== false;
    if (
      state &&
      view &&
      (observed.current?.state !== state ||
        observed.current.runId !== view.run.id ||
        observed.current.animate !== animate)
    ) {
      clock.current.observe(view.run.id, state.timeSeconds, performance.now(), animate);
      observed.current = { state, runId: view.run.id, animate };
    }
    const types = new Map(model.particleTypes.map((type) => [type.id, type]));
    const slots = state && view ? getSimulationPresentationSlots(view.run.id, state) : undefined;
    let scene: ReturnType<typeof buildSimulationParticleScene> | undefined;
    let sceneWidth = -1,
      sceneHeight = -1;
    let frame: number | undefined;

    const geometry = (edge: GraphEdge) => {
      const from = projected.nodes.get(edge.sourceNodeId),
        to = projected.nodes.get(edge.targetNodeId);
      if (!from || !to) return;
      const projectedPath = projectedProcessPath(edge);
      const coordinates =
        projectedPath ??
        `${from.x + from.width},${from.y + from.height / 2},${to.x},${to.y + to.height / 2}`;
      let value = paths.get(edge.id);
      if (value?.coordinates === coordinates) return value;
      const [fallback] = getSmoothStepPath({
        sourceX: from.x + from.width,
        sourceY: from.y + from.height / 2,
        sourcePosition: Position.Right,
        targetX: to.x,
        targetY: to.y + to.height / 2,
        targetPosition: Position.Left,
      });
      const definition = projectedPath ?? fallback;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', definition);
      value = {
        coordinates,
        path,
        canvasPath: new Path2D(definition),
        length: path.getTotalLength(),
      };
      // Panning a huge model must not leave an unbounded native geometry cache behind.
      if (paths.size >= MAX_CACHED_PATHS) paths.delete(paths.keys().next().value!);
      paths.set(edge.id, value);
      return value;
    };

    const draw = () => {
      const context = element.getContext('2d');
      if (!context) return;
      const rect = element.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * ratio),
        height = Math.round(rect.height * ratio);
      // Resizing every frame clears native state and reallocates the backing buffer.
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!state || !slots) return;
      if (sceneWidth !== rect.width || sceneHeight !== rect.height) {
        sceneWidth = rect.width;
        sceneHeight = rect.height;
        scene = buildSimulationParticleScene(projected, model, state, slots, {
          left: -viewport.x / viewport.zoom,
          top: -viewport.y / viewport.zoom,
          right: (rect.width - viewport.x) / viewport.zoom,
          bottom: (rect.height - viewport.y) / viewport.zoom,
        });
      }
      if (!scene) return;
      const now = performance.now(),
        time = clock.current.time(now);
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.zoom, viewport.zoom);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const style = getComputedStyle(element);
      const surface =
        style.getPropertyValue('--panel').trim() ||
        (document.documentElement.dataset.theme === 'dark' ? '#202936' : '#fff');
      let count = 0,
        processingCount = 0,
        transitCount = 0,
        queueCount = 0,
        trafficCount = 0;

      for (const road of scene.paths) {
        const path = geometry(road.edge);
        if (!path) continue;
        const color = simulationTrafficColors[road.traffic.level];
        context.strokeStyle = surface;
        context.lineWidth = road.resource ? 5 : 9;
        context.setLineDash([]);
        context.globalAlpha = 0.85;
        context.stroke(path.canvasPath);
        context.strokeStyle = color;
        context.lineWidth = road.resource ? 2 : 4;
        context.globalAlpha = road.resource ? 0.65 : 0.9;
        context.setLineDash(road.resource ? [6, 5] : []);
        context.stroke(path.canvasPath);
        context.setLineDash([]);
        context.globalAlpha = 1;
        // Static directional cue, not an independently animated flow counter.
        if (!road.resource && path.length > 45 && viewport.zoom > 0.25) {
          const middle = path.path.getPointAtLength(path.length / 2);
          const ahead = path.path.getPointAtLength(path.length / 2 + 2);
          context.save();
          context.translate(middle.x, middle.y);
          context.rotate(Math.atan2(ahead.y - middle.y, ahead.x - middle.x));
          context.strokeStyle = color;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(-4, -4);
          context.lineTo(1, 0);
          context.lineTo(-4, 4);
          context.stroke();
          context.restore();
        }
        trafficCount++;
      }

      const mark = (typeId: string, x: number, y: number, size = 5) => {
        const type = types.get(typeId);
        context.fillStyle = type?.color ?? '#337e73';
        context.strokeStyle = surface;
        context.lineWidth = 2;
        context.beginPath();
        if (type?.shape === 'square') context.rect(x - size, y - size, size * 2, size * 2);
        else if (type?.shape === 'triangle') {
          context.moveTo(x, y - size - 1);
          context.lineTo(x + size + 1, y + size);
          context.lineTo(x - size - 1, y + size);
          context.closePath();
        } else context.arc(x, y, size, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        count++;
      };
      for (const { particle, edge } of scene.transit) {
        const fraction = particleTransitFraction(particle, time);
        if (fraction === undefined) continue;
        const path = geometry(edge);
        if (!path) continue;
        const { x, y } = path.path.getPointAtLength(path.length * fraction);
        mark(particle.typeId, x, y, 6);
        transitCount++;
      }
      for (const { particle, node } of scene.processing) {
        if ((particle.processingStartedAtSeconds ?? 0) > time) continue;
        mark(particle.typeId, node.x + node.width - 14, node.y + 14);
        processingCount++;
      }
      for (const { particle, node, index } of scene.queues) {
        if ((particle.queueEnteredAtSeconds ?? 0) > time) continue;
        // A compact input rail stays anchored to the queue's owning card.
        mark(
          particle.typeId,
          node.x - 11 - (index % 2) * 11,
          node.y + node.height / 2 - 27 + Math.floor(index / 2) * 11,
          4,
        );
        queueCount++;
      }
      for (const { particle, node, index } of scene.losses) {
        if (particle.completedAtSeconds! > time) continue;
        const x = node.x + node.width - 12,
          y = node.y + node.height - 12 - (index % 3) * 10;
        context.strokeStyle = simulationTrafficColors.congested;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x - 3, y - 3);
        context.lineTo(x + 3, y + 3);
        context.moveTo(x + 3, y - 3);
        context.lineTo(x - 3, y + 3);
        context.stroke();
        count++;
      }
      element.dataset.renderedParticles = String(count);
      element.dataset.processingParticles = String(processingCount);
      element.dataset.transitParticles = String(transitCount);
      element.dataset.queuedParticles = String(queueCount);
      element.dataset.trafficPaths = String(trafficCount);
      element.dataset.simulatedParticles = String(state.metrics.created);
      element.dataset.simulatedTime = String(state.timeSeconds);
      element.dataset.renderedTime = String(time);
      if (clock.current.needsFrame(now)) frame = requestAnimationFrame(draw);
    };
    const redraw = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      draw();
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(element);
    const theme = new MutationObserver(redraw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
    };
  }, [
    graph,
    model,
    view?.state,
    view?.run.id,
    view?.run.options.speed,
    view?.run.options.animated,
    view?.replayTimeSeconds,
    viewport.x,
    viewport.y,
    viewport.zoom,
    paths,
    projected,
  ]);
  if (!graph?.simulation) return null;
  return (
    <canvas
      ref={canvas}
      className="simulation-particles"
      data-testid="simulation-particles"
      aria-label="Actual work particles and traffic: green clear, yellow busy, red congested. Dashed lines share resources. Queue counts and labeled congestion indicators appear on each node."
    />
  );
}
