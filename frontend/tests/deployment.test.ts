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
    expect(route('/help').uri).toBe('/help/index.html');
    expect(route('/privacy/').uri).toBe('/privacy/index.html');
    expect(route('/editor/app.js').uri).toBe('/editor/app.js');
    expect(route('/api/docs').uri).toBe('/api/docs/index.html');
    expect(route('/diagrams', undefined, {}, 'POST').statusCode).toBe(405);
  });
  it('provisions only a private static bucket and GET/HEAD distribution, with no content write permission', () => {
    const config = template.Resources.Distribution.Properties.DistributionConfig;
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
      for (const path of ['index.html', 'sw.js', 'privacy/index.html', 'editor/app.js'])
        writeFileSync(join(directory, path), 'static code');
      expect(auditStatic(directory)).toHaveLength(4);
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
