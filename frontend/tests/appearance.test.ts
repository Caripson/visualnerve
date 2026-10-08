// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory, IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../hugo/static/appearance.js', import.meta.url), 'utf8');
const databaseName = 'visual-nerve-cache';

type AppearanceAPI = { setPreference(value: unknown): void; refresh(): Promise<void> };
type Callback = () => void;
type ReadRequest = {
  result?: unknown;
  transaction?: { abort(): void };
  onsuccess?: Callback;
  onerror?: Callback;
  onblocked?: Callback;
  onupgradeneeded?: Callback;
};

function surface(database: Pick<IDBFactory, 'open'>, dark = false, messaging = true) {
  const mediaListeners: Callback[] = [],
    windowListeners = new Map<string, Callback>(),
    documentListeners = new Map<string, Callback>(),
    channels: { onmessage?: Callback }[] = [];
  const images = {
    sources: [] as { media: string }[],
    links: [] as { href: string; dataset: { appearanceLink: string; appearanceDark: string } }[],
  };
  const media = {
    matches: dark,
    addEventListener: (_: string, callback: Callback) => mediaListeners.push(callback),
  };
  const document = {
    documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> },
    visibilityState: 'visible',
    addEventListener: (name: string, callback: Callback) => documentListeners.set(name, callback),
    querySelectorAll: (selector: string) =>
      selector.includes('source') ? images.sources : images.links,
  };
  const window = {
    indexedDB: database,
    matchMedia: vi.fn(() => media),
    addEventListener: (name: string, callback: Callback) => windowListeners.set(name, callback),
    BroadcastChannel: class {
      onmessage?: Callback;
      constructor(name: string) {
        if (!messaging) throw new Error('Messaging is unavailable');
        expect(name).toBe('visual-nerve-appearance');
        channels.push(this);
      }
    },
    visualNerveAppearance: undefined as AppearanceAPI | undefined,
  };
  runInNewContext(source, { window, document });
  return {
    api: window.visualNerveAppearance!,
    root: document.documentElement,
    images,
    ready: () => documentListeners.get('DOMContentLoaded')?.(),
    media(dark: boolean) {
      media.matches = dark;
      for (const callback of mediaListeners) callback();
    },
    focus: () => windowListeners.get('focus')?.(),
    pageshow: () => windowListeners.get('pageshow')?.(),
    visibility(visible: boolean) {
      document.visibilityState = visible ? 'visible' : 'hidden';
      documentListeners.get('visibilitychange')?.();
    },
    broadcast: () => channels[0]?.onmessage?.(),
  };
}

it('selects screenshot sources and full-size links by the saved preference, including images parsed after the head script', async () => {
  const factory = new IDBFactory();
  await seed(factory, [
    { key: 'storage-consent', value: true },
    { key: 'theme', value: 'dark' },
  ]);
  const page = surface(factory, false);
  await page.api.refresh();
  // The script runs in head; the browser has not parsed the picture and its anchor yet.
  const source = { media: '(prefers-color-scheme: dark)' };
  const link = {
    href: '/help/images/editor.webp',
    dataset: {
      appearanceLink: '/help/images/editor.webp',
      appearanceDark: '/help/images/editor-dark.webp',
    },
  };
  page.images.sources.push(source);
  page.images.links.push(link);
  page.ready();
  expect(source.media).toBe('all');
  expect(link.href).toBe('/help/images/editor-dark.webp');
  page.media(true);
  page.api.setPreference('light');
  expect(source.media).toBe('not all');
  expect(link.href).toBe('/help/images/editor.webp');
  page.api.setPreference('system');
  expect(source.media).toBe('all');
  expect(link.href).toBe('/help/images/editor-dark.webp');
  page.media(false);
  expect(source.media).toBe('not all');
  expect(link.href).toBe('/help/images/editor.webp');
  expect((await factory.databases()).map(({ name }) => name)).toEqual([databaseName]);
});

async function seed(
  factory: IDBFactory,
  preferences: { key: string; value: unknown }[],
  version = 3,
  settings = true,
) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(databaseName, version);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('diagrams', { keyPath: 'id' });
      if (settings) request.result.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([...db.objectStoreNames], 'readwrite');
      transaction
        .objectStore('diagrams')
        .put({ id: 'private-diagram', content: 'Private workspace content' });
      if (settings)
        for (const preference of preferences) transaction.objectStore('settings').put(preference);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}

function controlledStorage() {
  const requests: ReadRequest[] = [];
  const open = vi.fn(() => {
    const request: ReadRequest = {};
    requests.push(request);
    return request as unknown as IDBOpenDBRequest;
  });
  return { storage: { open }, requests };
}

function complete(request: ReadRequest, theme: unknown, consent: unknown = true) {
  const transaction = {
    oncomplete: undefined as Callback | undefined,
    onabort: undefined as Callback | undefined,
    onerror: undefined as Callback | undefined,
    objectStore: () => ({
      get: (key: string) => ({ result: { key, value: key === 'theme' ? theme : consent } }),
    }),
  };
  const db = {
    close: vi.fn(),
    objectStoreNames: { contains: () => true },
    transaction: vi.fn(() => transaction),
  };
  request.result = db;
  request.onsuccess!();
  transaction.oncomplete!();
  return db;
}

afterEach(() => vi.restoreAllMocks());

it('does not create a missing IndexedDB database while applying and updating System appearance', async () => {
  const factory = new IDBFactory();
  const page = surface(factory, true);
  expect(page.root.dataset.theme).toBe('dark');
  await page.api.refresh();
  expect(await factory.databases()).toEqual([]);
  expect(page.root.style.colorScheme).toBe('dark');
  page.media(false);
  expect(page.root.dataset.theme).toBe('light');
  page.media(true);
  expect(page.root.dataset.theme).toBe('dark');
  expect(await factory.databases()).toEqual([]);
});

it.each(['light', 'dark'] as const)(
  'keeps explicit %s appearance fixed despite operating-system changes',
  async (theme) => {
    const factory = new IDBFactory();
    const page = surface(factory);
    await page.api.refresh();
    page.api.setPreference(theme);
    page.media(true);
    expect(page.root.dataset.theme).toBe(theme);
    page.media(false);
    expect(page.root.dataset.theme).toBe(theme);
    expect(page.root.style.colorScheme).toBe(theme);
    expect(await factory.databases()).toEqual([]);
  },
);

it.each([
  { theme: 'dark', consent: true, expected: 'dark' },
  { theme: 'light', consent: true, expected: 'light' },
  { theme: 'system', consent: true, expected: 'dark' },
  { theme: 'unknown', consent: true, expected: 'dark' },
  { theme: 'light', consent: false, expected: 'dark' },
  { theme: 'light', consent: 'true', expected: 'dark' },
  { theme: 'light', consent: undefined, expected: 'dark' },
])(
  'reads only consented existing preferences: $theme, consent $consent → $expected',
  async ({ theme, consent, expected }) => {
    const factory = new IDBFactory();
    await seed(factory, [
      { key: 'theme', value: theme },
      ...(consent === undefined ? [] : [{ key: 'storage-consent', value: consent }]),
    ]);
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const reads = vi.spyOn(IDBObjectStore.prototype, 'get');
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    const page = surface(factory, true);
    await page.api.refresh();
    expect(page.root.dataset.theme).toBe(expected);
    expect(transactions.mock.calls.length).toBeGreaterThan(0);
    expect(
      transactions.mock.calls.every(
        ([stores, mode]) => stores === 'settings' && mode === 'readonly',
      ),
    ).toBe(true);
    expect(reads.mock.calls.every(([key]) => key === 'theme' || key === 'storage-consent')).toBe(
      true,
    );
    expect(reads.mock.calls.map(([key]) => key)).toContain('storage-consent');
    expect(writes).not.toHaveBeenCalled();
    expect(await factory.databases()).toEqual([{ name: databaseName, version: 3 }]);
  },
);

it('does not migrate an old database lacking the settings store or read diagrams', async () => {
  const factory = new IDBFactory();
  await seed(factory, [], 2, false);
  const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const page = surface(factory, true);
  await page.api.refresh();
  expect(page.root.dataset.theme).toBe('dark');
  expect(transactions).not.toHaveBeenCalled();
  expect(await factory.databases()).toEqual([{ name: databaseName, version: 2 }]);
});

it('a pending storage refresh cannot overwrite a later explicit preference', async () => {
  const { storage, requests } = controlledStorage();
  const page = surface(storage);
  page.api.setPreference('light');
  complete(requests[0], 'dark');
  expect(page.root.dataset.theme).toBe('light');
  const pending = page.api.refresh();
  page.api.setPreference('dark');
  complete(requests[1], 'light');
  await pending;
  expect(page.root.dataset.theme).toBe('dark');
});

it('a stale refresh cannot overwrite the result of a newer refresh', async () => {
  const { storage, requests } = controlledStorage();
  const page = surface(storage);
  const newest = page.api.refresh();
  complete(requests[1], 'dark');
  await newest;
  complete(requests[0], 'light');
  expect(page.root.dataset.theme).toBe('dark');
});

it('refreshes through cross-tab messages, focus, pageshow, and visible pages only', async () => {
  const { storage, requests } = controlledStorage();
  const page = surface(storage);
  complete(requests[0], 'dark');
  const refreshTriggers = [page.broadcast, page.focus, page.pageshow, () => page.visibility(true)];
  for (const trigger of refreshTriggers) {
    const before = requests.length;
    trigger();
    expect(requests).toHaveLength(before + 1);
    complete(requests.at(-1)!, before % 2 ? 'light' : 'dark');
  }
  const before = requests.length;
  page.visibility(false);
  expect(requests).toHaveLength(before);
});

it('continues with System appearance when storage and cross-tab messaging are denied', async () => {
  const open = vi.fn(() => {
    throw new Error('Storage access denied');
  });
  const page = surface({ open }, true, false);
  await page.api.refresh();
  expect(page.root.dataset.theme).toBe('dark');
  page.media(false);
  expect(page.root.dataset.theme).toBe('light');
  page.api.setPreference('dark');
  expect(page.root.dataset.theme).toBe('dark');
});

it.each(['error', 'blocked'] as const)(
  'safely resolves a storage open %s with System appearance',
  async (event) => {
    const { storage, requests } = controlledStorage();
    const page = surface(storage, true);
    const pending = page.api.refresh();
    const callback = event === 'error' ? requests[1].onerror : requests[1].onblocked;
    expect(callback).toBeTypeOf('function');
    callback!();
    await pending;
    expect(page.root.dataset.theme).toBe('dark');
    page.media(false);
    expect(page.root.dataset.theme).toBe('light');
  },
);

it.each(['transaction', 'read'] as const)(
  'safely resolves when a database %s throws after opening',
  async (phase) => {
    const { storage, requests } = controlledStorage();
    const page = surface(storage, true);
    const pending = page.api.refresh();
    const db = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      transaction: () => {
        if (phase === 'transaction') throw new Error('Database is closing');
        return {
          objectStore: () => ({
            get: () => {
              throw new Error('Storage read denied');
            },
          }),
        };
      },
    };
    requests[1].result = db;
    expect(() => requests[1].onsuccess!()).not.toThrow();
    await pending;
    expect(page.root.dataset.theme).toBe('dark');
    expect(db.close).toHaveBeenCalled();
  },
);
