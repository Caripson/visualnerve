import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import english from '../src/i18n/catalogs/en';
import german from '../src/i18n/catalogs/de';
import swedish from '../src/i18n/catalogs/sv';
import { AppLocaleController, APP_LOCALE_KEY } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { MessageFormatter } from '../src/i18n/message-formatter';
import { I18nProvider, useI18n } from '../src/i18n';
import { AppChromeRenderer } from '../src/i18n/app-chrome';
import { APP_LOCALES, type Catalog } from '../src/i18n/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function storage(saved: string | null = null) {
  const values = new Map<string, string>(saved === null ? [] : [[APP_LOCALE_KEY, saved]]);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function loader(
  overrides: Partial<
    Record<(typeof APP_LOCALES)[number]['id'], () => Promise<{ default: Catalog }>>
  > = {},
) {
  return new LocaleCatalogLoader({
    en: async () => ({ default: english }),
    da: async () => ({ default: english }),
    nb: async () => ({ default: english }),
    sv: async () => ({ default: swedish }),
    fi: async () => ({ default: english }),
    de: async () => ({ default: german }),
    es: async () => ({ default: english }),
    fr: async () => ({ default: english }),
    ...overrides,
  });
}

describe('technical language preference without a workspace lifecycle', () => {
  it('defaults to English even in a non-English browser, rejects invalid stored IDs and writes only the exact technical key', async () => {
    const preference = storage('javascript:alert(1)');
    const controller = new AppLocaleController(loader(), preference);
    expect(controller.getSnapshot().requestedLocale).toBe('en');
    await controller.start();
    expect(controller.getSnapshot().locale).toBe('en');
    expect(preference.setItem).not.toHaveBeenCalled();
    await controller.selectLocale('sv');
    expect(preference.setItem).toHaveBeenCalledExactlyOnceWith(APP_LOCALE_KEY, 'sv');
    expect(preference.getItem).toHaveBeenCalledExactlyOnceWith(APP_LOCALE_KEY);
    controller.dispose();
  });

  it('retains a chosen in-memory language when technical preference storage is blocked', async () => {
    const preference = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const controller = new AppLocaleController(loader(), preference);
    await controller.start();
    expect(await controller.selectLocale('de')).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      locale: 'de',
      persistenceError: true,
      error: null,
    });
    controller.dispose();
  });

  it('persists the latest human request before loading and never broadcasts a stale completion', async () => {
    const de = deferred<{ default: Catalog }>(),
      sv = deferred<{ default: Catalog }>();
    const preference = storage();
    const controller = new AppLocaleController(
      loader({ de: () => de.promise, sv: () => sv.promise }),
      preference,
    );
    await controller.start();
    const first = controller.selectLocale('de'),
      second = controller.selectLocale('sv');
    expect(preference.setItem.mock.calls).toEqual([
      [APP_LOCALE_KEY, 'de'],
      [APP_LOCALE_KEY, 'sv'],
    ]);
    de.resolve({ default: german });
    expect(await first).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      locale: 'en',
      requestedLocale: 'sv',
      loading: true,
    });
    sv.resolve({ default: swedish });
    expect(await second).toBe(true);
    expect(controller.getSnapshot().locale).toBe('sv');
    expect(preference.setItem).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('ignores stale failures and keeps a newer successful display snapshot', async () => {
    const de = deferred<{ default: Catalog }>();
    const controller = new AppLocaleController(loader({ de: () => de.promise }), storage());
    await controller.start();
    const first = controller.selectLocale('de');
    await controller.selectLocale('sv');
    de.reject(new Error('late network failure'));
    expect(await first).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ locale: 'sv', loading: false, error: null });
    controller.dispose();
  });

  it('updates another tab without echoing storage writes or listening to unrelated preferences', async () => {
    const preference = storage();
    const controller = new AppLocaleController(loader(), preference, window);
    await controller.start();
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'de' }));
    expect(controller.getSnapshot().locale).toBe('en');
    window.dispatchEvent(new StorageEvent('storage', { key: APP_LOCALE_KEY, newValue: 'sv' }));
    await waitFor(() => expect(controller.getSnapshot().locale).toBe('sv'));
    expect(preference.setItem).not.toHaveBeenCalled();
    controller.dispose();
    window.dispatchEvent(new StorageEvent('storage', { key: APP_LOCALE_KEY, newValue: 'de' }));
    expect(controller.getSnapshot().locale).toBe('sv');
  });

  it('keeps the current catalog after failure and lets a deliberate retry load again', async () => {
    const de = vi
      .fn()
      .mockRejectedValueOnce(new Error('missing chunk'))
      .mockResolvedValueOnce({ default: german });
    const controller = new AppLocaleController(loader({ de }), storage());
    await controller.start();
    const original = controller.getSnapshot().catalog;
    expect(await controller.selectLocale('de')).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      locale: 'en',
      requestedLocale: 'de',
      catalog: original,
      error: 'load-failed',
    });
    expect(await controller.retry()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ locale: 'de', error: null });
    expect(de).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('shares pending catalog imports and keeps snapshots stable when selecting the current display', async () => {
    const importer = vi.fn(async () => ({ default: english }));
    const catalogs = loader({ en: importer });
    expect(catalogs.load('en')).toBe(catalogs.load('en'));
    const controller = new AppLocaleController(catalogs, storage());
    await controller.start();
    const snapshot = controller.getSnapshot();
    const notify = vi.fn();
    controller.subscribe(notify);
    await controller.selectLocale('en');
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(notify).not.toHaveBeenCalled();
    expect(importer).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

describe('mounted app and safe rendering', () => {
  it('preserves form draft, focus and mounted lifecycle while a locale loads or fails', async () => {
    const de = deferred<{ default: Catalog }>();
    const controller = new AppLocaleController(loader({ de: () => de.promise }), storage());
    const mounted = vi.fn(),
      unmounted = vi.fn();
    function Form() {
      const { t } = useI18n();
      const [draft, setDraft] = useState('');
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return (
        <label>
          {t('common.settings')}
          <input
            aria-label="Authored draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      );
    }
    render(
      <I18nProvider controller={controller}>
        <Form />
      </I18nProvider>,
    );
    const input = await screen.findByLabelText('Authored draft');
    input.focus();
    fireEvent.change(input, { target: { value: 'Settings <script> is user content' } });
    await act(async () => {
      void controller.selectLocale('de');
      await Promise.resolve();
    });
    expect(input).toHaveValue('Settings <script> is user content');
    expect(input).toHaveFocus();
    await act(async () => {
      de.reject(new Error('offline'));
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Authored draft')).toBe(input);
    expect(input).toHaveFocus();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    await act(async () => {
      await controller.selectLocale('sv');
    });
    expect(screen.getByText('Inställningar')).toBeVisible();
    expect(screen.getByLabelText('Authored draft')).toBe(input);
    expect(document.documentElement.lang).toBe('sv');
    controller.dispose();
  });

  it('provides a usable initial-load failure and retries without ever mounting private children prematurely', async () => {
    const en = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default: english });
    const controller = new AppLocaleController(loader({ en }), storage());
    const mounted = vi.fn();
    function Surface() {
      useEffect(mounted, []);
      return <p>Protected surface</p>;
    }
    render(
      <I18nProvider controller={controller}>
        <Surface />
      </I18nProvider>,
    );
    expect(await screen.findByText('Language files could not be loaded.')).toBeVisible();
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Protected surface')).toBeVisible();
    expect(mounted).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('renders parameter text without interpreting HTML and never translates authored labels as message IDs', () => {
    const formatter = new MessageFormatter('sv', swedish);
    const name = '<img src=x onerror=alert(1)> Settings';
    render(<p>{formatter.t('overview.expandGroup', { name })}</p>);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> Settings/)).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('localizes only marked workspace header leaves, preserving icons, arrows, links and English reference pages', () => {
    const doc = document.implementation.createHTMLDocument('Workspace');
    doc.body.innerHTML =
      '<header data-app-chrome><a href="/help/"><svg></svg><span data-app-chrome-text="guide">Guide</span><span>↗</span></a><nav data-app-chrome-label="site" aria-label="Site"></nav><span data-app-chrome-text="unknown">Private title</span></header><div id="visual-nerve"></div>';
    const formatter = new MessageFormatter('sv', swedish);
    const icon = doc.querySelector('svg'),
      link = doc.querySelector('a');
    new AppChromeRenderer(doc).render(formatter.t);
    expect(doc.querySelector('[data-app-chrome-text="guide"]')?.textContent).toBe('Guide');
    expect(doc.querySelector('nav')?.getAttribute('aria-label')).toBe('Webbplats');
    expect(doc.querySelector('svg')).toBe(icon);
    expect(doc.querySelector('a')).toBe(link);
    expect(link?.getAttribute('href')).toBe('/help/');
    expect(link?.textContent).toContain('↗');
    expect(doc.querySelector('[data-app-chrome-text="unknown"]')?.textContent).toBe(
      'Private title',
    );
    doc.getElementById('visual-nerve')!.remove();
    doc.querySelector('nav')!.setAttribute('aria-label', 'Site');
    new AppChromeRenderer(doc).render(formatter.t);
    expect(doc.querySelector('nav')?.getAttribute('aria-label')).toBe('Site');
  });
});

describe('all app catalogs', () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
  for (const { id } of APP_LOCALES)
    it(`${id} has complete nonempty keys and identical named parameters`, async () => {
      const catalog = await new LocaleCatalogLoader().load(id);
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), key).not.toBe('');
        expect(placeholders(value), key).toEqual(
          placeholders(english[key as keyof typeof english]),
        );
      }
    });
});
