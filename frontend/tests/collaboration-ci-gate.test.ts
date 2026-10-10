// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { verifyCollaborationCI, workflowPushPaths } from '../../scripts/collaboration-ci.mjs';
import { verifyDeployment, type WorkflowRun } from '../../scripts/require-ci.mjs';

const target = 'a'.repeat(40);
const baseline = 'b'.repeat(40);
const definition = '.github/workflows/collaboration-checks.yml';
const cryptoDefinition = '.github/workflows/collaboration-crypto.yml';
const workerFilter = `name: Worker\non:\n  push:\n    branches: [main]\n    paths:\n      - "collaboration-worker/**"\n  pull_request:\n    branches: [main]\n  workflow_dispatch:\n`;
const cryptoFilter = workerFilter.replace('collaboration-worker/**', 'frontend/src/**');
const identity = (text: string) => createHash('sha1').update(text).digest('hex');
const run = (patch: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 1,
  run_number: 1,
  head_sha: target,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/Caripson/visualnerve/actions/runs/1',
  ...patch,
});
type Source = Record<string, string | { content: string; mode: string; type?: string }>;
function fixture(current: Source, previous: Source = current, history: WorkflowRun[] = [run()]) {
  const responses = new Map<string, unknown>();
  for (const [sha, source] of [
    [target, current],
    [baseline, previous],
  ] as const) {
    const treeSha = identity(`${sha}-tree`);
    const entries = Object.entries(source).map(([path, value]) => {
      const content = typeof value === 'string' ? value : value.content;
      const blobSha = identity(content);
      responses.set(`git/blobs/${blobSha}`, {
        sha: blobSha,
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      });
      return {
        path,
        sha: blobSha,
        type: typeof value === 'string' ? 'blob' : value.type || 'blob',
        mode: typeof value === 'string' ? '100644' : value.mode,
      };
    });
    responses.set(`git/commits/${sha}`, { sha, tree: { sha: treeSha } });
    responses.set(`git/trees/${treeSha}?recursive=1`, { truncated: false, tree: entries });
  }
  const read = vi.fn(async (path: string) => {
    if (!responses.has(path)) throw new Error(`Missing synthetic GitHub response ${path}`);
    return responses.get(path);
  });
  const runs = vi.fn(async (_workflow: string, query?: { head_sha?: string }) =>
    history.filter((entry) => !query?.head_sha || entry.head_sha === query.head_sha),
  );
  return { read, runs, responses, check: () => verifyCollaborationCI({ sha: target, read, runs }) };
}
const original = { [definition]: workerFilter, 'collaboration-worker/src/room.ts': 'original' };
const previousSuccess = run({ head_sha: baseline });

describe('collaboration deployment CI proof', () => {
  it('does not demand histories for an immutable revision before the feature exists', async () => {
    const data = fixture({ 'README.md': 'old release' });
    await expect(data.check()).resolves.toEqual([]);
    expect(data.runs).not.toHaveBeenCalled();
  });

  it.each<Source>([
    { 'collaboration-worker/package.json': '{}' },
    { 'collaboration-worker/src/room.ts': 'relay source' },
    { 'collaboration-crypto/Cargo.toml': '[package]' },
    { 'collaboration-crypto/src/lib.rs': 'crypto source' },
    { 'frontend/src/collaboration/controller.ts': 'client runtime' },
  ])('blocks a deleted workflow while its feature source remains: %j', async (source) => {
    const data = fixture(source);
    await expect(data.check()).rejects.toThrow('definition is missing while its feature exists');
    expect(data.runs).not.toHaveBeenCalled();
  });

  it('requires both present workflows and accepts exact main push/manual runs', async () => {
    const data = fixture({ ...original, [cryptoDefinition]: cryptoFilter }, undefined, [
      run({ event: 'workflow_dispatch' }),
    ]);
    const evidence = await data.check();
    expect(evidence.map((item) => item.workflow)).toEqual([
      'collaboration-checks.yml',
      'collaboration-crypto.yml',
    ]);
    expect(evidence.every((item) => item.validationSha === target && !item.unchangedInputs)).toBe(
      true,
    );
    expect(data.runs.mock.calls).toEqual([
      ['collaboration-checks.yml', { head_sha: target }],
      ['collaboration-crypto.yml', { head_sha: target }],
    ]);
  });

  it('blocks a failed crypto workflow even when core and relay verification passed', async () => {
    const data = fixture({ ...original, [cryptoDefinition]: cryptoFilter });
    data.runs.mockImplementation(async (workflow) => [
      run({ conclusion: workflow === 'collaboration-crypto.yml' ? 'failure' : 'success' }),
    ]);
    await expect(data.check()).rejects.toThrow('collaboration-crypto.yml');
    expect(data.runs.mock.calls.map(([workflow]) => workflow)).toEqual([
      'collaboration-checks.yml',
      'collaboration-crypto.yml',
    ]);
  });

  it('does not query a workflow absent from the exact immutable revision', async () => {
    const data = fixture(original);
    await expect(data.check()).resolves.toHaveLength(1);
    expect(data.runs.mock.calls.map(([workflow]) => workflow)).toEqual([
      'collaboration-checks.yml',
    ]);
  });

  it.each([
    { status: 'queued' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { conclusion: null },
  ])('blocks the current exact revision when its latest run is %j', async (patch) => {
    const data = fixture(original, undefined, [run(), run({ id: 2, run_number: 2, ...patch })]);
    await expect(data.check()).rejects.toThrow('must complete successfully');
  });

  it('uses a later rerun result and cannot substitute an old or unrelated successful run', async () => {
    const data = fixture(original, undefined, [
      run({ id: 5, run_number: 5, head_sha: baseline, updated_at: '2026-10-10T15:00:00Z' }),
      run({ updated_at: '2026-10-10T14:00:00Z' }),
      run({ id: 2, run_number: 2, conclusion: 'failure', updated_at: '2026-10-10T14:30:00Z' }),
    ]);
    await expect(data.check()).rejects.toThrow('must complete successfully');
    expect(data.runs).toHaveBeenCalledTimes(1);
  });

  it('reuses a path-filtered baseline only after proving every tracked input unchanged', async () => {
    const data = fixture({ ...original, 'README.md': 'unrelated documentation' }, original, [
      previousSuccess,
    ]);
    await expect(data.check()).resolves.toEqual([
      {
        workflow: 'collaboration-checks.yml',
        runId: previousSuccess.id,
        runUrl: previousSuccess.html_url,
        validationSha: baseline,
        unchangedInputs: true,
      },
    ]);
    expect(data.read).toHaveBeenCalledWith(`git/commits/${target}`);
    expect(data.read).toHaveBeenCalledWith(`git/commits/${baseline}`);
  });

  it.each([
    { ...original, 'collaboration-worker/src/room.ts': 'changed in an earlier commit of the push' },
    { ...original, 'collaboration-worker/src/new-file.ts': 'added' },
    { [definition]: workerFilter },
    {
      ...original,
      'collaboration-worker/src/room.ts': { content: 'original', mode: '100755' },
    },
    { ...original, [definition]: `${workerFilter}# changed job configuration\n` },
  ])(
    'blocks any changed, added, removed or differently executable covered input',
    async (source) => {
      const data = fixture(source, original, [previousSuccess]);
      await expect(data.check()).rejects.toThrow('Relevant sources changed');
    },
  );

  it('does not treat PR or other-branch successes as approved source validation', async () => {
    const data = fixture(original, undefined, [
      run({ event: 'pull_request' }),
      run({ head_branch: 'feature' }),
    ]);
    await expect(data.check()).rejects.toThrow('verification is required');
  });

  it('requires new validation when the latest baseline failed or is still pending', async () => {
    for (const patch of [{ status: 'in_progress' }, { conclusion: 'failure' }]) {
      const data = fixture(original, original, [
        previousSuccess,
        run({ id: 2, run_number: 2, head_sha: baseline, ...patch }),
      ]);
      await expect(data.check()).rejects.toThrow('verification is required');
    }
  });

  it('does not permit missing baseline history or an unfiltered workflow without an exact run', async () => {
    await expect(fixture(original, original, []).check()).rejects.toThrow(
      'verification is required',
    );
    const unfiltered = workerFilter.replace('    paths:\n      - "collaboration-worker/**"\n', '');
    await expect(
      fixture({ [definition]: unfiltered }, { [definition]: unfiltered }, [
        previousSuccess,
      ]).check(),
    ).rejects.toThrow('unfiltered workflow');
  });

  it('evaluates recursive wildcard paths at both zero and multiple directory levels', async () => {
    const filtered = workerFilter.replace(
      'collaboration-worker/**',
      'collaboration-worker/**/*.ts',
    );
    const prior = { [definition]: filtered, 'collaboration-worker/room.ts': 'before' };
    const current = { ...prior, 'collaboration-worker/room.ts': 'after' };
    await expect(fixture(current, prior, [previousSuccess]).check()).rejects.toThrow(
      'Relevant sources changed',
    );
    const nested = { ...prior, 'collaboration-worker/sub/deep/room.ts': 'new' };
    await expect(fixture(nested, prior, [previousSuccess]).check()).rejects.toThrow(
      'Relevant sources changed',
    );
  });

  it.each([
    '    paths: ["collaboration-worker/**"]',
    '    paths-ignore:\n      - "README.md"',
    '    paths:\n      - "!collaboration-worker/private/**"',
    "    paths:\n      - 'collaboration-worker/**'",
    '    paths:\n      - "collaboration-worker/**"\n    paths:\n      - "frontend/**"',
  ])('fails closed on unsupported or ambiguous trigger syntax: %s', async (filter) => {
    const source = `on:\n  push:\n${filter}\n  workflow_dispatch:\n`;
    await expect(
      fixture({ [definition]: source }, { [definition]: source }, [previousSuccess]).check(),
    ).rejects.toThrow('deployment remains blocked');
  });

  it('fails closed on incomplete or malformed immutable source trees', async () => {
    for (const malformed of [
      { truncated: true, tree: [] },
      { tree: [] },
      {
        truncated: false,
        tree: [{ path: '../escape', sha: target, mode: '100644', type: 'blob' }],
      },
    ]) {
      const data = fixture(original);
      data.responses.set(`git/trees/${identity(`${target}-tree`)}?recursive=1`, malformed);
      await expect(data.check()).rejects.toThrow('deployment remains blocked');
    }
  });

  it('fails closed on unknown history, invalid run records, and missing or unreadable GitHub data', async () => {
    const malformed = fixture(original);
    malformed.runs.mockResolvedValueOnce([null as unknown as WorkflowRun]);
    await expect(malformed.check()).rejects.toThrow('Invalid collaboration workflow run');
    const unavailable = fixture(original, original, [previousSuccess]);
    unavailable.read.mockRejectedValueOnce(new Error('HTTP 403'));
    await expect(unavailable.check()).rejects.toThrow('HTTP 403');
    const absentBlob = fixture(original, original, [previousSuccess]);
    absentBlob.responses.delete(`git/blobs/${identity(workerFilter)}`);
    await expect(absentBlob.check()).rejects.toThrow('Missing synthetic GitHub');
  });

  it('integrates optional checks into staging authorization and explicitly queries exact SHA', async () => {
    const data = fixture(original, original, [run({ status: 'in_progress' })]);
    const fetcher = vi.fn(async (url: URL) => ({
      ok: true,
      json: async () => {
        const path = url.pathname.split('/repos/Caripson/visualnerve/')[1];
        if (path === 'git/ref/heads/main') return { object: { sha: target } };
        if (path === 'actions/workflows/ci.yml/runs') return { workflow_runs: [run()] };
        if (path.startsWith('actions/workflows/')) {
          expect(url.searchParams.get('head_sha')).toBe(target);
          return {
            workflow_runs: await data.runs('collaboration-checks.yml', { head_sha: target }),
          };
        }
        return data.read(`${path}${url.search}`);
      },
    }));
    await expect(
      verifyDeployment(
        {
          GITHUB_REPOSITORY: 'Caripson/visualnerve',
          GH_TOKEN: 'synthetic-token',
          GITHUB_SHA: target,
          GITHUB_REF: 'refs/heads/main',
        },
        'staging',
        fetcher,
      ),
    ).rejects.toThrow('must complete successfully');
    expect(
      fetcher.mock.calls.some(([url]) => url.pathname.includes('collaboration-checks.yml')),
    ).toBe(true);
  });

  it('supports the repository definitions and offers manual exact-SHA runs for both filters', () => {
    for (const name of ['collaboration-checks.yml', 'collaboration-crypto.yml']) {
      const source = readFileSync(
        new URL(`../../.github/workflows/${name}`, import.meta.url),
        'utf8',
      );
      expect(workflowPushPaths(source)?.length).toBeGreaterThan(0);
      expect(source).toMatch(/^  workflow_dispatch:\s*$/m);
    }
  });
});
