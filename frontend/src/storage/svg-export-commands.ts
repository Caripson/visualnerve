import type { Repository } from './repository';
import { StorageError } from '../model/errors';
import { svgExportController } from '../export/svg-jobs';
import { SvgExportError, svgJobLimits, type SvgJobAuthority } from '../export/svg-job-types';
import { exchangeExportCapabilities } from './exchange-export-commands';

const idPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const chunkLimit = 1024 * 1024;
export const svgExportCapabilities = {
  version: 1,
  format: 'svg',
  execution: 'local-web-worker',
  scopes: ['complete', 'viewport', 'selected'],
  limits: { ...svgJobLimits, resultChunkCharacters: chunkLimit },
  resultOffsetUnit: 'utf-16-code-units',
  requiresOriginalSessionAndGrant: true,
  persistence: 'transient-memory',
  diagrams: exchangeExportCapabilities,
} as const;
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new StorageError(422, 'SVG export expects a JSON object.');
  return value as Record<string, unknown>;
}
function empty(value: unknown) {
  // The existing Go bridge represents absent command data as JSON null.
  if (value !== undefined && value !== null && Reflect.ownKeys(object(value)).length)
    throw new StorageError(422, 'This SVG command expects no arguments or an empty object.');
}
function number(query: URLSearchParams, key: string, fallback: number) {
  const values = query.getAll(key);
  if (values.length > 1 || (values.length && !/^\d+$/.test(values[0])))
    throw new StorageError(422, `SVG result ${key} must be a non-negative integer.`);
  const value = values.length ? Number(values[0]) : fallback;
  if (!Number.isSafeInteger(value))
    throw new StorageError(422, `SVG result ${key} exceeds the safe integer range.`);
  return value;
}
/** Jobs and downloads reuse the same renderer as the UI; the bridge carries bounded chunks. */
export class SvgExportCommands {
  constructor(
    private readonly repo: Repository,
    private readonly authorize: () => Promise<void>,
    private readonly createAuthority: () => Promise<SvgJobAuthority>,
  ) {}
  async request(path: string, method: string, data: unknown): Promise<unknown> {
    try {
      return await this.execute(path, method, data);
    } catch (error) {
      if (error instanceof SvgExportError) {
        const structured = new StorageError(error.status, error.message);
        Object.assign(structured, { code: error.code });
        throw structured;
      }
      throw error;
    }
  }
  private async execute(path: string, method: string, data: unknown) {
    const url = new URL(path, 'http://browser.local');
    const [namespace, collection, jobId, result, extra] = url.pathname.split('/').filter(Boolean);
    if (namespace !== 'exports') throw new StorageError(404, 'Unknown export endpoint.');
    await this.authorize();
    if (collection === 'capabilities' && !jobId && method === 'GET' && !url.search) {
      empty(data);
      return svgExportCapabilities;
    }
    if (collection !== 'svg' || extra) throw new StorageError(404, 'Unknown SVG export endpoint.');
    if (!jobId && method === 'POST' && !url.search) {
      const input = object(data);
      if (
        Reflect.ownKeys(input).some(
          (key) => typeof key !== 'string' || !['diagramId', 'scope', 'nodeIds'].includes(key),
        ) ||
        typeof input.diagramId !== 'string' ||
        !idPattern.test(input.diagramId) ||
        (input.scope !== undefined &&
          !['complete', 'viewport', 'selected'].includes(String(input.scope))) ||
        (input.nodeIds !== undefined && input.scope !== 'selected') ||
        (input.nodeIds !== undefined &&
          (!Array.isArray(input.nodeIds) ||
            input.nodeIds.length > svgJobLimits.nodes ||
            !input.nodeIds.every((id) => typeof id === 'string' && idPattern.test(id))))
      )
        throw new StorageError(
          422,
          'SVG export expects diagramId, optional scope and selected nodeIds.',
        );
      const graph = await this.repo.getGraph(input.diagramId);
      await this.authorize();
      const authority = await this.createAuthority();
      try {
        await authority.guard.check();
        await this.authorize();
        return svgExportController.start(
          graph,
          {
            scope: input.scope as 'complete' | 'viewport' | 'selected' | undefined,
            nodeIds: input.nodeIds as string[] | undefined,
          },
          authority,
        );
      } catch (error) {
        authority.dispose();
        throw error;
      }
    }
    if (!jobId || !idPattern.test(jobId)) throw new StorageError(404, 'Unknown SVG export job.');
    empty(data);
    if (!result && !url.search && method === 'GET')
      return svgExportController.status(jobId, this.authorize);
    if (!result && !url.search && method === 'DELETE')
      return svgExportController.cancel(jobId, this.authorize);
    if (result !== 'result' || method !== 'GET')
      throw new StorageError(404, 'Unknown SVG export endpoint.');
    if ([...url.searchParams.keys()].some((key) => !['offset', 'limit'].includes(key)))
      throw new StorageError(422, 'SVG result accepts only offset and limit.');
    const offset = number(url.searchParams, 'offset', 0);
    const limit = number(url.searchParams, 'limit', chunkLimit);
    if (limit < 1 || limit > chunkLimit)
      throw new StorageError(
        422,
        'SVG result limit must be between 1 and 1,048,576 UTF-16 code units.',
      );
    const svg = await svgExportController.result(jobId, this.authorize);
    if (
      offset > svg.length ||
      (offset > 0 &&
        /[\uDC00-\uDFFF]/.test(svg[offset] ?? '') &&
        /[\uD800-\uDBFF]/.test(svg[offset - 1]))
    )
      throw new StorageError(
        422,
        'SVG result offset must be within the result and at a Unicode character boundary.',
      );
    let nextOffset = Math.min(svg.length, offset + limit);
    if (
      nextOffset < svg.length &&
      /[\uD800-\uDBFF]/.test(svg[nextOffset - 1]) &&
      /[\uDC00-\uDFFF]/.test(svg[nextOffset])
    ) {
      if (nextOffset === offset + 1)
        throw new StorageError(422, 'Increase the chunk limit to include this Unicode character.');
      nextOffset--;
    }
    await this.authorize();
    return {
      jobId,
      offset,
      nextOffset,
      totalCharacters: svg.length,
      text: svg.slice(offset, nextOffset),
      complete: nextOffset === svg.length,
    };
  }
}
