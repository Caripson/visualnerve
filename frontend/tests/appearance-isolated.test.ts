// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../hugo/static/appearance.js', import.meta.url), 'utf8');
const key = 'visualnerve-app-appearance';
type AppearanceAPI = { setPreference(value: unknown): void; refresh(): Promise<void> };
type EventCallback = (event?: { key?: string }) => void;

function isolatedPage({
  hostname = 'app.visualnerve.com',
  marker = false,
  saved,
  dark = false,
  blocked = false,
}: {
  hostname?: string;
  marker?: boolean;
  saved?: string;
  dark?: boolean;
  blocked?: boolean;
} = {}) {
  const values = new Map<string, string>(saved ? [[key, saved]] : []);
  const listeners = new Map<string, EventCallback>();
  const channels: { onmessage?: EventCallback }[] = [];
  const media = {
    matches: dark,
    addEventListener: vi.fn((_name: string, _callback: () => void) => undefined),
  };
  const localStorage = {
    getItem: vi.fn((name: string) => {
      if (blocked) throw new Error('Browser storage is unavailable.');
      return values.get(name) ?? null;
    }),
    setItem: vi.fn((name: string, value: string) => {
      if (blocked) throw new Error('Browser storage is unavailable.');
      values.set(name, value);
    }),
  };
  const open = vi.fn(() => {
    throw new Error('Reference pages must never open private workspace storage.');
  });
  const document = {
    documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> },
    visibilityState: 'visible',
    querySelector: vi.fn(() => (marker ? { content: 'true' } : null)),
    querySelectorAll: () => [],
    addEventListener: vi.fn(),
  };
  const window = {
    location: { hostname },
    indexedDB: { open },
    localStorage,
    matchMedia: vi.fn(() => media),
    addEventListener: (name: string, callback: EventCallback) => listeners.set(name, callback),
    BroadcastChannel: class {
      onmessage?: EventCallback;
      constructor() {
        channels.push(this);
      }
    },
    visualNerveAppearance: undefined as AppearanceAPI | undefined,
  };
  runInNewContext(source, { window, document });
  return {
    api: window.visualNerveAppearance!,
    root: document.documentElement,
    values,
    localStorage,
    open,
    media,
    listeners,
    channels,
  };
}

describe('isolated app reference-page appearance', () => {
  it.each([
    { hostname: 'app.visualnerve.com', marker: false },
    { hostname: '127.0.0.1', marker: true },
  ])(
    'uses harmless origin-local appearance without opening either private database (%j)',
    async (identity) => {
      const page = isolatedPage({ ...identity, saved: 'dark' });
      await page.api.refresh();
      expect(page.root.dataset.theme).toBe('dark');
      expect(page.root.style.colorScheme).toBe('dark');
      expect(page.localStorage.getItem).toHaveBeenCalledWith(key);
      expect(page.open).not.toHaveBeenCalled();
    },
  );

  it('defaults to System while locked and follows later system changes', async () => {
    const page = isolatedPage({ dark: true });
    await page.api.refresh();
    expect(page.root.dataset.theme).toBe('dark');
    page.media.matches = false;
    page.media.addEventListener.mock.calls[0][1]();
    expect(page.root.dataset.theme).toBe('light');
    expect(page.localStorage.setItem).not.toHaveBeenCalled();
    expect(page.open).not.toHaveBeenCalled();
  });

  it('persists only normalized appearance, and refreshes it across app-origin tabs', async () => {
    const page = isolatedPage();
    page.api.setPreference('dark');
    expect(page.localStorage.setItem).toHaveBeenLastCalledWith(key, 'dark');
    expect(page.root.dataset.theme).toBe('dark');
    page.values.set(key, 'light');
    page.listeners.get('storage')?.({ key: 'unrelated-preference' });
    expect(page.root.dataset.theme).toBe('dark');
    page.listeners.get('storage')?.({ key });
    expect(page.root.dataset.theme).toBe('light');
    page.values.set(key, 'dark');
    page.channels[0].onmessage?.();
    expect(page.root.dataset.theme).toBe('dark');
    page.api.setPreference({ notAnAppearance: 'private document text' });
    expect(page.localStorage.setItem).toHaveBeenLastCalledWith(key, 'system');
    expect([...page.values.keys()]).toEqual([key]);
    expect(page.values.get(key)).toBe('system');
    expect(page.open).not.toHaveBeenCalled();
  });

  it('keeps a usable System shell when harmless localStorage is blocked, without trying a plaintext fallback', async () => {
    const page = isolatedPage({ blocked: true, dark: true });
    await page.api.refresh();
    expect(page.root.dataset.theme).toBe('dark');
    expect(() => page.api.setPreference('light')).not.toThrow();
    expect(page.root.dataset.theme).toBe('light');
    await page.api.refresh();
    expect(page.root.dataset.theme).toBe('dark');
    expect(page.open).not.toHaveBeenCalled();
  });
});
