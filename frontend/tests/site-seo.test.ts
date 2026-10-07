// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

function build(environment: string, origin: string) {
  const target = mkdtempSync(join(tmpdir(), 'visualnerve-seo-'));
  const result = spawnSync(
    'hugo',
    ['--source', resolve('../hugo'), '--destination', target, '--baseURL', origin],
    {
      encoding: 'utf8',
      env: { ...process.env, HUGO_PARAMS_ENVIRONMENT: environment },
    },
  );
  if (result.status !== 0) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(result.stderr);
  }
  return target;
}
describe('public site discovery and private workspace indexing', () => {
  it('keeps staging out of search and uses its own origin consistently', () => {
    const directory = build('staging', 'https://visualnerve.caripson.com/');
    try {
      const home = readFileSync(join(directory, 'index.html'), 'utf8');
      expect(home).toMatch(/name="robots" content="noindex, nofollow"/);
      expect(home).toContain('rel="canonical" href="https://visualnerve.caripson.com/"');
      expect(readFileSync(join(directory, 'robots.txt'), 'utf8')).toContain('Disallow: /');
      expect(readFileSync(join(directory, 'sitemap.xml'), 'utf8')).not.toContain(
        'www.visualnerve.com',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('indexes the production product/help pages while excluding workspace documents and endpoint data', () => {
    const directory = build('production', 'https://www.visualnerve.com/');
    try {
      const home = readFileSync(join(directory, 'index.html'), 'utf8');
      expect(home).toMatch(/name="robots" content="index, follow"/);
      expect(home).toContain('rel="canonical" href="https://www.visualnerve.com/"');
      expect(home).toContain('"@type":"SoftwareApplication"');
      const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
      for (const route of [
        'features',
        'use-cases',
        'process-simulator',
        'mcp',
        'developers',
        'privacy',
        'security',
        'help',
      ])
        expect(sitemap).toContain('https://www.visualnerve.com/' + route + '/');
      expect(sitemap).not.toContain('/app/');
      expect(sitemap).not.toContain('/api/v1/');
      expect(readFileSync(join(directory, 'app/index.html'), 'utf8')).toMatch(
        /name="robots" content="noindex, nofollow"/,
      );
      expect(readFileSync(join(directory, 'robots.txt'), 'utf8')).toContain(
        'Sitemap: https://www.visualnerve.com/sitemap.xml',
      );
      for (const route of ['app/index.html', 'help/index.html'])
        expect(readFileSync(join(directory, route), 'utf8')).not.toContain('/site/consent.js');
      const features = readFileSync(join(directory, 'features/index.html'), 'utf8');
      expect(features).toContain('site-capture--laptop');
      expect(features).toContain('site-capture--phone');
      expect(features).toContain('site-capture--detail');
      expect(features).toMatch(/phone.webp[^>]*width="360" height="640"/);
      const guide = readFileSync(join(directory, 'help/getting-started/index.html'), 'utf8');
      expect(guide).toContain('class="help-figure"');
      expect(guide).not.toContain('site-capture--');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
