import type { GraphEdge } from '../../model/types';

/** Native rendering accepts only finite widths and literal hex colors from import provenance. */
export function importedConnectionStyle(edge: GraphEdge): { color?: string; width?: number } {
  const value = edge.metadata.diagramImport;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const style = value as Record<string, unknown>;
  if (style.format !== 'drawio' && style.format !== 'vsdx') return {};
  return {
    color:
      typeof style.strokeColor === 'string' &&
      /^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(style.strokeColor)
        ? style.strokeColor
        : undefined,
    width:
      typeof style.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)
        ? Math.max(0.5, Math.min(10, style.strokeWidth))
        : undefined,
  };
}
