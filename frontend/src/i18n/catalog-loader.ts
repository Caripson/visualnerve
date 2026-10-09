import type { AppLocale, Catalog } from './types';

const imports: Record<AppLocale, () => Promise<{ default: Catalog }>> = {
  en: () => import('./catalogs/en'),
  da: () => import('./catalogs/da'),
  nb: () => import('./catalogs/nb'),
  sv: () => import('./catalogs/sv'),
  fi: () => import('./catalogs/fi'),
  de: () => import('./catalogs/de'),
  es: () => import('./catalogs/es'),
  fr: () => import('./catalogs/fr'),
};

/** Only public, allowlisted display data crosses this lazy module boundary. */
export class LocaleCatalogLoader {
  private readonly pending = new Map<AppLocale, Promise<Catalog>>();

  constructor(private readonly importers = imports) {}

  load(locale: AppLocale): Promise<Catalog> {
    const existing = this.pending.get(locale);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(() => this.importers[locale]())
      .then(({ default: catalog }) => Object.freeze(catalog));
    this.pending.set(locale, promise);
    void promise.catch(() => {
      if (this.pending.get(locale) === promise) this.pending.delete(locale);
    });
    return promise;
  }
}
