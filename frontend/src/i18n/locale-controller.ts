import { LocaleCatalogLoader } from './catalog-loader';
import { isAppLocale, type AppLocale, type Catalog } from './types';

export const APP_LOCALE_KEY = 'visualnerve-app-language';

export interface LocaleSnapshot {
  readonly locale: AppLocale;
  readonly requestedLocale: AppLocale;
  readonly catalog: Catalog | null;
  readonly loading: boolean;
  readonly error: 'load-failed' | null;
  readonly persistenceError: boolean;
}

type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;
type LocaleEvents = Pick<Window, 'addEventListener' | 'removeEventListener'>;

function browserStorage(): LocaleStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Locale is technical metadata. This class never opens or renews a workspace. */
export class AppLocaleController {
  private readonly listeners = new Set<() => void>();
  private snapshot: LocaleSnapshot;
  private generation = 0;
  private started = false;
  private pending: Promise<boolean> | undefined;
  private readonly onStorage = (event: Event) => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key !== APP_LOCALE_KEY) return;
    if (storageEvent.storageArea && storageEvent.storageArea !== this.storage) return;
    const locale = isAppLocale(storageEvent.newValue) ? storageEvent.newValue : 'en';
    void this.request(locale, false);
  };

  constructor(
    private readonly loader = new LocaleCatalogLoader(),
    private readonly storage: LocaleStorage | undefined = browserStorage(),
    private readonly events: LocaleEvents | undefined = typeof window === 'undefined'
      ? undefined
      : window,
  ) {
    let saved: unknown;
    try {
      saved = storage?.getItem(APP_LOCALE_KEY);
    } catch {
      /* English remains usable. */
    }
    this.snapshot = Object.freeze({
      locale: 'en',
      requestedLocale: isAppLocale(saved) ? saved : 'en',
      catalog: null,
      loading: false,
      error: null,
      persistenceError: false,
    });
  }

  getSnapshot = (): LocaleSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start = (): Promise<boolean> => {
    if (!this.started) {
      this.started = true;
      this.events?.addEventListener('storage', this.onStorage);
    }
    return this.request(this.snapshot.requestedLocale, false);
  };

  selectLocale = (locale: AppLocale): Promise<boolean> => this.request(locale, true);
  retry = (): Promise<boolean> => this.request(this.snapshot.requestedLocale, false);

  dispose() {
    ++this.generation;
    this.events?.removeEventListener('storage', this.onStorage);
    this.started = false;
    this.pending = undefined;
  }

  private publish(next: Partial<LocaleSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...next });
    for (const listener of this.listeners) listener();
  }

  private request(locale: AppLocale, persist: boolean): Promise<boolean> {
    if (!isAppLocale(locale)) return Promise.resolve(false);
    // Persist the requested choice before asynchronous loading. A stale completion
    // can never broadcast an older preference into another tab.
    if (persist) {
      let persistenceError = false;
      try {
        if (!this.storage) throw new Error('Unavailable technical preference storage');
        this.storage.setItem(APP_LOCALE_KEY, locale);
      } catch {
        persistenceError = true;
      }
      if (persistenceError !== this.snapshot.persistenceError) this.publish({ persistenceError });
    }
    if (this.snapshot.loading && this.snapshot.requestedLocale === locale && this.pending)
      return this.pending;
    if (
      !this.snapshot.loading &&
      this.snapshot.locale === locale &&
      this.snapshot.catalog &&
      !this.snapshot.error
    ) {
      if (this.snapshot.requestedLocale !== locale) this.publish({ requestedLocale: locale });
      return Promise.resolve(true);
    }
    const generation = ++this.generation;
    this.publish({ requestedLocale: locale, loading: true, error: null });
    const promise = this.loader.load(locale).then(
      (catalog) => {
        if (generation !== this.generation) return false;
        this.publish({ locale, catalog, loading: false, error: null });
        return true;
      },
      () => {
        if (generation !== this.generation) return false;
        this.publish({ loading: false, error: 'load-failed' });
        return false;
      },
    );
    this.pending = promise;
    return promise;
  }
}
