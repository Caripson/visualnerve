import type { Repository } from './repository';
import { StorageError } from '../model/errors';
import { exchangeExportController } from '../export/exchange-jobs';
import { ExchangeExportError, exchangeLimits, type ExchangeFormat } from '../export/exchange-types';
import type { SvgJobAuthority } from '../export/svg-job-types';

const idPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const chunkLimit = 786_432;
export const exchangeExportCapabilities = {
  version: 1,
  execution: 'local-web-worker',
  scopes: ['complete', 'selected'],
  formats: {
    drawio: { editable: true, validation: 'format-and-drawio' },
  },
  limits: { ...exchangeLimits, resultChunkBytes: chunkLimit },
  resultOffsetUnit: 'bytes',
  resultEncoding: 'base64',
  requiresOriginalSessionAndGrant: true,
  persistence: 'transient-memory',
} as const;

function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new StorageError(422, 'Editable diagram export expects a JSON object.');
  return value as Record<string, unknown>;
}
function empty(value: unknown) {
  if (value !== undefined && value !== null && Reflect.ownKeys(object(value)).length)
    throw new StorageError(
      422,
      'This editable diagram export command expects no arguments or an empty object.',
    );
}
function integer(query: URLSearchParams, key: string, fallback: number) {
  const values = query.getAll(key);
  if (values.length > 1 || (values.length && !/^\d+$/.test(values[0])))
    throw new StorageError(422, `Diagram result ${key} must be a non-negative integer.`);
  const value = values.length ? Number(values[0]) : fallback;
  if (!Number.isSafeInteger(value))
    throw new StorageError(422, `Diagram result ${key} exceeds the safe integer range.`);
  return value;
}
function base64(bytes: Uint8Array): string {
  const blocks: string[] = [];
  for (let start = 0; start < bytes.length; start += 32_768)
    blocks.push(String.fromCharCode(...bytes.subarray(start, start + 32_768)));
  return btoa(blocks.join(''));
}

/** Diagram exchange jobs retain the original authority and expose only bounded binary chunks. */
export class ExchangeExportCommands {
  constructor(
    private readonly repo: Repository,
    private readonly authorize: () => Promise<void>,
    private readonly createAuthority: () => Promise<SvgJobAuthority>,
  ) {}
  async request(path: string, method: string, data: unknown): Promise<unknown> {
    try {
      return await this.execute(path, method, data);
    } catch (error) {
      if (error instanceof ExchangeExportError) {
        const structured = new StorageError(error.status, error.message);
        Object.assign(structured, { code: error.code });
        throw structured;
      }
      throw error;
    }
  }
  private async execute(path: string, method: string, data: unknown) {
    const url = new URL(path, 'http://browser.local');
    if (url.hash)
      throw new StorageError(422, 'Editable diagram export paths cannot contain fragments.');
    await this.authorize();
    if (url.pathname === '/exports/diagrams' && method === 'POST') {
      if (url.search)
        throw new StorageError(422, 'Diagram export creation accepts no query parameters.');
      const input = object(data);
      if (
        Reflect.ownKeys(input).some(
          (key) =>
            typeof key !== 'string' || !['diagramId', 'format', 'scope', 'nodeIds'].includes(key),
        ) ||
        typeof input.diagramId !== 'string' ||
        !idPattern.test(input.diagramId) ||
        input.format !== 'drawio' ||
        (input.scope !== undefined &&
          (typeof input.scope !== 'string' || !['complete', 'selected'].includes(input.scope))) ||
        (input.nodeIds !== undefined && input.scope !== 'selected') ||
        (input.scope === 'selected' &&
          (!Array.isArray(input.nodeIds) ||
            !input.nodeIds.length ||
            input.nodeIds.length > exchangeLimits.nodes ||
            !input.nodeIds.every((id) => typeof id === 'string' && idPattern.test(id)) ||
            new Set(input.nodeIds).size !== input.nodeIds.length))
      )
        throw new StorageError(
          422,
          'Editable diagram export expects diagramId, format drawio, optional scope and unique selected nodeIds.',
        );
      const graph = await this.repo.getGraph(input.diagramId);
      if (input.scope === 'selected') {
        const ids = new Set(graph.nodes.map((node) => node.id));
        if ((input.nodeIds as string[]).some((id) => !ids.has(id)))
          throw new StorageError(422, 'Selected nodeIds must identify existing diagram nodes.');
      }
      await this.authorize();
      const authority = await this.createAuthority();
      try {
        await authority.guard.check();
        await this.authorize();
        return exchangeExportController.start(
          graph,
          input.format as ExchangeFormat,
          {
            scope: input.scope as 'complete' | 'selected' | undefined,
            nodeIds: input.nodeIds as string[] | undefined,
          },
          authority,
        );
      } catch (error) {
        authority.dispose();
        throw error;
      }
    }
    const parts = url.pathname.split('/');
    const jobId = parts[3];
    if (
      parts[1] !== 'exports' ||
      parts[2] !== 'diagrams' ||
      !idPattern.test(jobId ?? '') ||
      (url.pathname !== `/exports/diagrams/${jobId}` &&
        url.pathname !== `/exports/diagrams/${jobId}/result`)
    )
      throw new StorageError(404, 'Unknown editable diagram export endpoint.');
    empty(data);
    if (parts.length === 4 && url.search)
      throw new StorageError(
        422,
        'Diagram export status and cancellation accept no query parameters.',
      );
    if (parts.length === 4 && !url.search && method === 'GET')
      return exchangeExportController.status(jobId, this.authorize);
    if (parts.length === 4 && !url.search && method === 'DELETE')
      return exchangeExportController.cancel(jobId, this.authorize);
    if (parts[4] !== 'result' || method !== 'GET')
      throw new StorageError(404, 'Unknown editable diagram export endpoint.');
    if ([...url.searchParams.keys()].some((key) => !['offset', 'limit'].includes(key)))
      throw new StorageError(422, 'Diagram result accepts only offset and limit.');
    const offset = integer(url.searchParams, 'offset', 0);
    const limit = integer(url.searchParams, 'limit', chunkLimit);
    if (limit < 1 || limit > chunkLimit)
      throw new StorageError(422, 'Diagram result limit must be between 1 and 786,432 bytes.');
    const result = await exchangeExportController.result(jobId, this.authorize);
    if (offset > result.bytes.length)
      throw new StorageError(422, 'Diagram result offset must be within the binary result.');
    const nextOffset = Math.min(result.bytes.length, offset + limit);
    const encoded = base64(result.bytes.subarray(offset, nextOffset));
    await this.authorize();
    return {
      jobId,
      format: result.format,
      mimeType: result.mimeType,
      encoding: 'base64',
      offset,
      nextOffset,
      totalBytes: result.bytes.length,
      data: encoded,
      complete: nextOffset === result.bytes.length,
      warnings: result.warnings,
    };
  }
}
