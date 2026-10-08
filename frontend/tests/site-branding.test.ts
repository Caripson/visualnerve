// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
    return new DOMParser().parseFromString(
      readFileSync(join(directory, path), 'utf8'),
      'text/html',
    );
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

  it('renders feature icons as fixed-size vectors instead of wrapping font characters', () => {
    const icons = page('index.html').querySelectorAll('.feature-card .feature-icon');
    expect(icons).toHaveLength(4);
    const geometry = new Set<string>();
    for (const icon of icons) {
      const svg = icon.querySelector('svg')!;
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('width')).toBe('20');
      expect(svg.getAttribute('height')).toBe('20');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
      expect(svg.querySelector('text, image, foreignObject, script')).toBeNull();
      expect(icon.textContent?.trim()).toBe('');
      geometry.add(svg.innerHTML);
    }
    expect(geometry.size).toBe(4);
  });

  it('offers direct email contact while keeping public bugs and security reports separate', () => {
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
    ]) {
      const footer = page(route).querySelector('.public-footer')!;
      const email = footer.querySelector('a[href="mailto:hello@visualnerve.com"]')!;
      expect(email?.textContent, route).toBe('Contact by email');
      expect(
        footer.querySelector('a[href="https://github.com/Caripson/visualnerve/issues/new/choose"]'),
        route,
      ).not.toBeNull();
    }
    for (const route of [
      'privacy/index.html',
      'security/index.html',
      'help/troubleshooting/index.html',
    ]) {
      const main = page(route).querySelector('main')!;
      expect(main.querySelector('a[href="mailto:hello@visualnerve.com"]'), route).not.toBeNull();
      expect(main.textContent, route).not.toMatch(
        /No external private reporting address|while the project is private/,
      );
    }
    expect(
      page('security/index.html').querySelector(
        'main a[href="https://github.com/Caripson/visualnerve/security"]',
      ),
    ).not.toBeNull();
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

  it('floats the menu on exactly the six requested product routes', () => {
    const floating = [
      'index.html',
      'features/index.html',
      'use-cases/index.html',
      'process-simulator/index.html',
      'mcp/index.html',
      'developers/index.html',
    ];
    for (const route of [
      ...floating,
      'privacy/index.html',
      'security/index.html',
      'license/index.html',
      'error.html',
      'app/index.html',
      'help/index.html',
      'api/docs/index.html',
    ]) {
      expect(!!page(route).querySelector('.public-header-shell--floating'), route).toBe(
        floating.includes(route),
      );
    }
  });

  it('pairs real app captures while leaving hardware transparent and cropped dialogs unframed', () => {
    const home = page('index.html');
    expect(home.querySelectorAll('.device-showcase picture[data-appearance-image]')).toHaveLength(
      4,
    );
    for (const device of ['desktop', 'laptop', 'tablet', 'phone']) {
      const frame = home.querySelector(`.device-frame--${device}`)!;
      expect(frame.querySelector('picture source')?.getAttribute('srcset')).toBe(
        `/site/images/${device}-dark.webp`,
      );
      expect(frame.querySelector('picture img')?.getAttribute('src')).toBe(
        `/site/images/${device}.webp`,
      );
      const hardware = frame.querySelector('.device-frame__hardware')!;
      expect(hardware.getAttribute('src')).toBe(`/site/devices/${device}.svg`);
      expect(hardware.getAttribute('aria-hidden')).toBe('true');
      expect(hardware.getAttribute('alt')).toBe('');
      const svg = readFileSync(join(directory, `site/devices/${device}.svg`), 'utf8');
      expect(svg).toContain('fill-rule="evenodd"');
    }
    const features = page('features/index.html');
    expect(features.querySelector('.site-capture--detail .device-frame')).toBeNull();
    expect(
      features.querySelector('.site-capture--detail .site-capture__detail picture'),
    ).not.toBeNull();
    for (const route of ['features/index.html', 'help/simulation/index.html']) {
      for (const link of page(route).querySelectorAll<HTMLAnchorElement>(
        '[data-appearance-link]',
      )) {
        const source = link.querySelector('picture source')!;
        expect(source.getAttribute('srcset')).toBe(link.dataset.appearanceDark);
        expect(link.querySelector('picture img')?.getAttribute('src')).toBe(
          link.dataset.appearanceLink,
        );
      }
    }
  });
});
