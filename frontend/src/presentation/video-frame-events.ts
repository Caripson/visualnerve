import type { Edge } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import type { Graph } from '../model/types';

export const VIDEO_CANVAS_INFO = 'visualnerve:video-canvas-info';
export const VIDEO_SPATIAL_FRAME = 'visualnerve:video-spatial-frame';
export const VIDEO_SPATIAL_PREPARE = 'visualnerve:video-spatial-prepare';

export interface VideoCanvasInfo {
  graph: Graph;
  nodes: CanvasNode[];
  edges: Edge[];
  host: HTMLElement;
  width: number;
  height: number;
  viewport: { x: number; y: number; zoom: number };
  overviewActive?: boolean;
  absolute: (id: string) => { x: number; y: number } | undefined;
}

export interface VideoCanvasInfoRequest {
  receive: (info: VideoCanvasInfo) => void;
}
export interface VideoSpatialFrameRequest {
  capture: (canvas: HTMLCanvasElement) => void;
  error: (message: string) => void;
}
export interface VideoSpatialPrepareRequest {
  nodeId?: string;
  nodeIds?: string[];
  error?: (message: string) => void;
}
export const VIDEO_SPATIAL_LIMIT_ERROR =
  '3D video export supports at most 8000 visible nodes and 16000 visible connections. Filter the diagram or switch to 2D.';

/** The active canvas supplies the current render model without persisting a camera. */
export function videoCanvasInfo(): VideoCanvasInfo {
  let result: VideoCanvasInfo | undefined;
  window.dispatchEvent(
    new CustomEvent<VideoCanvasInfoRequest>(VIDEO_CANVAS_INFO, {
      detail: {
        receive: (info) => {
          result = info;
        },
      },
    }),
  );
  if (!result) throw new Error('Open a ready 2D diagram before exporting a video.');
  return result;
}
