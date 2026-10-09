export const APP_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

export interface AppUpdateState {
  phase: 'idle' | 'ready' | 'applying' | 'error';
  version?: string;
  changedElsewhere: boolean;
  dismissed: boolean;
  error?: unknown;
}

const initial: AppUpdateState = Object.freeze({
  phase: 'idle',
  changedElsewhere: false,
  dismissed: false,
});

/** Static release discovery never opens a database or waits on private work. */
export class AppUpdateController {
  private state = initial;
  private listeners = new Set<() => void>();
  private registration?: ServiceWorkerRegistration;
  private waiting?: ServiceWorker;
  private started = false;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;
  private installing?: ServiceWorker;
  private hadController = false;
  private applyingWorker?: ServiceWorker;
  private messages = new Set<() => void>();
  private applyPending = false;

  constructor(
    private workers: ServiceWorkerContainer,
    private browser: Window,
    private document: Document,
    private online: () => boolean = () => navigator.onLine,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<AppUpdateState>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }
  private current(generation: number) {
    return this.started && generation === this.generation;
  }
  private activity = () => {
    if (this.document.visibilityState !== 'hidden') void this.check();
  };
  private updateFound = () => {
    this.watchInstalling();
    void this.inspectWaiting();
  };
  private installed = () => {
    if (this.installing?.state === 'installed') void this.inspectWaiting();
  };
  private controllerChanged = () => {
    const controller = this.workers.controller;
    if (!controller) return;
    if (!this.hadController) {
      this.hadController = true;
      return;
    }
    // A different tab can activate a release. Keep this tab's JavaScript and
    // edits alive until its own user chooses the controlled restart.
    if (controller !== this.applyingWorker)
      this.publish({
        phase: this.state.phase === 'applying' ? 'applying' : 'ready',
        changedElsewhere: true,
        dismissed: false,
        error: undefined,
      });
  };

  start() {
    if (this.started) return;
    this.started = true;
    this.generation++;
    this.checking = undefined;
    this.hadController = !!this.workers.controller;
    this.workers.addEventListener('controllerchange', this.controllerChanged);
    this.browser.addEventListener('online', this.activity);
    this.browser.addEventListener('focus', this.activity);
    this.document.addEventListener('visibilitychange', this.activity);
    this.timer = setInterval(this.activity, APP_UPDATE_INTERVAL_MS);
    void this.check();
  }
  stop() {
    this.started = false;
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.workers.removeEventListener('controllerchange', this.controllerChanged);
    this.browser.removeEventListener('online', this.activity);
    this.browser.removeEventListener('focus', this.activity);
    this.document.removeEventListener('visibilitychange', this.activity);
    this.registration?.removeEventListener('updatefound', this.updateFound);
    this.installing?.removeEventListener('statechange', this.installed);
    for (const cancel of this.messages) cancel();
  }
  track(registration: ServiceWorkerRegistration) {
    if (!this.started) return;
    const scope = new URL(registration.scope);
    if (scope.origin !== this.browser.location.origin || scope.pathname !== '/') return;
    this.registration?.removeEventListener('updatefound', this.updateFound);
    this.registration = registration;
    registration.addEventListener('updatefound', this.updateFound);
    this.watchInstalling();
    void this.inspectWaiting();
  }
  private watchInstalling() {
    this.installing?.removeEventListener('statechange', this.installed);
    this.installing = this.registration?.installing ?? undefined;
    this.installing?.addEventListener('statechange', this.installed);
  }
  async check() {
    if (!this.started || !this.online()) return;
    if (this.checking) return this.checking;
    const generation = this.generation;
    const checking = (async () => {
      try {
        const registration = this.registration ?? (await this.workers.getRegistration('/'));
        if (!this.current(generation) || !registration) return;
        this.track(registration);
        // update() fetches only the same-origin static worker. Its failure never
        // changes the editor or its offline availability.
        await this.refreshRegistration(registration);
        if (this.current(generation)) await this.inspectWaiting();
      } catch {
        // Connectivity, browser quota and interrupted installation are optional
        // discovery failures. Never replace a usable editor with an error gate.
      }
    })().finally(() => {
      if (this.checking === checking) this.checking = undefined;
    });
    this.checking = checking;
    return this.checking;
  }
  private async refreshRegistration(registration: ServiceWorkerRegistration) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        registration.update(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Update discovery timed out.')), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private message(worker: ServiceWorker, type: string, version?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (error?: Error, release?: string) => {
        this.messages.delete(cancel);
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        if (error) reject(error);
        else resolve(release!);
      };
      const timer = setTimeout(() => finish(new Error('The app update did not respond.')), 5000);
      const cancel = () => finish(new Error('Update discovery stopped.'));
      this.messages.add(cancel);
      channel.port1.onmessage = (event: MessageEvent) => {
        const value = event.data;
        if (
          value?.type !== (type === 'app-update-info' ? type : 'app-update-activated') ||
          typeof value.version !== 'string' ||
          !/^visual-nerve-(?:app-)?shell-[a-f0-9]{12}$/.test(value.version) ||
          (version !== undefined && value.version !== version)
        ) {
          finish(new Error('The app release changed. Check for updates and try again.'));
          return;
        }
        finish(undefined, value.version);
      };
      try {
        worker.postMessage({ type, ...(version ? { version } : {}) }, [channel.port2]);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  private async inspectWaiting(applying = false) {
    const generation = this.generation;
    const worker = this.registration?.waiting;
    if (!worker || !this.workers.controller || (this.state.phase === 'applying' && !applying))
      return;
    try {
      const version = await this.message(worker, 'app-update-info');
      if (!this.current(generation) || this.registration?.waiting !== worker) return;
      const same = this.state.version === version && !this.state.changedElsewhere;
      this.waiting = worker;
      this.publish({
        phase: applying ? 'applying' : 'ready',
        version,
        changedElsewhere: false,
        dismissed: same ? this.state.dismissed : false,
        error: undefined,
      });
    } catch {
      // A failed/obsolete installing worker is not an available release.
    }
  }
  later() {
    if (this.state.phase !== 'applying') this.publish({ dismissed: true });
  }
  async apply(prepare: () => Promise<void>, reload: () => void) {
    if (this.applyPending || !['ready', 'error'].includes(this.state.phase)) return;
    this.applyPending = true;
    const generation = this.generation;
    let worker = this.waiting;
    let version = this.state.version;
    let changedElsewhere = this.state.changedElsewhere;
    const retry = this.state.phase === 'error';
    this.publish({ phase: 'applying', error: undefined, dismissed: false });
    try {
      if (retry) {
        await this.inspectWaiting(true);
        if (!this.current(generation)) return;
        worker = this.waiting;
        version = this.state.version;
        changedElsewhere = this.state.changedElsewhere;
      }
      await prepare();
      if (!this.current(generation)) return;
      if (!changedElsewhere) {
        if (!worker || !version || this.registration?.waiting !== worker)
          throw new Error('The pending release changed. Check for updates and try again.');
        this.applyingWorker = worker;
        // Install finishes all app assets before exposing this waiting worker.
        // Activation and controller ownership, rather than animation, define
        // when the new shell can safely serve the explicit reload.
        const controlled = this.waitForController(worker);
        try {
          await this.message(worker, 'app-update-activate', version);
          await controlled.promise;
        } finally {
          controlled.cancel();
        }
      }
      if (this.current(generation)) reload();
    } catch (error) {
      if (this.current(generation))
        this.publish({
          phase: 'error',
          error,
          changedElsewhere:
            this.state.changedElsewhere || (!!worker && this.workers.controller === worker),
        });
    } finally {
      this.applyingWorker = undefined;
      this.applyPending = false;
    }
  }
  private waitForController(worker: ServiceWorker) {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      const changed = () => {
        if (this.workers.controller === worker) {
          cancel();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        cancel();
        reject(new Error('The new app release did not activate. Try again.'));
      }, 10000);
      cancel = () => {
        clearTimeout(timer);
        this.workers.removeEventListener('controllerchange', changed);
      };
      this.workers.addEventListener('controllerchange', changed);
      changed();
    });
    // A protocol rejection may arrive before activation times out.
    void promise.catch(() => undefined);
    return { promise, cancel };
  }
}
