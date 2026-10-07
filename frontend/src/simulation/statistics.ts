import type { DistributionMetrics } from './types';
/** Exact small samples, bounded deterministic histogram after 20,000 observations. */
export class Distribution {
  count = 0;
  sum = 0;
  maximum = 0;
  private samples: number[] = [];
  private histogram?: Map<number, number>;
  private width = 0.1;
  private bucket(value: number) {
    return Math.round(value / this.width);
  }
  private bound() {
    while (this.histogram!.size > 4096) {
      const previous = this.histogram!;
      this.width *= 2;
      this.histogram = new Map();
      for (const [bucket, count] of previous) {
        const next = Math.round(bucket / 2);
        this.histogram.set(next, (this.histogram.get(next) ?? 0) + count);
      }
    }
  }
  add(value: number) {
    this.count++;
    this.sum += value;
    this.maximum = Math.max(this.maximum, value);
    if (this.histogram) {
      const b = this.bucket(value);
      this.histogram.set(b, (this.histogram.get(b) ?? 0) + 1);
      this.bound();
    } else {
      this.samples.push(value);
      if (this.samples.length > 20000) {
        this.histogram = new Map();
        for (const s of this.samples) {
          const b = this.bucket(s);
          this.histogram.set(b, (this.histogram.get(b) ?? 0) + 1);
        }
        this.samples = [];
        this.bound();
      }
    }
  }
  metrics(): DistributionMetrics {
    const ordered = this.histogram
      ? [...this.histogram].sort((a, b) => a[0] - b[0])
      : [...this.samples].sort((a, b) => a - b).map((v) => [v, 1]);
    const at = (rank: number) => {
      if (!this.count) return 0;
      let seen = 0;
      for (const [v, n] of ordered) {
        seen += n;
        if (seen >= rank) return this.histogram ? v * this.width : v;
      }
      return this.maximum;
    };
    const quantile = (q: number) => at(Math.ceil(this.count * q));
    const median =
      this.count % 2
        ? at(Math.ceil(this.count / 2))
        : (at(this.count / 2) + at(this.count / 2 + 1)) / 2;
    return {
      count: this.count,
      average: this.count ? this.sum / this.count : 0,
      median,
      p50: median,
      p95: this.count >= 20 ? quantile(0.95) : null,
      p99: this.count >= 100 ? quantile(0.99) : null,
      maximum: this.maximum,
      approximate: !!this.histogram,
      resolutionSeconds: this.histogram?.size ? this.width : 0,
    };
  }
}
