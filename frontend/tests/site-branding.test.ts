// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

describe('shared workspace branding', () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'visualnerve-branding-'));
    const result = spawnSync('hugo', ['--source', resolve('../hugo'), '--destination', directory], {
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr);
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  function page(path: string) {
    return new JSDOM(readFileSync(join(directory, path), 'utf8')).window.document;
  }

  it('uses the workspace symbol in every public header and footer, including the error page', () => {
    const nativeSymbol = page('app/index.html').querySelector('.site-brand .brand-symbol')!;
    for (const route of [
      'index.html',
      'features/index.html',
      'use-cases/index.html',
      'process-simulator/index.html',
      'mcp/index.html',
      'developers/index.html',
      'privacy/index.html',
      'security/index.html',
      'license/index.html',
      'error.html',
    ]) {
      const document = page(route);
      const header = document.querySelector('.public-header-shell > .public-header')!;
      expect(header, route).not.toBeNull();
      const brands = document.querySelectorAll('.public-brand');
      expect(brands.length, route).toBe(route === 'error.html' ? 1 : 2);
      for (const brand of brands) {
        expect(brand.querySelector('.brand-symbol')?.textContent, route).toBe(
          nativeSymbol.textContent,
        );
        expect(brand.querySelector('.brand-symbol')?.getAttribute('aria-hidden'), route).toBe(
          'true',
        );
        expect(brand.querySelector('img'), route).toBeNull();
      }
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href'), route).toBe(
        '/site/mark.svg',
      );
    }
  });

  it('keeps native app, help and API headers consistent and free of analytics', () => {
    const appSymbol = page('app/index.html').querySelector('.site-brand .brand-symbol')!;
    for (const route of ['app/index.html', 'help/index.html', 'api/docs/index.html']) {
      const document = page(route);
      expect(document.querySelector('.site-brand .brand-symbol')?.textContent, route).toBe(
        appSymbol.textContent,
      );
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href'), route).toBe(
        '/site/mark.svg',
      );
      expect(document.querySelector('script[src="/site/consent.js"]'), route).toBeNull();
      expect(document.querySelector('script[src*="googletagmanager"]'), route).toBeNull();
    }
  });
});
