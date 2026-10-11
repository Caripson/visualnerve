export interface ChartPoint {
  breakBefore?: boolean;
  time: number;
  value: number | null;
  sourceValue?: number | null;
  id?: string;
  quality?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

/** Display geometry only. Analysis always receives the original observations. */
export class ChartViewport {
  readonly left: number;
  readonly right = 22;
  readonly top = 28;
  readonly bottom = 54;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly time: readonly [number, number],
    readonly values: readonly [number, number],
    left = 64,
  ) {
    this.left = left;
  }

  x(time: number): number {
    const span = this.time[1] - this.time[0] || 1;
    return this.left + ((time - this.time[0]) / span) * this.plotWidth;
  }

  y(value: number): number {
    const span = this.values[1] - this.values[0] || 1;
    return this.top + (1 - (value - this.values[0]) / span) * this.plotHeight;
  }

  timeAt(x: number): number {
    const fraction = Math.max(0, Math.min(1, (x - this.left) / this.plotWidth));
    return this.time[0] + fraction * (this.time[1] - this.time[0]);
  }

  valueAt(y: number): number {
    const fraction = Math.max(0, Math.min(1, (y - this.top) / this.plotHeight));
    return this.values[1] - fraction * (this.values[1] - this.values[0]);
  }

  get plotWidth(): number {
    return Math.max(1, this.width - this.left - this.right);
  }

  get plotHeight(): number {
    return Math.max(1, this.height - this.top - this.bottom);
  }

  nearest(points: readonly ChartPoint[], time: number): ChartPoint | undefined {
    if (!points.length) return undefined;
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const middle = (lo + hi) >>> 1;
      if (points[middle].time < time) lo = middle + 1;
      else hi = middle;
    }
    const before = points[Math.max(0, lo - 1)];
    const after = points[Math.min(points.length - 1, lo)];
    return Math.abs(before.time - time) <= Math.abs(after.time - time) ? before : after;
  }

  /** Retains extrema in each display bucket and discontinuities; never fills a gap. */
  sample(points: readonly ChartPoint[], budget = 1200): ChartPoint[] {
    if (points.length <= budget) return [...points];
    const bucketSize = Math.ceil(points.length / Math.max(1, Math.floor(budget / 4)));
    const output: ChartPoint[] = [];
    for (let start = 0; start < points.length; start += bucketSize) {
      const bucket = points.slice(start, start + bucketSize);
      const finite = bucket.filter((point) => point.value !== null);
      const minimum = finite.reduce<ChartPoint | undefined>(
        (best, point) => (!best || point.value! < best.value! ? point : best),
        undefined,
      );
      const maximum = finite.reduce<ChartPoint | undefined>(
        (best, point) => (!best || point.value! > best.value! ? point : best),
        undefined,
      );
      const retained = new Set([bucket[0], minimum, maximum, bucket.at(-1)]);
      if (bucket.some((point) => point.value === null))
        retained.add(bucket.find((point) => point.value === null));
      output.push(...bucket.filter((point) => retained.has(point)));
    }
    const selected = new Set(output);
    const retained: ChartPoint[] = [];
    let gap = false;
    for (const point of points) {
      gap ||= point.breakBefore === true || point.value === null;
      if (selected.has(point)) {
        retained.push(gap ? { ...point, breakBefore: true } : point);
        if (point.value !== null) gap = false;
      }
    }
    return retained;
  }

  path(points: readonly ChartPoint[]): string {
    let penDown = false;
    return points
      .map((point) => {
        if (point.value === null) {
          penDown = false;
          return '';
        }
        if (point.breakBefore) penDown = false;
        const command = `${penDown ? 'L' : 'M'}${this.x(point.time).toFixed(2)},${this.y(point.value).toFixed(2)}`;
        penDown = true;
        return command;
      })
      .join(' ');
  }
}
