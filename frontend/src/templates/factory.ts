import type { Graph } from '../model/types';
export type TemplateFactory = (key: string, name: string, source?: Graph) => Graph;
let factory: TemplateFactory | undefined;
let loading: Promise<TemplateFactory> | undefined;
/** Prepare before opening a native IndexedDB transaction; nested seeds reuse the loaded factory. */
export function prepareTemplateFactory(): Promise<TemplateFactory> {
  if (factory) return Promise.resolve(factory);
  return (loading ??= import('./templates')
    .then((module) => (factory = module.instantiate))
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}
export function preparedTemplateFactory(): TemplateFactory {
  if (!factory)
    throw new Error('Prepare built-in templates before initializing a workspace transaction.');
  return factory;
}
