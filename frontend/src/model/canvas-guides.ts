export type GuideAxis = 'horizontal' | 'vertical';
export type CanvasGuide = { id: string; axis: GuideAxis; position: number };
export type RulerOrigin = { x: number; y: number };

export const canvasGuideLimit = 200;

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function isCanvasGuide(value: unknown): value is CanvasGuide {
  if (!value || typeof value !== 'object') return false;
  const guide = value as Partial<CanvasGuide>;
  return (
    typeof guide.id === 'string' &&
    uuid.test(guide.id) &&
    (guide.axis === 'horizontal' || guide.axis === 'vertical') &&
    Number.isFinite(guide.position)
  );
}

export function isRulerOrigin(value: unknown): value is RulerOrigin {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<RulerOrigin>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
