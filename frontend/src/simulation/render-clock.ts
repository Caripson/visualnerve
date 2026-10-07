/**
 * Interpolates only between observed simulation timestamps. Wall time controls
 * presentation pacing; it never advances the engine or predicts a future state.
 */
export class ObservedSimulationClock {
  private runId?: string;
  private observedTime = 0;
  private from = 0;
  private target = 0;
  private receivedAt = 0;
  private duration = 0;
  private moving = false;

  observe(runId: string, timeSeconds: number, now: number, animate: boolean) {
    const reset = this.runId !== runId || timeSeconds < this.observedTime;
    const previous = reset ? timeSeconds : this.time(now);
    const interval = now - this.receivedAt;
    this.runId = runId;
    this.observedTime = timeSeconds;
    this.from = Math.min(previous, timeSeconds);
    this.target = timeSeconds;
    this.receivedAt = now;
    this.moving = animate && !reset && this.from < this.target;
    // A suspended tab must not spend seconds replaying an obsolete visual interval.
    this.duration = this.moving ? Math.max(16, Math.min(100, interval)) : 0;
    if (!this.moving) this.from = this.target;
  }

  time(now: number) {
    if (!this.moving) return this.target;
    const progress = Math.max(0, Math.min(1, (now - this.receivedAt) / this.duration));
    return this.from + (this.target - this.from) * progress;
  }

  needsFrame(now: number) {
    return this.moving && now < this.receivedAt + this.duration;
  }
}
