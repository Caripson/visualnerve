/** Observable resource cleanup, separate from the public video runtime state. */
export class VideoCleanupCoordinator {
  private tasks = new Set<Promise<void>>();
  private listeners = new Set<() => void>();

  isBusy = () => this.tasks.size > 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    this.listeners.forEach((listener) => listener());
  }
  track(work: Promise<void>, release?: () => void) {
    const wasBusy = this.isBusy();
    const task = work.finally(() => {
      try {
        release?.();
      } finally {
        this.tasks.delete(task);
        if (!this.isBusy()) this.notify();
      }
    });
    this.tasks.add(task);
    if (!wasBusy) this.notify();
    return task;
  }
  async settled() {
    let failed = false;
    let failure: unknown;
    while (this.tasks.size) {
      for (const result of await Promise.allSettled([...this.tasks])) {
        if (result.status === 'rejected' && !failed) {
          failed = true;
          failure = result.reason;
        }
      }
    }
    if (failed) throw failure;
  }
}
