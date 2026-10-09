import type { AppLocale, Catalog, MessageId, MessageParameters, Translate } from './types';

/** Formatting is restricted to display; canonical values and user content stay intact. */
export class MessageFormatter {
  private readonly pluralRules: Intl.PluralRules;
  private readonly numbers = new Map<string, Intl.NumberFormat>();
  private readonly dates = new Map<string, Intl.DateTimeFormat>();

  constructor(
    readonly locale: AppLocale,
    private readonly catalog: Catalog,
  ) {
    this.pluralRules = new Intl.PluralRules(locale);
  }

  t: Translate = (id, parameters = {}) => {
    const template = this.catalog[id];
    if (typeof template !== 'string') throw new Error(`Unknown UI message: ${id}`);
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const value = parameters[name];
      if (value === undefined) throw new Error(`Missing UI message parameter: ${id}.${name}`);
      return String(value);
    });
  };

  plural = (one: MessageId, other: MessageId, count: number, parameters: MessageParameters = {}) =>
    this.t(this.pluralRules.select(count) === 'one' ? one : other, { ...parameters, count });

  number = (value: number, options: Intl.NumberFormatOptions = {}) => {
    const key = JSON.stringify(options);
    let formatter = this.numbers.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(this.locale, options);
      this.numbers.set(key, formatter);
    }
    return formatter.format(value);
  };

  date = (value: Date | number | string, options: Intl.DateTimeFormatOptions = {}) => {
    const key = JSON.stringify(options);
    let formatter = this.dates.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(this.locale, options);
      this.dates.set(key, formatter);
    }
    return formatter.format(typeof value === 'string' ? new Date(value) : value);
  };
}
