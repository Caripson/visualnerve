// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const directories: string[] = [];
const bucket = 'fixture-static-bucket';
const distribution = 'fixture-distribution';
const invalidation = 'fixture-invalidation-42';

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function deployment() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-nerve-deploy-script-')));
  directories.push(root);
  const publicDirectory = join(root, 'public');
  const scripts = join(root, 'scripts');
  const binaries = join(root, 'bin');
  const log = join(root, 'aws-calls.jsonl');
  mkdirSync(scripts);
  mkdirSync(binaries);
  for (const file of ['deploy-static.sh', 'audit-static.mjs'])
    copyFileSync(new URL(`../../scripts/${file}`, import.meta.url), join(scripts, file));
  for (const file of [
    'index.html',
    'error.html',
    'privacy/index.html',
    'help/index.html',
    'api/docs/index.html',
    'editor/app.js',
    'editor/app.css',
    'editor/assets/chunk-Ab123.js',
    'editor/assets/chunk-Ab123.css',
    'sitemap.xml',
    'sw.js',
  ]) {
    const path = join(publicDirectory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'static application fixture');
  }
  writeFileSync(log, '');
  symlinkSync(process.execPath, join(binaries, 'node'));
  const aws = join(binaries, 'aws');
  writeFileSync(
    aws,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = process.env.VN_MOCK_AWS_LOG;
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 's3' && args[1] === 'cp') {
  const uploads = fs.readFileSync(log, 'utf8').trim().split('\\n')
    .map((line) => JSON.parse(line))
    .filter((call) => call[0] === 's3' && call[1] === 'cp');
  if (uploads.length === Number(process.env.VN_MOCK_FAIL_UPLOAD)) {
    process.stderr.write('Fixture upload failed\\n');
    process.exit(31);
  }
} else if (args[0] === 'cloudfront' && args[1] === 'create-invalidation') {
  process.stdout.write('${invalidation}\\n');
} else if (args[0] === 'cloudfront' && args[1] === 'wait') {
  if (process.env.VN_MOCK_FAIL_WAIT === '1') {
    process.stderr.write('Fixture invalidation wait failed\\n');
    process.exit(32);
  }
} else {
  process.stderr.write('Unexpected fixture AWS command\\n');
  process.exit(33);
}
`,
  );
  chmodSync(aws, 0o755);
  return {
    root,
    publicDirectory,
    run(options: { dryRun?: boolean; failUpload?: number; failWait?: boolean } = {}) {
      const result = spawnSync(
        'bash',
        [
          join(scripts, 'deploy-static.sh'),
          bucket,
          distribution,
          ...(options.dryRun ? ['--dry-run'] : []),
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 15000,
          env: {
            PATH: `${binaries}:${process.env.PATH ?? ''}`,
            VN_MOCK_AWS_LOG: log,
            VN_MOCK_FAIL_UPLOAD: String(options.failUpload ?? 0),
            VN_MOCK_FAIL_WAIT: options.failWait ? '1' : '0',
          },
        },
      );
      const calls = readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      return { ...result, calls };
    },
  };
}

function values(args: string[], flag: string) {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
}

describe('static deployment publication sequence', () => {
  it('publishes chunks, mutable assets, HTML and then the service worker before waiting for invalidation', () => {
    const fixture = deployment();
    const result = fixture.run();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Static bundle audit:');
    expect(result.calls).toHaveLength(6);
    const [chunks, assets, html, worker, invalidate, wait] = result.calls;
    expect(result.calls.slice(0, 4).map((call) => call.slice(0, 2))).toEqual(
      Array.from({ length: 4 }, () => ['s3', 'cp']),
    );
    expect(chunks.slice(2, 4)).toEqual([
      `${fixture.publicDirectory}/editor/assets/`,
      `s3://${bucket}/editor/assets/`,
    ]);
    expect(chunks).toContain('--recursive');
    expect(values(chunks, '--cache-control')).toEqual(['public,max-age=31536000,immutable']);
    for (const call of [assets, html]) {
      expect(call.slice(2, 4)).toEqual([`${fixture.publicDirectory}/`, `s3://${bucket}/`]);
      expect(call).toContain('--recursive');
    }
    expect(values(assets, '--exclude')).toEqual(
      expect.arrayContaining(['editor/assets/*', '*.html', 'sw.js']),
    );
    expect(values(assets, '--include')).toEqual([]);
    expect(values(html, '--exclude')).toEqual(['*']);
    expect(values(html, '--include')).toEqual(['*.html']);
    expect(html.indexOf('--exclude')).toBeLessThan(html.indexOf('--include'));
    expect(worker[2]).toBe(join(fixture.publicDirectory, 'sw.js'));
    expect([`s3://${bucket}/`, `s3://${bucket}/sw.js`]).toContain(worker[3]);
    expect(worker).not.toContain('--recursive');
    for (const call of [assets, html, worker])
      expect(values(call, '--cache-control')).toEqual(['no-cache']);
    expect(result.calls.flat()).not.toContain('--dryrun');
    expect(invalidate).toEqual([
      'cloudfront',
      'create-invalidation',
      '--distribution-id',
      distribution,
      '--paths',
      '/*',
      '--query',
      'Invalidation.Id',
      '--output',
      'text',
    ]);
    expect(wait).toEqual([
      'cloudfront',
      'wait',
      'invalidation-completed',
      '--distribution-id',
      distribution,
      '--id',
      invalidation,
    ]);
  });

  it('passes dry-run to every upload and skips invalidation creation and waiting', () => {
    const result = deployment().run({ dryRun: true });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toHaveLength(4);
    for (const call of result.calls) {
      expect(call.slice(0, 2)).toEqual(['s3', 'cp']);
      expect(call.filter((arg) => arg === '--dryrun')).toHaveLength(1);
    }
  });

  it.each([1, 2, 3, 4])(
    'stops after upload phase %i fails without invalidating partial content',
    (phase) => {
      const result = deployment().run({ failUpload: phase });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(31);
      expect(result.stderr).toContain('Fixture upload failed');
      expect(result.calls).toHaveLength(phase);
      expect(result.calls.every((call) => call[0] === 's3' && call[1] === 'cp')).toBe(true);
    },
  );

  it('reports failure if CloudFront does not complete invalidation', () => {
    const result = deployment().run({ failWait: true });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(32);
    expect(result.calls.at(-1)?.slice(0, 3)).toEqual([
      'cloudfront',
      'wait',
      'invalidation-completed',
    ]);
    expect(result.stderr).toContain('Fixture invalidation wait failed');
  });

  it('rejects a bundle missing the configured error page before calling AWS', () => {
    const fixture = deployment();
    rmSync(join(fixture.publicDirectory, 'error.html'));
    const result = fixture.run();
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Static bundle is missing error.html');
    expect(result.calls).toEqual([]);
  });

  it('rejects an unexpected backup in the bundle before calling AWS, including dry-run', () => {
    const fixture = deployment();
    writeFileSync(join(fixture.publicDirectory, 'private.backup'), 'private user content');
    const result = fixture.run({ dryRun: true });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unexpected file in static bundle: private.backup');
    expect(result.calls).toEqual([]);
  });
});
