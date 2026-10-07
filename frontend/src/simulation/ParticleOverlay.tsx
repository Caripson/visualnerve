import { useEffect, useMemo, useRef } from 'react';
import { getSmoothStepPath, Position, useViewport } from '@xyflow/react';
import { useEditor } from '../state/editor';
import { useSimulation } from './useSimulation';
import { resolveSimulationRenderModel } from './render-model';
import type { Graph } from '../model/types';
import { getSimulationPresentationSlots } from './presentation-slots';
import {
  indexSimulationParticleView,
  particleCapacityCard,
  particleTransitEdge,
  type SimulationParticleVisibility,
} from './particle-view';

export const MAX_RENDERED_PARTICLES = 400;
/** One canvas, bounded samples, semantic timestamps: no per-particle DOM or animation clock. */
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
  const projected = useMemo(
    () => graph && indexSimulationParticleView(graph, visibility),
    [graph?.nodes, graph?.edges, visibility],
  );
  const paths = useMemo(
    () => new Map<string, { path: SVGPathElement; length: number }>(),
    [graph?.nodes, graph?.edges],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element || !graph || !model || !projected) return;
    const draw = () => {
      const context = element.getContext('2d');
      if (!context) return;
      const rect = element.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 2);
      element.width = Math.round(rect.width * ratio);
      element.height = Math.round(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!view?.state) return;
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.zoom, viewport.zoom);
      const state = view.state;
      const textColor = getComputedStyle(element).getPropertyValue('--text').trim() || '#30394a';
      const slots = getSimulationPresentationSlots(view.run.id, state);
      const nodes = projected.nodes;
      const edges = new Set(model.edges.map((edge) => edge.id));
      const types = new Map(model.particleTypes.map((type) => [type.id, type]));
      let count = 0;
      let processingCount = 0;
      const mark = (typeId: string, x: number, y: number) => {
        const type = types.get(typeId);
        context.fillStyle = type?.color ?? '#337e73';
        context.strokeStyle = '#fff';
        context.lineWidth = 1.5;
        context.beginPath();
        if (type?.shape === 'square') context.rect(x - 5, y - 5, 10, 10);
        else if (type?.shape === 'triangle') {
          context.moveTo(x, y - 6);
          context.lineTo(x + 6, y + 5);
          context.lineTo(x - 6, y + 5);
          context.closePath();
        } else context.arc(x, y, 5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        count++;
      };
      for (const particle of state.particles) {
        if (count >= MAX_RENDERED_PARTICLES) break;
        const unit = slots.selectProcessingUnit(particle.nodeId, particle);
        if (unit === undefined) continue;
        const card = particleCapacityCard(projected, particle.nodeId, unit);
        if (!card) continue;
        mark(particle.typeId, card.x + card.width - 14, card.y + 14);
        processingCount++;
      }
      for (const particle of state.particles) {
        if (count >= MAX_RENDERED_PARTICLES) break;
        if (!particle.edgeId || !edges.has(particle.edgeId)) continue;
        const edge = particleTransitEdge(projected, particle, slots),
          from = edge && nodes.get(edge.sourceNodeId),
          to = edge && nodes.get(edge.targetNodeId);
        if (
          !from ||
          !to ||
          particle.departedAtSeconds === undefined ||
          particle.arrivesAtSeconds === undefined
        )
          continue;
        const fraction = Math.max(
          0,
          Math.min(
            1,
            (state.timeSeconds - particle.departedAtSeconds) /
              Math.max(0.001, particle.arrivesAtSeconds - particle.departedAtSeconds),
          ),
        );
        const startX = from.x + from.width,
          startY = from.y + from.height / 2;
        const endX = to.x,
          endY = to.y + to.height / 2;
        let geometry = paths.get(edge!.id);
        if (!geometry) {
          const [definition] = getSmoothStepPath({
            sourceX: startX,
            sourceY: startY,
            sourcePosition: Position.Right,
            targetX: endX,
            targetY: endY,
            targetPosition: Position.Left,
          });
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', definition);
          geometry = { path, length: path.getTotalLength() };
          paths.set(edge!.id, geometry);
        }
        const { x, y } = geometry.path.getPointAtLength(geometry.length * fraction);
        mark(particle.typeId, x, y);
      }
      for (const metric of Object.values(state.nodes)) {
        const node = nodes.get(metric.id);
        if (!node || !metric.queue.current || count >= MAX_RENDERED_PARTICLES) continue;
        const queued = state.particles
          .filter(
            (particle) =>
              particle.nodeId === metric.id &&
              particle.status === 'queued' &&
              !particle.pendingAdmission,
          )
          .slice(0, 12);
        for (
          let index = 0;
          index < Math.min(metric.queue.current, 12) && count < MAX_RENDERED_PARTICLES;
          index++
        ) {
          context.fillStyle = types.get(queued[index]?.typeId)?.color ?? '#707b90';
          context.beginPath();
          context.arc(
            node.x - 12 - (index % 4) * 12,
            node.y + 16 + Math.floor(index / 4) * 12,
            4,
            0,
            Math.PI * 2,
          );
          context.fill();
          count++;
        }
        context.fillStyle = textColor;
        context.font = 'bold 11px sans-serif';
        context.fillText(`Queue ${metric.queue.current}`, node.x - 64, node.y - 6);
      }
      // Loss markers represent retained, actually abandoned work, never continuing flow.
      for (const particle of state.particles) {
        if (count >= MAX_RENDERED_PARTICLES) break;
        if (particle.status !== 'abandoned' && particle.status !== 'failed') continue;
        if (
          particle.completedAtSeconds === undefined ||
          state.timeSeconds - particle.completedAtSeconds > 60
        )
          continue;
        const node = nodes.get(particle.nodeId);
        if (!node) continue;
        const x = node.x + node.width + 12,
          y = node.y + 12 + (particle.id % 4) * 12;
        context.strokeStyle = '#d33e49';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x - 4, y - 4);
        context.lineTo(x + 4, y + 4);
        context.moveTo(x + 4, y - 4);
        context.lineTo(x - 4, y + 4);
        context.stroke();
        count++;
      }
      element.dataset.renderedParticles = String(count);
      element.dataset.processingParticles = String(processingCount);
      element.dataset.simulatedParticles = String(state.metrics.created);
      element.dataset.simulatedTime = String(state.timeSeconds);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      theme.disconnect();
    };
  }, [graph, model, view?.state, viewport.x, viewport.y, viewport.zoom, paths, projected]);
  if (!graph?.simulation) return null;
  return (
    <canvas
      ref={canvas}
      className="simulation-particles"
      data-testid="simulation-particles"
      aria-label="Simulation particles and queues. Numerical queue and capacity values are also shown on each node."
    />
  );
}
