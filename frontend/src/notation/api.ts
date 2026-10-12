import { StorageError } from '../model/errors';
import {
  notationCollections,
  notationSymbols,
  notationEdgeSymbols,
  getNotationCollection,
} from './registry';

/** Public catalogs contain no workspace content and can be discovered while locked. */
export function notationDiscovery(path: string, method: string): unknown {
  const url = new URL(path, 'http://browser.local');
  const parts = url.pathname.split('/').filter(Boolean);
  if (
    url.search ||
    url.hash ||
    parts[0] !== 'notation' ||
    parts[1] !== 'collections' ||
    parts.length > 4
  )
    throw new StorageError(404, 'Unknown notation discovery endpoint.');
  if (method !== 'GET') throw new StorageError(405, 'Notation discovery accepts GET only.');
  if (parts.length === 2) return structuredClone(notationCollections);
  const collection = getNotationCollection(parts[2]);
  if (!collection) throw new StorageError(404, 'Unknown notation collection.');
  const symbols = notationSymbols.filter((item) => item.collection === collection.id);
  const connectors = notationEdgeSymbols.filter((item) => item.collection === collection.id);
  if (parts.length === 3)
    return structuredClone({
      ...collection,
      schemaVersion: 1,
      capability: 'standard-notations-v1',
      symbols,
      connectors,
    });
  if (parts[3] === 'symbols') return structuredClone(symbols);
  if (parts[3] === 'connectors') return structuredClone(connectors);
  throw new StorageError(404, 'Unknown notation catalog endpoint.');
}
