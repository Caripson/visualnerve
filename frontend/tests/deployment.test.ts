// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
