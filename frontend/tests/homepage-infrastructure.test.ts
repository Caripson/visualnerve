// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const templates = [
  ['api', 'API & Compute Capacity', 'api-compute-capacity'],
  ['network', 'Network & Multi-Site Capacity', 'network-multi-site-capacity'],
  ['energy', 'Energy & Power Capacity', 'energy-power-capacity'],
  ['datacenter', 'Datacenter Capacity', 'datacenter-capacity'],
] as const;
const output: Record<string, string> = {};
beforeAll(() => {
  for (const environment of ['staging', 'production']) {
    const directory = mkdtempSync(join(tmpdir(), 'visualnerve-home-infrastructure-'));
    output[environment] = directory;
    const result = spawnSync('hugo', ['--source', resolve('../hugo'), '--destination', directory], {
      encoding: 'utf8',
      env: { ...process.env, HUGO_PARAMS_ENVIRONMENT: environment },
    });
    if (result.status !== 0) throw new Error(result.stderr);
  }
});
afterAll(() =>
  Object.values(output).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);
function page(environment: string, path = 'index.html') {
  return new DOMParser().parseFromString(
    readFileSync(join(output[environment], path), 'utf8'),
    'text/html',
  );
}

it('publishes four semantic template entries with consent-gated app links in both environments', () => {
  for (const environment of ['staging', 'production']) {
    const document = page(environment),
      section = document.querySelector('#infrastructure')!;
    expect(section).not.toBeNull();
    expect(section.getAttribute('aria-labelledby')).toBe('infrastructure-heading');
    expect(section.querySelector('h2')!.textContent).toMatch(/Where does.*capacity run out\?/);
    expect(section.querySelectorAll('h3')).toHaveLength(4);
    expect(section.querySelector('figcaption')!.textContent).toContain(
      'Captured simulation states from the real app',
    );
    for (const [name, title, key] of templates) {
      const card = [...section.querySelectorAll('.infrastructure-template')].find(
        (value) => value.querySelector('h3')?.textContent === title,
      )!;
      expect(card).not.toBeUndefined();
      expect(card.querySelector('a')!.getAttribute('href')).toBe(
        `${environment === 'production' ? 'https://app.visualnerve.com/' : '/app/'}?demo=${key}`,
      );
      const monitor = section.querySelector(`.infrastructure-monitor--${name}`)!;
      const screen = monitor.querySelector<HTMLImageElement>(
        '.infrastructure-monitor__screen img',
      )!;
      expect(screen.getAttribute('src')).toBe(`/site/images/infrastructure-${name}.webp`);
      expect(screen.getAttribute('width')).toBe('1440');
      expect(screen.getAttribute('height')).toBe('900');
      expect(screen.alt).toContain('simulator');
      expect(screen.getAttribute('loading')).toBe('lazy');
      for (const width of [480, 960])
        expect(screen.getAttribute('srcset')).toContain(
          `/site/images/infrastructure-${name}-${width}.webp ${width}w`,
        );
      const dark = monitor.querySelector('picture > source')!.getAttribute('srcset')!;
      expect(dark).toContain(`/site/images/infrastructure-${name}-dark.webp`);
      for (const width of [480, 960])
        expect(dark).toContain(`/site/images/infrastructure-${name}-${width}-dark.webp ${width}w`);
      expect(monitor.querySelector('.infrastructure-monitor__hardware')!.getAttribute('alt')).toBe(
        '',
      );
    }
    expect(section.querySelector('a[href="/help/infrastructure-capacity/"]')).not.toBeNull();
    expect(document.querySelectorAll('link[href="/site/infrastructure.css"]')).toHaveLength(1);
    for (const path of [
      'features/index.html',
      'help/infrastructure-capacity/index.html',
      'app/index.html',
      'api/docs/index.html',
    ])
      expect(
        page(environment, path).querySelector('link[href="/site/infrastructure.css"]'),
      ).toBeNull();
    expect(document.querySelector('script[src^="/editor/"]')).toBeNull();
    expect(section.querySelector('script, iframe, canvas, video')).toBeNull();
  }
});

it('uses transparent repo-native monitor and keyboard/mouse vectors without scripts or baked-in text', () => {
  for (const name of ['monitor', 'peripherals']) {
    const svg = new DOMParser().parseFromString(
      readFileSync(resolve(`../hugo/static/site/devices/infrastructure-${name}.svg`), 'utf8'),
      'image/svg+xml',
    );
    expect(svg.querySelector('svg')).not.toBeNull();
    expect(svg.querySelector('script, image, foreignObject, text')).toBeNull();
    expect(svg.documentElement.getAttribute('fill')).toBe('none');
  }
});
