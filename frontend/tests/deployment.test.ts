// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { runInNewContext } from 'node:vm';
import { template } from '../../deployment/template.mjs';
import { auditStatic } from '../../scripts/audit-static.mjs';
const source = readFileSync(new URL('../../deployment/viewer-request.js', import.meta.url), 'utf8');
function route(uri: string, host = 'visualnerve.example.com', querystring = {}, method = 'GET') {
  const request = { method, uri, headers: { host: { value: host } }, querystring };
  return runInNewContext(
    `${source.replace('__CANONICAL_HOST__', 'visualnerve.example.com')}\nhandler(event);`,
    { event: { request } },
  );
}
describe('static delivery and canonical storage origin', () => {
  it('audits a symlinked checkout before uploading license texts with explicit MIME/cache metadata', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'visual-nerve deploy notices-')));
    try {
      const alias = join(directory, 'checkout alias #%');
      symlinkSync(directory, alias, 'dir');
      const scripts = join(alias, 'scripts'),
        publicDirectory = join(alias, 'public'),
        binary = join(directory, 'bin'),
        log = join(directory, 'aws-calls.jsonl');
      for (const path of [
        scripts,
        binary,
        publicDirectory,
        'public/editor/assets',
        'public/privacy',
        'public/app',
        'public/licenses',
      ])
        mkdirSync(path.startsWith(directory) ? path : join(directory, path), { recursive: true });
      copyFileSync(
        new URL('../../scripts/deploy-static.sh', import.meta.url),
        join(scripts, 'deploy-static.sh'),
      );
      copyFileSync(
        new URL('../../scripts/audit-static.mjs', import.meta.url),
        join(scripts, 'audit-static.mjs'),
      );
      for (const path of [
        'index.html',
        'app/index.html',
        'error.html',
        'sw.js',
        'appearance.js',
        'privacy/index.html',
        'editor/app.js',
        'editor/assets/app-example.js',
        'licenses/esutils-LICENSE.BSD',
        'licenses/visualnerve-LICENSE',
        'licenses/piper-LICENSE.md',
      ])
        writeFileSync(join(publicDirectory, path), 'static application or license text');
      writeFileSync(join(publicDirectory, 'licenses/inventory.json'), '[]');
      writeFileSync(join(publicDirectory, 'licenses/example-LICENSE.json'), '{"license":"MIT"}');
      // The real shell script and audit run; this executable records only CLI arguments.
      writeFileSync(
        join(binary, 'aws'),
        '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.VN_TEST_AWS_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n',
        { mode: 0o755 },
      );
      const deploy = () =>
        spawnSync(
          'bash',
          [join(scripts, 'deploy-static.sh'), 'test-bucket', 'test-distribution', '--dry-run'],
          {
            cwd: directory,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${binary}${delimiter}${process.env.PATH}`,
              VN_TEST_AWS_LOG: log,
            },
          },
        );
      const result = deploy();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Static bundle audit:');
      const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toHaveLength(6);
      expect(
        calls.every((args) => args[0] === 's3' && args[1] === 'cp' && args.includes('--dryrun')),
      ).toBe(true);
      const option = (args: string[], name: string) => args[args.indexOf(name) + 1];
      const textUpload = calls.find((args) => args[2] === `${join(publicDirectory, 'licenses')}/`)!;
      expect(textUpload[3]).toBe('s3://test-bucket/licenses/');
      expect(option(textUpload, '--content-type')).toBe('text/plain');
      expect(option(textUpload, '--cache-control')).toBe('no-cache');
      expect(option(textUpload, '--exclude')).toBe('inventory.json');
      const inventoryUpload = calls.find(
        (args) => args[2] === join(publicDirectory, 'licenses/inventory.json'),
      )!;
      expect(inventoryUpload[3]).toBe('s3://test-bucket/licenses/inventory.json');
      expect(option(inventoryUpload, '--content-type')).toBe('application/json');
      expect(option(inventoryUpload, '--cache-control')).toBe('no-cache');
      const mutable = calls.find(
        (args) => args[2] === `${publicDirectory}/` && !args.includes('--include'),
      )!;
      expect(mutable.join(' ')).toContain('--exclude licenses/*');
      expect(option(calls[0], '--cache-control')).toBe('public,max-age=31536000,immutable');
      expect(calls.every((args) => args[2].startsWith(`${publicDirectory}/`))).toBe(true);
      // MIME handling must never bypass the initial user-data upload guard.
      writeFileSync(
        join(publicDirectory, 'licenses/private-backup.json'),
        '{"format":"visual-nerve-workspace"}',
      );
      const refused = deploy();
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain('User export found');
      expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(6);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('redirects aliases and the distribution hostname before serving the application, preserving query parameters', () => {
    for (const host of ['www.visualnerve.example.com', 'distribution.cloudfront.net']) {
      const result = route('/privacy/', host, {
        tag: { multiValue: [{ value: 'a' }, { value: 'b%20c' }] },
      });
      expect(result.statusCode).toBe(308);
      expect(result.headers.location.value).toBe(
        'https://visualnerve.example.com/privacy/?tag=a&tag=b%20c',
      );
    }
  });
  it('serves Hugo indexes and leaves static assets intact, refusing application uploads', () => {
    expect(route('/').uri).toBe('/index.html');
    expect(route('/app').uri).toBe('/app/index.html');
    expect(route('/app/').uri).toBe('/app/index.html');
    expect(route('/mcp/').uri).toBe('/mcp/index.html');
    expect(route('/help').uri).toBe('/help/index.html');
    expect(route('/privacy/').uri).toBe('/privacy/index.html');
    expect(route('/editor/app.js').uri).toBe('/editor/app.js');
    expect(route('/error.html').uri).toBe('/error.html');
    expect(route('/api/docs').uri).toBe('/api/docs/index.html');
    expect(route('/diagrams', undefined, {}, 'POST').statusCode).toBe(405);
  });
  it('serves every published license notice by its exact object key, including extensionless files', () => {
    const inventory = JSON.parse(
      readFileSync(new URL('../../docs/third-party-licenses.json', import.meta.url), 'utf8'),
    ) as { notices: string[] }[];
    const paths = new Set([
      '/licenses/visualnerve-LICENSE',
      '/licenses/visualnerve-NOTICE',
      ...inventory.flatMap((entry) => entry.notices.map((path) => `/${path}`)),
    ]);
    expect(paths.has('/licenses/espeak-ng-COPYING')).toBe(true);
    expect(paths.has('/licenses/piper-phonemize-NOTICE')).toBe(true);
    for (const method of ['GET', 'HEAD']) {
      for (const path of paths) {
        const result = route(path, undefined, {}, method);
        expect(result.uri, `${method} ${path}`).toBe(path);
        expect(result.method).toBe(method);
      }
    }
  });
  it('preserves license alias redirects and keeps directory/unknown routes at their own origin keys', () => {
    const redirected = route(
      '/licenses/visualnerve-LICENSE',
      'alias.example.com',
      {
        source: { value: 'license%20page' },
      },
      'HEAD',
    );
    expect(redirected.statusCode).toBe(308);
    expect(redirected.headers.location.value).toBe(
      'https://visualnerve.example.com/licenses/visualnerve-LICENSE?source=license%20page',
    );
    expect(route('/licenses').uri).toBe('/licenses/index.html');
    expect(route('/licenses/').uri).toBe('/licenses/index.html');
    expect(route('/licenses/not-a-real-LICENSE').uri).toBe('/licenses/not-a-real-LICENSE');
    expect(route('/licenses-unrelated/NOTICE').uri).toBe('/licenses-unrelated/NOTICE/index.html');
    expect(route('/not-a-real-page').uri).toBe('/not-a-real-page/index.html');
    expect(route('/help/code/').uri).toBe('/help/code/index.html');
    expect(route('/app').uri).toBe('/app/index.html');
    expect(route('/editor/assets/app-example.js').uri).toBe('/editor/assets/app-example.js');
    expect(route('/licenses/visualnerve-LICENSE', undefined, {}, 'POST').statusCode).toBe(405);
  });
  it('provisions only a private static bucket and GET/HEAD distribution, with no content write permission', () => {
    const config = template.Resources.Distribution.Properties.DistributionConfig;
    expect(config.DefaultRootObject).toBe('index.html');
    expect(config.CustomErrorResponses).toEqual([
      {
        ErrorCode: 403,
        ResponseCode: 404,
        ResponsePagePath: '/error.html',
        ErrorCachingMinTTL: 10,
      },
      {
        ErrorCode: 404,
        ResponseCode: 404,
        ResponsePagePath: '/error.html',
        ErrorCachingMinTTL: 10,
      },
    ]);
    expect(config.DefaultCacheBehavior.AllowedMethods).toEqual(['GET', 'HEAD']);
    expect(config.Origins).toHaveLength(1);
    const allow = template.Resources.BucketPolicy.Properties.PolicyDocument.Statement.filter(
      (item: { Effect: string }) => item.Effect === 'Allow',
    );
    expect(allow.map((item: { Action: string }) => item.Action)).toEqual(['s3:GetObject']);
    expect(JSON.stringify(template)).not.toMatch(/DynamoDB|RDS::|ApiGateway|s3:PutObject/);
  });
  it('stops a deployment if a user backup or unexpected application state file is in the bundle', () => {
    const directory = mkdtempSync(join(tmpdir(), 'visual-nerve-static-audit-'));
    try {
      mkdirSync(join(directory, 'editor'));
      mkdirSync(join(directory, 'privacy'));
      mkdirSync(join(directory, 'app'));
      for (const path of [
        'index.html',
        'app/index.html',
        'error.html',
        'sw.js',
        'appearance.js',
        'privacy/index.html',
        'editor/app.js',
      ])
        writeFileSync(join(directory, path), 'static code');
      expect(auditStatic(directory)).toHaveLength(7);
      mkdirSync(join(directory, 'site'));
      writeFileSync(
        join(directory, 'site/syntax.css'),
        '/* shared appearance-aware highlighting */',
      );
      expect(auditStatic(directory)).toHaveLength(8);
      mkdirSync(join(directory, 'site', 'images'));
      mkdirSync(join(directory, 'site', 'devices'));
      mkdirSync(join(directory, 'help', 'images'), { recursive: true });
      for (const file of [
        'site/images/desktop-dark.webp',
        'site/devices/desktop.svg',
        'help/images/simulation-dark.webp',
      ])
        writeFileSync(join(directory, file), 'public capture');
      expect(auditStatic(directory)).toHaveLength(11);
      writeFileSync(
        join(directory, 'help/images/private-workspace-dark.webp'),
        'unapproved capture',
      );
      expect(() => auditStatic(directory)).toThrow('Unexpected file');
      rmSync(join(directory, 'help/images/private-workspace-dark.webp'));
      rmSync(join(directory, 'error.html'));
      expect(() => auditStatic(directory)).toThrow('Static bundle is missing error.html');
      writeFileSync(join(directory, 'error.html'), 'static error page');
      writeFileSync(join(directory, '404.html'), 'unconfigured error page');
      expect(() => auditStatic(directory)).toThrow('Unexpected file in static bundle: 404.html');
      rmSync(join(directory, '404.html'));
      writeFileSync(
        join(directory, 'visual-nerve-backup-2026-10-05.json'),
        '{"format":"visual-nerve-workspace"}',
      );
      expect(() => auditStatic(directory)).toThrow('Unexpected file');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
