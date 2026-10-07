// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { authorizeDeployment, verifyDeployment } from '../../scripts/require-ci.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const run = (patch = {}) => ({
  id: 1,
  run_number: 1,
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/Caripson/visualnerve/actions/runs/1',
  ...patch,
});
const input = (patch = {}) => ({
  sha,
  mainSha: sha,
  ref: 'refs/heads/main',
  mode: 'staging',
  ciRuns: [run()],
  ...patch,
});
const production = (patch = {}) =>
  input({
    mode: 'production',
    approvedSha: sha,
    actor: 'Caripson',
    stagingRuns: [run({ event: 'workflow_dispatch' })],
    ...patch,
  });

describe('manual deployment gates', () => {
  it('accepts staging only with a successful CI push for its exact SHA', () => {
    expect(authorizeDeployment(input())).toEqual({ sha, ciRunId: 1, ciUrl: run().html_url });
    expect(() => authorizeDeployment(input({ ciRuns: [run({ head_sha: other })] }))).toThrow(
      'latest CI',
    );
  });

  it.each(['in_progress', 'queued', 'waiting'])('blocks CI status %s', (status) => {
    expect(() => authorizeDeployment(input({ ciRuns: [run({ status })] }))).toThrow('latest CI');
  });

  it.each(['failure', 'cancelled', 'skipped', null])('blocks CI conclusion %s', (conclusion) => {
    expect(() => authorizeDeployment(input({ ciRuns: [run({ conclusion })] }))).toThrow(
      'latest CI',
    );
  });

  it('does not use an older success after a newer failed or pending run for that SHA', () => {
    expect(() =>
      authorizeDeployment(
        input({ ciRuns: [run(), run({ id: 2, run_number: 2, conclusion: 'failure' })] }),
      ),
    ).toThrow('latest CI');
  });

  it('does not count PR or other-branch CI as main push validation', () => {
    expect(() =>
      authorizeDeployment(
        input({ ciRuns: [run({ event: 'pull_request' }), run({ head_branch: 'feature' })] }),
      ),
    ).toThrow('latest CI');
  });

  it('rejects malformed SHA, non-main dispatch, unknown mode and invalid history', () => {
    expect(() => authorizeDeployment(input({ sha: 'main' }))).toThrow('full deployed commit');
    expect(() => authorizeDeployment(input({ ref: 'refs/heads/feature' }))).toThrow('Only main');
    expect(() => authorizeDeployment(input({ mainSha: other }))).toThrow('Main has moved');
    expect(() => authorizeDeployment(input({ mode: 'preview' }))).toThrow('Unknown');
    expect(() => authorizeDeployment(input({ ciRuns: null }))).toThrow('invalid workflow history');
  });

  it('requires explicit exact-SHA owner approval for production', () => {
    expect(() => authorizeDeployment(production({ approvedSha: '' }))).toThrow('not approved');
    expect(() => authorizeDeployment(production({ approvedSha: other }))).toThrow('not approved');
    expect(authorizeDeployment(production()).stagingRunId).toBe(1);
  });

  it('requires Caripson both for the original dispatch and any rerun', () => {
    expect(() => authorizeDeployment(production({ actor: 'other' }))).toThrow('Only Caripson');
    expect(() => authorizeDeployment(production({ triggeringActor: 'other' }))).toThrow(
      'Only Caripson',
    );
  });

  it('requires the latest staging run, rather than any old matching staging success', () => {
    const stagingRuns = [
      run({ event: 'workflow_dispatch' }),
      run({ id: 2, run_number: 2, event: 'workflow_dispatch', head_sha: other }),
    ];
    expect(() => authorizeDeployment(production({ stagingRuns }))).toThrow('latest manual');
  });

  it.each([{ status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }])(
    'blocks unsafe staging history %j',
    (patch) => {
      expect(() =>
        authorizeDeployment(
          production({ stagingRuns: [run({ event: 'workflow_dispatch', ...patch })] }),
        ),
      ).toThrow('latest manual');
    },
  );

  it('queries exact CI revision and fails closed on unavailable GitHub verification', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(
      verifyDeployment(
        { GITHUB_REPOSITORY: 'Caripson/visualnerve', GH_TOKEN: 'fixture-token', GITHUB_SHA: sha },
        'staging',
        fetcher,
      ),
    ).rejects.toThrow('deployment remains blocked');
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toContain('/workflows/ci.yml/runs');
    expect(url.searchParams.get('head_sha')).toBe(sha);
    expect(url.searchParams.get('event')).toBe('push');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token');
  });

  it('performs no production-history query for staging and returns validated evidence', async () => {
    const fetcher = vi.fn(async (url: URL) => ({
      ok: true,
      json: async () =>
        url.pathname.includes('/git/ref/') ? { object: { sha } } : { workflow_runs: [run()] },
    }));
    const result = await verifyDeployment(
      {
        GITHUB_REPOSITORY: 'Caripson/visualnerve',
        GH_TOKEN: 'fixture-token',
        GITHUB_SHA: sha,
        GITHUB_REF: 'refs/heads/main',
      },
      'staging',
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.every(([url]) => !url.pathname.includes('/workflows/deploy.yml/')),
    ).toBe(true);
    expect(result.sha).toBe(sha);
    expect(JSON.stringify(result)).not.toContain('fixture-token');
  });

  it('notices an older staging run rerun after the reviewed publication', () => {
    const stagingRuns = [
      run({ event: 'workflow_dispatch', head_sha: other, updated_at: '2026-10-07T14:00:00Z' }),
      run({ id: 2, run_number: 2, event: 'workflow_dispatch', updated_at: '2026-10-07T13:00:00Z' }),
    ];
    expect(() => authorizeDeployment(production({ stagingRuns }))).toThrow('latest manual');
  });

  it('keeps both workflows manual and gates publication before AWS access', () => {
    const staging = readFileSync(
      new URL('../../.github/workflows/deploy.yml', import.meta.url),
      'utf8',
    );
    const production = readFileSync(
      new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
      'utf8',
    );
    for (const text of [staging, production]) {
      expect(text).toMatch(/^on:\n  workflow_dispatch:\n\n/m);
      expect(text).not.toMatch(/^  (push|pull_request|workflow_run|schedule):/m);
      expect(text).toContain("github.ref == 'refs/heads/main'");
      expect(text).toContain('actions: read');
      expect(text).not.toContain('./scripts/test.sh');
      expect(text.lastIndexOf('node scripts/require-ci.mjs')).toBeLessThan(
        text.indexOf('run: ./scripts/deploy-static.sh'),
      );
    }
    expect(staging).toContain('HUGO_PARAMS_ENVIRONMENT: staging');
    expect(production).toContain('HUGO_PARAMS_ENVIRONMENT: production');
    expect(production).toContain('S3_BUCKET: www.visualnerve.com');
    expect(production).toContain('${{ vars.PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID }}');
    expect(production).toContain('${{ vars.PRODUCTION_APPROVED_SHA }}');
    expect(production.lastIndexOf('node scripts/require-ci.mjs')).toBeLessThan(
      production.indexOf('uses: aws-actions/configure-aws-credentials'),
    );
  });
});
