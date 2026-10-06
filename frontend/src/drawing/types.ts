export interface DrawingStroke {
  id: string;
  color: string;
  width: number;
  points: [number, number][];
}

export interface DrawingLayer {
  version: 1;
  visible: boolean;
  strokes: DrawingStroke[];
}

export const drawingLimits = { strokes: 1000, pointsPerStroke: 20000, points: 200000 };

export function getDrawingLayer(value: unknown): DrawingLayer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const layer = value as Partial<DrawingLayer>;
  return layer.version === 1 && typeof layer.visible === 'boolean' && Array.isArray(layer.strokes)
    ? (layer as DrawingLayer)
    : undefined;
}
