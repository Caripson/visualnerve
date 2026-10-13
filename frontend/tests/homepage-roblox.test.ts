import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const output: Record<string, string> = {};
beforeAll(() => {
  for (const environment of ['staging', 'production']) {
    const directory = mkdtempSync(join(tmpdir(), 'visualnerve-home-roblox-'));
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
it('makes the real consent-gated game template discoverable with a clear three-step process in both environments', () => {
  for (const environment of ['staging', 'production']) {
    const document = page(environment);
    const section = document.querySelector('#roblox')!;
    expect(section).not.toBeNull();
    expect(section.getAttribute('aria-labelledby')).toBe('roblox-heading');
    expect(section.querySelector('h2')!.textContent).toContain('Your game.');
    expect(section.querySelectorAll('ol > li')).toHaveLength(3);
    expect(section.querySelector('.site-button')!.getAttribute('href')).toBe(
      `${environment === 'production' ? 'https://app.visualnerve.com/' : '/app/'}?demo=roblox-game-builder`,
    );
    expect(section.textContent).toContain('Download a real Studio place');
    expect(section.textContent).toContain('storage consent and workspace unlock');
    expect(section.querySelector('a[href="/help/roblox-game-builder/"]')).not.toBeNull();
    expect(section.querySelector('script,iframe,canvas,video')).toBeNull();
    expect(document.querySelector('script[src^="/editor/"]')).toBeNull();
    expect(document.querySelector('link[href="/site/roblox.css"]')).not.toBeNull();
    for (const path of [
      'features/index.html',
      'help/roblox-game-builder/index.html',
      'app/index.html',
    ])
      expect(page(environment, path).querySelector('link[href="/site/roblox.css"]')).toBeNull();
  }
});
it('keeps the concept art transparent, accessible and free of baked-in product text', () => {
  const section = page('staging').querySelector('#roblox')!;
  const svg = section.querySelector('svg')!;
  expect(svg.getAttribute('fill')).toBe('none');
  expect(svg.getAttribute('role')).toBe('img');
  expect(svg.querySelector('title')!.textContent).toContain('World pieces');
  expect(svg.querySelector('desc')!.textContent).toContain('concept illustration');
  expect(svg.querySelector('script,image,foreignObject,text')).toBeNull();
  expect(
    [...svg.querySelectorAll('rect')].some(
      (element) =>
        element.getAttribute('width') === '640' && element.getAttribute('height') === '440',
    ),
  ).toBe(false);
});
