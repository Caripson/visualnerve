import type english from './catalogs/en';

export const APP_LOCALES = [
  { id: 'en', name: 'English' },
  { id: 'da', name: 'Dansk' },
  { id: 'nb', name: 'Norsk bokmål' },
  { id: 'sv', name: 'Svenska' },
  { id: 'fi', name: 'Suomi' },
  { id: 'de', name: 'Deutsch' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
] as const;

export type AppLocale = (typeof APP_LOCALES)[number]['id'];
export type MessageId = keyof typeof english;
export type Catalog = Readonly<Record<MessageId, string>>;
export type MessageParameters = Readonly<Record<string, string | number>>;
export type Translate = (id: MessageId, parameters?: MessageParameters) => string;

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && APP_LOCALES.some(({ id }) => id === value);
}
