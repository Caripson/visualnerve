import type { CanvasNode } from '../canvas/projection';
import { captureSpatialNodeFaces, SPATIAL_FACE_CAPTURE_LIMIT } from '../spatial/faces';
import { getSpatialView } from '../spatial/types';
import { useEditor } from '../state/editor';
import {
  VIDEO_SPATIAL_FRAME,
  VIDEO_SPATIAL_PREPARE,
  videoCanvasInfo,
  type VideoCanvasInfo,
  type VideoSpatialFrameRequest,
  type VideoSpatialPrepareRequest,
} from './video-frame-events';
import { VideoVectors } from './video-vectors';

export const VIDEO_SCENE_CACHE_BYTES = 128 * 1024 * 1024;
export const VIDEO_VISIBLE_CARD_LIMIT = 5000;
export interface VideoScene {
  /** Warm native cards before the player starts moving its camera. */
  prepare(nodeId?: string, nodeIds?: string[]): Promise<void>;
  draw(context: CanvasRenderingContext2D, width: number, height: number): Promise<void> | void;
  dispose(): void;
}
type Card = { view: CanvasNode; x: number; y: number; width: number; height: number };
type Sprite = {
  canvas: HTMLCanvasElement;
  signature: string;
  ratio: number;
  bytes: number;
  used: number;
};

export function videoFrameBounds(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  if (
    ![sourceWidth, sourceHeight, width, height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('The diagram canvas has no drawable size.');
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return {
    x: (width - sourceWidth * scale) / 2,
    y: (height - sourceHeight * scale) / 2,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    scale,
  };
}

function absolutePositions(info: VideoCanvasInfo) {
  const nodes = new Map(info.nodes.map((view) => [view.id, view]));
  const positions = new Map<string, { x: number; y: number }>();
  const absolute = (view: CanvasNode): { x: number; y: number } => {
    const cached = positions.get(view.id);
    if (cached) return cached;
    const internal = info.absolute(view.id);
    if (internal) {
      positions.set(view.id, internal);
      return internal;
    }
    const parent = view.parentId ? nodes.get(view.parentId) : undefined;
    const origin = parent ? absolute(parent) : { x: 0, y: 0 };
    const position = { x: origin.x + view.position.x, y: origin.y + view.position.y };
    positions.set(view.id, position);
    return position;
  };
  return absolute;
}
/** Includes nonresident ReactFlow nodes and absolute positions of nested groups. */
export function videoVisibleCards(info: VideoCanvasInfo, padding = 0): Card[] {
  const absolute = absolutePositions(info);
  const { x, y, zoom } = info.viewport;
  return info.nodes.flatMap((view) => {
    if (view.hidden) return [];
    const position = absolute(view);
    const width = view.width ?? view.data.node.width,
      height = view.height ?? view.data.node.height;
    if (
      (position.x + width) * zoom + x < -padding ||
      position.x * zoom + x > info.width + padding ||
      (position.y + height) * zoom + y < -padding ||
      position.y * zoom + y > info.height + padding
    )
      return [];
    return [{ view, ...position, width, height }];
  });
}

/** Cache resolution follows screen size and the total visible native-card area. */
export function videoSpriteRatio(
  cards: Card[],
  zoom: number,
  outputScale: number,
  budget = VIDEO_SCENE_CACHE_BYTES,
) {
  const area = cards.reduce((sum, card) => sum + card.width * card.height, 0);
  return Math.min(
    2,
    Math.max(0.0001, zoom * outputScale * 1.25),
    Math.sqrt((budget * 0.85) / Math.max(1, area * 4)),
  );
}
function abortError() {
  return new DOMException('Video scene capture was cancelled.', 'AbortError');
}
function nextFrame(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const id = requestAnimationFrame(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    });
    const cancel = () => {
      cancelAnimationFrame(id);
      reject(abortError());
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** Capture only the diagram scene, never the player, settings or editor controls. */
export async function createVideoScene(signal: AbortSignal): Promise<VideoScene> {
  const graph = useEditor.getState().graph;
  if (!graph) throw new Error('Open a diagram before exporting a video.');
  if (signal.aborted) throw abortError();
  const diagramId = graph.diagram.id,
    mode = getSpatialView(graph).mode;
  const abort = new AbortController();
  const parentAbort = () => abort.abort();
  signal.addEventListener('abort', parentAbort, { once: true });
  let disposed = false;
  const check = () => {
    if (disposed || abort.signal.aborted) throw abortError();
    const current = useEditor.getState().graph;
    if (!current || current.diagram.id !== diagramId || getSpatialView(current).mode !== mode)
      throw new Error('The diagram or its 2D/3D view changed during video export.');
  };
  const release = () => {
    disposed = true;
    signal.removeEventListener('abort', parentAbort);
    abort.abort();
  };
  if (mode === '3d') {
    const prepare = async (nodeId?: string, nodeIds?: string[]) => {
      check();
      let failure: string | undefined;
      window.dispatchEvent(
        new CustomEvent<VideoSpatialPrepareRequest>(VIDEO_SPATIAL_PREPARE, {
          detail: {
            nodeId,
            nodeIds,
            error: (message) => {
              failure = message;
            },
          },
        }),
      );
      if (failure) throw new Error(failure);
      // Let React commit a prioritized target, then wait for its native card texture.
      await nextFrame(abort.signal);
      await nextFrame(abort.signal);
      const deadline = performance.now() + 30000;
      for (;;) {
        check();
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[data-testid="spatial-canvas"]',
        );
        if (!canvas) throw new Error('The 3D diagram renderer is unavailable.');
        if (canvas.dataset.faceSource === 'empty') return;
        // The resident texture set is bounded by the 3D renderer. Preparing only
        // the first scene card can freeze fallback faces into the recorded hold.
        if (canvas.dataset.faceSource === '2d-node') return;
        if (performance.now() > deadline)
          throw new Error('The native 3D card textures could not be prepared.');
        await nextFrame(abort.signal);
      }
    };
    return {
      prepare,
      draw(context, width, height) {
        check();
        let captured = false,
          failure: string | undefined;
        window.dispatchEvent(
          new CustomEvent<VideoSpatialFrameRequest>(VIDEO_SPATIAL_FRAME, {
            detail: {
              capture: (canvas) => {
                const frame = videoFrameBounds(canvas.width, canvas.height, width, height);
                context.fillStyle = '#111111';
                context.fillRect(0, 0, width, height);
                // This copy runs before the event returns and the WebGL buffer is discarded.
                context.drawImage(canvas, frame.x, frame.y, frame.width, frame.height);
                captured = true;
              },
              error: (message) => {
                failure = message;
              },
            },
          }),
        );
        if (failure || !captured)
          throw new Error(failure ?? 'The 3D diagram renderer is unavailable.');
      },
      dispose: release,
    };
  }
  let initial: VideoCanvasInfo;
  try {
    initial = videoCanvasInfo();
  } catch (error) {
    release();
    throw error;
  }
  const vectors = new VideoVectors(initial.host);
  const sprites = new Map<string, Sprite>();
  let grid: { color: string; canvas: HTMLCanvasElement; pattern: CanvasPattern } | undefined;
  let bytes = 0,
    tick = 0;
  const signatures = new WeakMap<CanvasNode, string>();
  const signature = (view: CanvasNode) => {
    let value = signatures.get(view);
    if (!value) {
      value = JSON.stringify([
        view.type,
        view.width,
        view.height,
        view.className,
        view.data.node,
        view.data.owners,
        view.data.childCount,
        view.data.presentationNumber,
        view.data.mindmap,
      ]);
      signatures.set(view, value);
    }
    return `${value}:${document.documentElement.dataset.theme}:${document.documentElement.className}`;
  };
  const discard = (id: string) => {
    const previous = sprites.get(id);
    if (!previous) return;
    bytes -= previous.bytes;
    previous.canvas.width = previous.canvas.height = 0;
    sprites.delete(id);
  };
  const warm = async (
    info: VideoCanvasInfo,
    cards: Card[],
    outputScale = Math.min(1280 / info.width, 720 / info.height),
    upgrade = false,
    budget = VIDEO_SCENE_CACHE_BYTES,
    limit = VIDEO_VISIBLE_CARD_LIMIT,
  ) => {
    check();
    if (cards.length > limit)
      throw new Error(
        `Video export supports at most ${VIDEO_VISIBLE_CARD_LIMIT} visible cards per frame. Zoom in or filter the diagram.`,
      );
    let ratio = videoSpriteRatio(cards, info.viewport.zoom, outputScale, budget);
    const keep = new Set(cards.map((card) => card.view.id));
    const pending = cards.filter(({ view }) => {
      const sprite = sprites.get(view.id);
      if (
        sprite &&
        sprite.signature === signature(view) &&
        (!upgrade || sprite.ratio >= ratio * 0.85)
      ) {
        sprite.used = ++tick;
        return false;
      }
      discard(view.id);
      return true;
    });
    // Evict least recently used off-screen cards before allocating a new batch.
    const requestedBytes = pending.reduce(
      (sum, card) => sum + Math.max(1, card.width * ratio) * Math.max(1, card.height * ratio) * 4,
      0,
    );
    for (const [id] of [...sprites].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes + requestedBytes <= VIDEO_SCENE_CACHE_BYTES) break;
      if (!keep.has(id)) discard(id);
    }
    // Retain crisp target cards when an overview needs lower resolution. Allocate
    // only the remaining budget to missing cards instead of rasterizing every zoom.
    const area = pending.reduce((sum, card) => sum + card.width * card.height, 0);
    ratio = Math.min(
      ratio,
      Math.sqrt((Math.max(1, VIDEO_SCENE_CACHE_BYTES - bytes) * 0.9) / Math.max(1, area * 4)),
    );
    for (let offset = 0; offset < pending.length; offset += SPATIAL_FACE_CAPTURE_LIMIT) {
      check();
      const batch = pending.slice(offset, offset + SPATIAL_FACE_CAPTURE_LIMIT);
      const captures = await captureSpatialNodeFaces(
        info.graph,
        batch.map((card) => card.view),
        abort.signal,
        { pixelRatio: ratio },
      );
      try {
        check();
      } catch (error) {
        for (const canvas of captures.values()) canvas.width = canvas.height = 0;
        throw error;
      }
      for (const card of batch) {
        const canvas = captures.get(card.view.id);
        if (!canvas) throw new Error(`Could not capture diagram card ${card.view.id}.`);
        const size = canvas.width * canvas.height * 4;
        sprites.set(card.view.id, {
          canvas,
          bytes: size,
          ratio,
          signature: signature(card.view),
          used: ++tick,
        });
        bytes += size;
      }
      if (bytes > VIDEO_SCENE_CACHE_BYTES)
        throw new Error('The native diagram cards exceeded the video texture memory limit.');
    }
  };
  const prepare = async (nodeId?: string) => {
    check();
    const info = videoCanvasInfo();
    await warm(info, videoVisibleCards(info));
    if (nodeId) {
      const view = info.nodes.find((node) => node.id === nodeId && !node.hidden);
      if (!view) throw new Error('The presentation card is hidden or unavailable.');
      // A virtualized child still uses its parent's absolute position. Resolve it
      // through the complete render model when no mounted internal node exists.
      const position = absolutePositions(info)(view);
      const zoom = Math.min(
        1.15,
        info.width / ((view.width ?? view.data.node.width) * 2.3),
        info.height / ((view.height ?? view.data.node.height) * 2.3),
      );
      const target = {
        ...info,
        viewport: {
          zoom,
          x: info.width / 2 - (position.x + (view.width ?? view.data.node.width) / 2) * zoom,
          y: info.height / 2 - (position.y + (view.height ?? view.data.node.height) / 2) * zoom,
        },
      };
      // Prewarm the linear 2D camera corridor at overview resolution. Native cards
      // along the flight are ready before recording, including virtualized nodes.
      const corridor = new Map<string, Card>();
      for (let step = 0; step <= 24; step++) {
        const progress = step / 24;
        const sample = {
          ...info,
          viewport: {
            x: info.viewport.x + (target.viewport.x - info.viewport.x) * progress,
            y: info.viewport.y + (target.viewport.y - info.viewport.y) * progress,
            zoom: info.viewport.zoom + (target.viewport.zoom - info.viewport.zoom) * progress,
          },
        };
        if (videoVisibleCards(sample).length > VIDEO_VISIBLE_CARD_LIMIT)
          throw new Error(
            `Video export supports at most ${VIDEO_VISIBLE_CARD_LIMIT} visible cards per frame. Zoom in or filter the diagram.`,
          );
        for (const card of videoVisibleCards(sample, 160)) corridor.set(card.view.id, card);
      }
      const overview = {
        ...info,
        viewport: { ...info.viewport, zoom: Math.min(info.viewport.zoom, zoom) },
      };
      await warm(
        overview,
        [...corridor.values()],
        undefined,
        false,
        VIDEO_SCENE_CACHE_BYTES * 0.35,
        20000,
      );
      await warm(
        target,
        videoVisibleCards(target, 160),
        undefined,
        true,
        VIDEO_SCENE_CACHE_BYTES,
        20000,
      );
    }
    vectors.update(videoCanvasInfo());
  };
  return {
    prepare,
    async draw(context, width, height) {
      check();
      let info = videoCanvasInfo();
      let frame = videoFrameBounds(info.width, info.height, width, height);
      let cards = videoVisibleCards(info);
      await warm(info, cards, frame.scale);
      // An asynchronous native capture can overlap a live camera tween. Use the latest
      // transform and ensure all newly exposed cards are present before emitting a frame.
      info = videoCanvasInfo();
      frame = videoFrameBounds(info.width, info.height, width, height);
      cards = videoVisibleCards(info);
      if (cards.length > VIDEO_VISIBLE_CARD_LIMIT)
        throw new Error(
          `Video export supports at most ${VIDEO_VISIBLE_CARD_LIMIT} visible cards per frame. Zoom in or filter the diagram.`,
        );
      if (cards.some((card) => !sprites.has(card.view.id))) await warm(info, cards, frame.scale);
      check();
      vectors.update(info);
      const style = getComputedStyle(info.host);
      context.fillStyle = '#111111';
      context.fillRect(0, 0, width, height);
      context.save();
      context.beginPath();
      context.rect(frame.x, frame.y, frame.width, frame.height);
      context.clip();
      context.translate(frame.x, frame.y);
      context.scale(frame.scale, frame.scale);
      context.fillStyle =
        style
          .getPropertyValue(info.graph.diagram.type === 'mindmap' ? '--node-bg' : '--canvas')
          .trim() || '#f4f6f4';
      context.fillRect(0, 0, info.width, info.height);
      context.translate(info.viewport.x, info.viewport.y);
      context.scale(info.viewport.zoom, info.viewport.zoom);
      const dots = info.host.querySelector<SVGCircleElement>('.react-flow__background circle');
      if (
        info.graph.diagram.settings.grid !== false &&
        dots &&
        typeof context.createPattern === 'function'
      ) {
        const color = getComputedStyle(dots).fill;
        if (grid?.color !== color) {
          if (grid) grid.canvas.width = grid.canvas.height = 0;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 40;
          const tile = canvas.getContext('2d');
          if (!tile) throw new Error('The diagram background could not be captured.');
          tile.fillStyle = color;
          tile.beginPath();
          tile.arc(21, 21, 1, 0, Math.PI * 2);
          tile.fill();
          const pattern = context.createPattern(canvas, 'repeat');
          if (!pattern) throw new Error('The diagram background could not be captured.');
          pattern.setTransform(new DOMMatrix().scale(0.5));
          grid = { color, canvas, pattern };
        }
        context.fillStyle = grid.pattern;
        context.fillRect(
          -info.viewport.x / info.viewport.zoom,
          -info.viewport.y / info.viewport.zoom,
          info.width / info.viewport.zoom,
          info.height / info.viewport.zoom,
        );
      }
      const ordered = [...cards].sort(
        (a, b) =>
          Number(a.view.zIndex ?? (a.view.data.node.nodeType === 'group' ? -1 : 1)) -
          Number(b.view.zIndex ?? (b.view.data.node.nodeType === 'group' ? -1 : 1)),
      );
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const drawCard = (card: Card) => {
        const sprite = sprites.get(card.view.id);
        if (!sprite) throw new Error(`The native video card ${card.view.id} was not prepared.`);
        context.globalAlpha = Number(card.view.style?.opacity ?? 1);
        context.drawImage(sprite.canvas, card.x, card.y, card.width, card.height);
      };
      for (const card of ordered.filter(
        (card) => (card.view.zIndex ?? (card.view.data.node.nodeType === 'group' ? -1 : 1)) < 0,
      ))
        drawCard(card);
      context.globalAlpha = 1;
      vectors.drawEdges(context);
      for (const card of ordered.filter(
        (card) => (card.view.zIndex ?? (card.view.data.node.nodeType === 'group' ? -1 : 1)) >= 0,
      ))
        drawCard(card);
      context.globalAlpha = 1;
      vectors.drawDrawing(context);
      context.restore();
    },
    dispose() {
      release();
      vectors.dispose();
      if (grid) grid.canvas.width = grid.canvas.height = 0;
      for (const id of sprites.keys()) discard(id);
    },
  };
}
