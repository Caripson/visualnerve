import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APP_UPDATE_INTERVAL_MS, AppUpdateController } from '../src/updates/app-update-controller';

const release = 'visual-nerve-app-shell-123456abcdef';
const laterRelease = 'visual-nerve-app-shell-abcdef123456';

class Port {
  onmessage?: (event: { data: unknown }) => void;
  other?: Port;
  closed = false;
  close() {
    this.closed = true;
  }
  postMessage(data: unknown) {
    queueMicrotask(() => {
      if (!this.other?.closed) this.other?.onmessage?.({ data });
    });
  }
}
class Channel {
  port1 = new Port();
  port2 = new Port();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}
class Worker extends EventTarget {
  state = 'installed';
  onActivate?: () => void;
  postMessage = vi.fn((message: { type: string; version?: string }, ports: Port[]) => {
    if (message.type === 'app-update-activate') this.onActivate?.();
    ports[0].postMessage({
      type: message.type === 'app-update-info' ? message.type : 'app-update-activated',
      version: this.version,
    });
  });
  constructor(public version = release) {
    super();
  }
}
class Registration extends EventTarget {
  scope = window.location.origin + '/';
  waiting: Worker | null = null;
  installing: Worker | null = null;
  update = vi.fn(async () => this);
}
class Workers extends EventTarget {
  controller: Worker | null = new Worker('visual-nerve-app-shell-000000000000');
  getRegistration = vi.fn(async () => this.registration);
  constructor(public registration: Registration) {
    super();
  }
}

const controllers: AppUpdateController[] = [];
function fixture() {
  const registration = new Registration();
  const workers = new Workers(registration);
  let online = true;
  const controller = new AppUpdateController(
    workers as unknown as ServiceWorkerContainer,
    window,
    document,
    () => online,
  );
  controllers.push(controller);
  return {
    controller,
    registration,
    workers,
    offline: () => (online = false),
    online: () => (online = true),
    ready: async (version = release) => {
      const worker = new Worker(version);
      registration.waiting = worker;
      registration.dispatchEvent(new Event('updatefound'));
      await vi.waitFor(() =>
        expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', version }),
      );
      return worker;
    },
  };
}

beforeEach(() => vi.stubGlobal('MessageChannel', Channel));
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('discovers a fully installed release without reloading or activating it', async () => {
  const f = fixture();
  f.controller.start();
  await vi.waitFor(() => expect(f.registration.update).toHaveBeenCalledOnce());
  const worker = await f.ready();
  expect(
    worker.postMessage.mock.calls.every(([message]) => message.type === 'app-update-info'),
  ).toBe(true);
  expect(f.workers.controller).not.toBe(worker);
});

it('does not notify on the initial installation claiming its first client', async () => {
  const f = fixture();
  f.workers.controller = null;
  f.controller.start();
  await vi.waitFor(() => expect(f.registration.update).toHaveBeenCalledOnce());
  f.workers.controller = new Worker();
  f.workers.dispatchEvent(new Event('controllerchange'));
  expect(f.controller.getSnapshot().phase).toBe('idle');
});

it('Later stays dismissed for that release while a newer release can notify again', async () => {
  const f = fixture();
  f.controller.start();
  await vi.waitFor(() => expect(f.registration.update).toHaveBeenCalledOnce());
  await f.ready();
  f.controller.later();
  await f.controller.check();
  expect(f.controller.getSnapshot().dismissed).toBe(true);
  await f.ready(laterRelease);
  expect(f.controller.getSnapshot().dismissed).toBe(false);
});

it('offline checks remain quiet and returning online discovers a release', async () => {
  const f = fixture();
  f.offline();
  f.controller.start();
  await f.controller.check();
  window.dispatchEvent(new Event('focus'));
  expect(f.workers.getRegistration).not.toHaveBeenCalled();
  expect(f.registration.update).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().phase).toBe('idle');
  f.online();
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(f.registration.update).toHaveBeenCalledOnce());
});

it('checks at a bounded interval and stops all discovery listeners on unmount', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.start();
  await f.controller.check();
  expect(f.registration.update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(APP_UPDATE_INTERVAL_MS);
  expect(f.registration.update).toHaveBeenCalledTimes(2);
  f.controller.stop();
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(APP_UPDATE_INTERVAL_MS);
  expect(f.registration.update).toHaveBeenCalledTimes(2);
});

it('coalesces overlapping checks and recovers from a hung network update', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.registration.update.mockImplementationOnce(() => new Promise(() => {}));
  f.controller.start();
  const pending = f.controller.check();
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(15000);
  await pending;
  expect(f.registration.update).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot().phase).toBe('idle');
  await f.controller.check();
  expect(f.registration.update).toHaveBeenCalledTimes(2);
});

it('waits for saved edits before activation and for controller ownership before reload', async () => {
  const f = fixture();
  f.controller.start();
  await f.controller.check();
  const worker = await f.ready();
  let saved!: () => void;
  const prepare = vi.fn(() => new Promise<void>((resolve) => (saved = resolve)));
  const reload = vi.fn();
  const applying = f.controller.apply(prepare, reload);
  expect(f.controller.getSnapshot().phase).toBe('applying');
  expect(
    worker.postMessage.mock.calls.some(([message]) => message.type === 'app-update-activate'),
  ).toBe(false);
  saved();
  await vi.waitFor(() =>
    expect(
      worker.postMessage.mock.calls.some(([message]) => message.type === 'app-update-activate'),
    ).toBe(true),
  );
  expect(reload).not.toHaveBeenCalled();
  f.workers.controller = worker;
  f.registration.waiting = null;
  f.workers.dispatchEvent(new Event('controllerchange'));
  await applying;
  expect(reload).toHaveBeenCalledOnce();
});

it('a failed save cannot activate or reload and can be retried', async () => {
  const f = fixture();
  f.controller.start();
  await f.controller.check();
  const worker = await f.ready();
  const reload = vi.fn();
  await f.controller.apply(async () => {
    throw new Error('Local storage is full.');
  }, reload);
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'error', error: expect.any(Error) });
  expect(
    worker.postMessage.mock.calls.some(([message]) => message.type === 'app-update-activate'),
  ).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  worker.onActivate = () => {
    f.workers.controller = worker;
    f.workers.dispatchEvent(new Event('controllerchange'));
  };
  await f.controller.apply(async () => {}, reload);
  expect(reload).toHaveBeenCalledOnce();
});

it('another tab activates without forcing this tab to reload or lose its edits', async () => {
  const f = fixture();
  f.controller.start();
  await f.controller.check();
  f.workers.controller = new Worker();
  f.workers.dispatchEvent(new Event('controllerchange'));
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'ready', changedElsewhere: true });
  const prepare = vi.fn(async () => {});
  const reload = vi.fn();
  expect(reload).not.toHaveBeenCalled();
  await f.controller.apply(prepare, reload);
  expect(prepare).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});

it('rejects a release replaced while edits were saving', async () => {
  const f = fixture();
  f.controller.start();
  await f.controller.check();
  const worker = await f.ready();
  const reload = vi.fn();
  await f.controller.apply(async () => {
    f.registration.waiting = new Worker(laterRelease);
  }, reload);
  expect(f.controller.getSnapshot().phase).toBe('error');
  expect(
    worker.postMessage.mock.calls.some(([message]) => message.type === 'app-update-activate'),
  ).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  const newer = f.registration.waiting!;
  newer.onActivate = () => {
    f.workers.controller = newer;
    f.workers.dispatchEvent(new Event('controllerchange'));
  };
  await f.controller.apply(async () => {}, reload);
  expect(reload).toHaveBeenCalledOnce();
  expect(
    newer.postMessage.mock.calls.some(
      ([message]) => message.type === 'app-update-activate' && message.version === laterRelease,
    ),
  ).toBe(true);
});

it('a late discovery after stopping cannot publish a notice', async () => {
  const f = fixture();
  f.controller.start();
  await f.controller.check();
  f.registration.waiting = new Worker();
  f.registration.dispatchEvent(new Event('updatefound'));
  f.controller.stop();
  await Promise.resolve();
  expect(f.controller.getSnapshot().phase).toBe('idle');
});
