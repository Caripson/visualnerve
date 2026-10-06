import { useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { overviewZoomLevel } from './types';

/** Semantic levels measure magnification relative to the readable initial overview fit. */
export function normalizedOverviewZoom(physicalZoom: number, anchor: number, fitting = false) {
  if (fitting) return 0.1;
  return Math.max(
    0.000001,
    Math.min(10, Math.pow(physicalZoom / Math.max(0.000001, anchor), 2.5) * 0.1),
  );
}
export function useOverviewZoom(diagramId: string | undefined, spatial: boolean) {
  const physicalZoom = useStore((state) => state.transform[2]);
  const flow = useReactFlow();
  const [anchor, setAnchor] = useState(1);
  const [fitting, setFitting] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setFitting(false);
    return () => {
      generation.current++;
    };
  }, [diagramId, spatial]);
  const fit = useCallback(async () => {
    const token = ++generation.current;
    setFitting(true);
    // Allow the new summary projection to reach React Flow before measuring it.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (generation.current !== token) return;
    try {
      await flow.fitView({ padding: 0.25, maxZoom: 1, duration: 0 });
    } finally {
      if (generation.current === token) {
        setAnchor(flow.getZoom());
        setFitting(false);
      }
    }
  }, [flow]);
  const zoom = normalizedOverviewZoom(physicalZoom, anchor, fitting);
  return { zoom, level: overviewZoomLevel(zoom), fit };
}
