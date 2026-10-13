// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { decodeHTML } from 'entities';
import { PublicWorkspaceRetirement } from '../../scripts/retire-public-workspace.mjs';

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
  if (environment === 'production') new PublicWorkspaceRetirement(target).retire();
  return target;
}
function metadata(html: string, name: string, attribute = 'name') {
  return decodeHTML(
    html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`))?.[1] ?? '',
  );
}
function schema(html: string) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  const data = JSON.parse(scripts[0][1]) as {
    '@context': string;
    '@graph': (Record<string, unknown> & { '@type': string; '@id': string })[];
  };
  expect(data['@context']).toBe('https://schema.org');
  expect(Array.isArray(data['@graph'])).toBe(true);
  return data['@graph'];
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
      for (const route of [
        'index.html',
        'features/index.html',
        'help/uml/index.html',
        'app/index.html',
      ])
        expect(readFileSync(join(directory, route), 'utf8')).not.toContain('application/ld+json');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('indexes the production product/help pages while excluding workspace documents and endpoint data', () => {
    const directory = build('production', 'https://www.visualnerve.com/');
    try {
      const home = readFileSync(join(directory, 'index.html'), 'utf8');
      expect(metadata(home, 'robots')).toBe('index, follow, max-image-preview:large');
      expect(home).toContain('rel="canonical" href="https://www.visualnerve.com/"');
      expect(home).toContain('<title>Visual Nerve — Diagrams, data and process simulation</title>');
      expect(home).toContain('Free to use. No account. No mandatory backend.');
      const homeGraph = schema(home);
      expect(homeGraph.find((node) => node['@type'] === 'WebSite')).toMatchObject({
        name: 'Visual Nerve',
        url: 'https://www.visualnerve.com/',
        inLanguage: 'en',
      });
      const application = homeGraph.find((node) => node['@type'] === 'SoftwareApplication')!;
      expect(application).toMatchObject({
        name: 'Visual Nerve',
        url: 'https://app.visualnerve.com/',
        applicationCategory: 'BusinessApplication',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
      });
      expect(application.aggregateRating).toBeUndefined();
      expect(application.review).toBeUndefined();
      const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
      const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      expect(new Set(locations).size).toBe(locations.length);
      expect(locations).toHaveLength(39);
      expect(locations.filter((url) => /\/help\/.+\/$/.test(url))).toHaveLength(29);
      const titles = new Set<string>();
      const descriptions = new Set<string>();
      for (const url of locations) {
        const canonical = new URL(url);
        expect(canonical.origin).toBe('https://www.visualnerve.com');
        expect(canonical.search).toBe('');
        expect(canonical.hash).toBe('');
        const html = readFileSync(join(directory, canonical.pathname, 'index.html'), 'utf8');
        const title = decodeHTML(html.match(/<title>([^<]+)<\/title>/)![1]);
        const description = metadata(html, 'description');
        expect(title.length, url).toBeGreaterThan(12);
        expect(description.length, url).toBeGreaterThan(30);
        expect(titles.has(title), url).toBe(false);
        expect(descriptions.has(description), url).toBe(false);
        titles.add(title);
        descriptions.add(description);
        expect(html, url).toContain(`rel="canonical" href="${url}"`);
        expect(metadata(html, 'robots'), url).toBe('index, follow, max-image-preview:large');
        expect(metadata(html, 'og:url', 'property'), url).toBe(url);
        expect(metadata(html, 'og:title', 'property'), url).toBe(title);
        expect(metadata(html, 'twitter:title'), url).toBe(title);
        expect(metadata(html, 'twitter:description'), url).toBe(description);
        expect(metadata(html, 'og:image', 'property'), url).toBe(
          'https://www.visualnerve.com/site/images/social.webp',
        );
        expect(metadata(html, 'og:image:type', 'property'), url).toBe('image/webp');
        expect(metadata(html, 'og:image:width', 'property'), url).toBe('1200');
        expect(metadata(html, 'og:image:height', 'property'), url).toBe('675');
        expect(metadata(html, 'twitter:image'), url).toBe(metadata(html, 'og:image', 'property'));
        const graph = schema(html);
        const identifiers = new Set(graph.map((node) => node['@id']));
        expect(identifiers.size, url).toBe(graph.length);
        const page = graph.find((node) => node['@type'] === 'WebPage')!;
        expect(page, url).toMatchObject({
          '@id': url + '#webpage',
          url,
          name: title,
          description,
          isPartOf: { '@id': 'https://www.visualnerve.com/#website' },
        });
        if (canonical.pathname !== '/') {
          const breadcrumb = graph.find((node) => node['@type'] === 'BreadcrumbList')!;
          expect(page.breadcrumb, url).toEqual({ '@id': breadcrumb['@id'] });
          const items = breadcrumb.itemListElement as {
            position: number;
            name: string;
            item: string;
          }[];
          expect(
            items.map((item) => item.position),
            url,
          ).toEqual(items.map((_, index) => index + 1));
          expect(items[0], url).toMatchObject({
            name: 'Visual Nerve',
            item: 'https://www.visualnerve.com/',
          });
          expect(items.at(-1)?.item, url).toBe(url);
          for (const item of items) expect(locations, url).toContain(item.item);
          if (/\/help\/.+\/$/.test(url))
            expect(items[1], url).toMatchObject({
              name: 'Help',
              item: 'https://www.visualnerve.com/help/',
            });
        }
      }
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
      expect(sitemap).not.toContain('/api/docs/');
      expect(sitemap).not.toContain('/error.html');
      expect(existsSync(join(directory, 'app'))).toBe(false);
      for (const route of ['api/docs/index.html', 'error.html']) {
        const html = readFileSync(join(directory, route), 'utf8');
        expect(metadata(html, 'robots'), route).toContain('noindex');
        expect(html, route).not.toContain('application/ld+json');
      }
      for (const route of [
        'index.html',
        'features/index.html',
        'help/index.html',
        'help/uml/index.html',
        'api/docs/index.html',
        'error.html',
      ]) {
        const html = readFileSync(join(directory, route), 'utf8');
        for (const [path, type, sizes] of [
          ['/site/mark.svg', 'image/svg+xml', 'any'],
          ['/favicon-96x96.png', 'image/png', '96x96'],
          ['/favicon.ico', 'image/x-icon', '16x16 32x32 48x48 256x256'],
          ['/apple-touch-icon.png', undefined, '180x180'],
        ] as const) {
          const link = html.match(
            new RegExp(`<link[^>]*href="${path.replaceAll('.', '\\.')}"[^>]*>`),
          )?.[0];
          expect(link, route).toContain(`sizes="${sizes}"`);
          if (type) expect(link, route).toContain(`type="${type}"`);
          expect(existsSync(join(directory, path)), route + path).toBe(true);
        }
      }
      expect(readFileSync(join(directory, 'robots.txt'), 'utf8')).toContain(
        'Sitemap: https://www.visualnerve.com/sitemap.xml',
      );
      for (const route of ['help/index.html'])
        expect(readFileSync(join(directory, route), 'utf8')).not.toContain('/site/consent.js');
      const features = readFileSync(join(directory, 'features/index.html'), 'utf8');
      expect(home).toContain('device-frame--laptop');
      expect(features).toContain('data-appearance-image');
      expect(features).toContain('site-capture--phone');
      expect(features).toContain('site-capture--detail');
      expect(features).toMatch(/phone.webp[^>]*width="390" height="844"/);
      const guide = readFileSync(join(directory, 'help/getting-started/index.html'), 'utf8');
      expect(guide).toContain('class="help-figure"');
      expect(guide).not.toContain('site-capture--');
      for (const route of ['help/api-mcp/index.html', 'mcp/index.html']) {
        const connectionGuide = readFileSync(join(directory, route), 'utf8');
        const shellExamples = [
          ...connectionGuide.matchAll(/<code class="language-sh"[^>]*>([\s\S]*?)<\/code>/g),
        ]
          .map((match) => match[1].replace(/<[^>]*>/g, ''))
          .join('\n');
        expect(shellExamples, route).toContain('--allowed-origin https://app.visualnerve.com');
        expect(shellExamples, route).not.toContain('visualnerve.caripson.com');
        expect(connectionGuide, route).toContain('https://app.visualnerve.com');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
