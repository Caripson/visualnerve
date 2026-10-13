import { RobloxError } from '../roblox/errors';
import { robloxBuildLimits, robloxBuildService } from '../roblox/build-service';
import { registerRobloxCleanup } from '../roblox/lifecycle';
import type { GameDefinition, RobloxBuild } from '../roblox/types';
import type { AnalyticsJobAuthority } from './analytics-api-jobs';

export interface RobloxJobState {
  jobId: string;
  diagramId: string;
  baseVersion: number;
  engineVersion: '1.0.0';
  schemaVersion: 1;
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  error?: { code: string; message: string };
}
export interface RobloxBuildManifest {
  jobId: string;
  diagramId: string;
  baseVersion: number;
  engineVersion: '1.0.0';
  objects: number;
  rules: number;
  artifacts: { name: string; mimeType: string; totalBytes: number; sha256: string }[];
}
interface Entry {
  status: RobloxJobState;
  manifest?: RobloxBuildManifest;
  artifacts?: Map<string, Uint8Array>;
  bytes: number;
  authority: AnalyticsJobAuthority;
  controller: AbortController;
  abort: () => void;
  expiry: ReturnType<typeof setTimeout>;
}
export function gameBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
export async function gameDigest(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
/** Private transient artifacts retain the original vault and grant, never a refreshed lease. */
export class RobloxApiJobs {
  private entries = new Map<string, Entry>();
  constructor(
    private execute = (
      game: GameDefinition,
      options: Parameters<typeof robloxBuildService.build>[1],
    ): Promise<RobloxBuild> => robloxBuildService.build(game, options),
    private now = () => new Date().toISOString(),
  ) {}
  async start(
    diagramId: string,
    baseVersion: number,
    game: GameDefinition,
    authority: AnalyticsJobAuthority,
  ): Promise<RobloxJobState> {
    await authority.guard.check();
    if (
      [...this.entries.values()].filter((entry) => entry.status.state === 'running').length >=
      robloxBuildLimits.active
    ) {
      authority.dispose();
      throw new RobloxError(429, 'Two Roblox builds are already running.', 'ROBLOX_BUILD_BUSY');
    }
    const jobId = crypto.randomUUID();
    const status: RobloxJobState = {
      jobId,
      diagramId,
      baseVersion,
      schemaVersion: 1,
      engineVersion: '1.0.0',
      state: 'running',
      progress: 0,
      createdAt: this.now(),
    };
    const abort = () => this.erase(jobId);
    const entry: Entry = {
      status,
      authority,
      controller: new AbortController(),
      bytes: 0,
      abort,
      expiry: setTimeout(abort, robloxBuildLimits.retentionMs),
    };
    this.entries.set(jobId, entry);
    authority.guard.signal.addEventListener('abort', abort, { once: true });
    const original = structuredClone(game);
    const check = async () => {
      entry.controller.signal.throwIfAborted();
      await authority.guard.check();
      entry.controller.signal.throwIfAborted();
    };
    void (async () => {
      try {
        const build = await this.execute(original, {
          guard: authority.guard,
          signal: entry.controller.signal,
          progress: (progress) => {
            entry.status.progress = Math.min(99, Math.max(0, progress));
          },
        });
        await check();
        const artifacts = new Map<string, Uint8Array>();
        const metadata: RobloxBuildManifest['artifacts'] = [];
        for (const artifact of build.artifacts) {
          const bytes = new TextEncoder().encode(artifact.content);
          entry.bytes += bytes.length;
          if (entry.bytes > robloxBuildLimits.bytes)
            throw new RobloxError(
              413,
              'Roblox artifacts exceed the 32 MiB retained-result budget.',
              'ROBLOX_BUILD_LIMIT',
            );
          const sha256 = await gameDigest(bytes);
          await check();
          artifacts.set(artifact.name, bytes);
          metadata.push({
            name: artifact.name,
            mimeType: artifact.mimeType,
            totalBytes: bytes.length,
            sha256,
          });
        }
        await check();
        if (!this.entries.has(jobId)) return;
        entry.artifacts = artifacts;
        entry.manifest = {
          jobId,
          diagramId,
          baseVersion,
          engineVersion: '1.0.0',
          objects: build.game.entities.length,
          rules: build.game.rules.length,
          artifacts: metadata,
        };
        entry.status.state = 'succeeded';
        entry.status.progress = 100;
        this.trim();
      } catch (error) {
        if (!this.entries.has(jobId)) return;
        entry.artifacts = undefined;
        entry.manifest = undefined;
        entry.bytes = 0;
        if (entry.controller.signal.aborted) entry.status.state = 'cancelled';
        else {
          entry.status.state = 'failed';
          const detail = error as { code?: string; message?: string };
          entry.status.error = {
            code: detail.code ?? 'ROBLOX_BUILD_FAILED',
            message: detail.message ?? 'The game build failed.',
          };
        }
        this.trim();
      }
    })();
    return structuredClone(status);
  }
  private async owned(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    await authorize();
    const entry = this.entries.get(jobId);
    if (!entry || entry.status.diagramId !== diagramId)
      throw new RobloxError(
        404,
        'This Roblox build is unavailable or expired.',
        'ROBLOX_BUILD_NOT_FOUND',
      );
    await entry.authority.guard.check();
    await authorize();
    return entry;
  }
  async status(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    return structuredClone((await this.owned(diagramId, jobId, authorize)).status);
  }
  async result(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    const entry = await this.owned(diagramId, jobId, authorize);
    if (entry.status.state !== 'succeeded' || !entry.manifest)
      throw new RobloxError(
        409,
        'This Roblox build has no completed result.',
        'ROBLOX_BUILD_NOT_READY',
      );
    return structuredClone(entry.manifest);
  }
  async artifact(
    diagramId: string,
    jobId: string,
    name: string,
    offset: number,
    limit: number,
    authorize: () => Promise<void>,
  ) {
    const entry = await this.owned(diagramId, jobId, authorize);
    const metadata = entry.manifest?.artifacts.find((artifact) => artifact.name === name);
    const bytes = entry.artifacts?.get(name);
    if (!metadata || !bytes)
      throw new RobloxError(
        404,
        'This build artifact is unavailable.',
        'ROBLOX_ARTIFACT_NOT_FOUND',
      );
    if (offset > bytes.length)
      throw new RobloxError(
        422,
        'The byte offset exceeds this artifact.',
        'ROBLOX_INVALID_REQUEST',
      );
    const end = Math.min(bytes.length, offset + limit);
    return {
      name,
      mimeType: metadata.mimeType,
      offset,
      nextOffset: end < bytes.length ? end : null,
      totalBytes: bytes.length,
      encoding: 'base64' as const,
      content: gameBase64(bytes.subarray(offset, end)),
    };
  }
  async cancel(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    const entry = await this.owned(diagramId, jobId, authorize);
    const status = { ...entry.status, state: 'cancelled' as const };
    this.erase(jobId);
    return status;
  }
  clear() {
    for (const id of [...this.entries.keys()]) this.erase(id);
  }
  private erase(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    clearTimeout(entry.expiry);
    entry.authority.guard.signal.removeEventListener('abort', entry.abort);
    entry.controller.abort();
    entry.artifacts?.clear();
    entry.artifacts = undefined;
    entry.manifest = undefined;
    entry.authority.dispose();
  }
  private trim() {
    const completed = [...this.entries.values()].filter(
      (entry) => entry.status.state !== 'running',
    );
    while (
      completed.length > robloxBuildLimits.retained ||
      completed.reduce((sum, entry) => sum + entry.bytes, 0) > robloxBuildLimits.bytes
    ) {
      const entry = completed.shift();
      if (entry) this.erase(entry.status.jobId);
    }
  }
}
export const robloxApiJobs = new RobloxApiJobs();
registerRobloxCleanup(() => robloxApiJobs.clear());
