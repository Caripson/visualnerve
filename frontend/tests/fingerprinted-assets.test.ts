// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fingerprintAssets } from '../../scripts/fingerprinted-assets.mjs';
import { auditStatic } from '../../scripts/audit-static.mjs';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visual-nerve-image-cache-'));
  directories.push(directory);
  function put(path: string, value: string) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), value);
  }
  for (const path of [
    'index.html',
    'error.html',
    'editor/app.js',
    'appearance.js',
    'privacy/index.html',
    'sw.js',
  ])
    put(path, 'fixture');
  put('site/images/desktop.webp', 'light image');
  put('site/images/desktop-dark.webp', 'dark image');
  put('site/images/desktop-480.webp', 'responsive light');
  put('site/devices/desktop.svg', '<svg/>');
  put('help/images/notation-uml.webp', 'help image');
  return { directory, put };
}

describe('content-addressed image delivery', () => {
  it('rewrites complete HTML paths including themes, srcset and social URLs, retaining stable aliases', () => {
    const { directory, put } = fixture();
    put(
      'index.html',
      '<img src="/site/images/desktop.webp" srcset="/site/images/desktop-480.webp 480w, /site/images/desktop.webp 1920w" data-appearance-dark="/site/images/desktop-dark.webp"><meta content="https://www.visualnerve.com/site/images/desktop.webp"><img src="/site/devices/desktop.svg">',
    );
    put('help/uml/index.html', '<a href="/help/images/notation-uml.webp">Help</a>');
    const first = fingerprintAssets(directory);
    expect(first.size).toBe(5);
    for (const [source, path] of first) {
      expect(readFileSync(join(directory, path))).toEqual(readFileSync(join(directory, source)));
      expect(path).toMatch(/-[a-f0-9]{16}\.(?:webp|svg)$/);
    }
    const html = readFileSync(join(directory, 'index.html'), 'utf8');
    expect(html).toContain(
      `https://www.visualnerve.com/site/images/desktop-${hash('light image')}.webp`,
    );
    expect(html).toContain(`/site/images/desktop-480-${hash('responsive light')}.webp 480w`);
    expect(html).toContain(`/site/images/desktop-dark-${hash('dark image')}.webp`);
    expect(html).not.toContain('/site/images/desktop.webp');
    expect(fingerprintAssets(directory)).toEqual(first);
    expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe(html);
    expect(auditStatic(directory)).toContain(`help/images/notation-uml-${hash('help image')}.webp`);
  });

  it('changes the public image address when image content changes in a clean build', () => {
    const first = fixture(),
      second = fixture();
    second.put('site/images/desktop.webp', 'new image');
    expect(fingerprintAssets(first.directory).get('/site/images/desktop.webp')).not.toBe(
      fingerprintAssets(second.directory).get('/site/images/desktop.webp'),
    );
  });

  it('accepts the compact simulator Help pair and verified hashes without expanding the screenshot allowlist', () => {
    const { directory, put } = fixture();
    for (const suffix of ['', '-dark'])
      put(`help/images/simulation-compact${suffix}.webp`, `compact ${suffix} synthetic fixture`);
    const mapping = fingerprintAssets(directory);
    for (const suffix of ['', '-dark']) {
      const path = `/help/images/simulation-compact${suffix}.webp`;
      expect(auditStatic(directory)).toContain(path.slice(1));
      expect(auditStatic(directory)).toContain(mapping.get(path)!.slice(1));
    }
    put('help/images/simulation-compact-private-export.webp', 'unapproved');
    fingerprintAssets(directory);
    expect(() => auditStatic(directory)).toThrow('Unexpected file');
  });

  it('rejects corrupted hashes and unapproved source names before deployment', () => {
    const { directory, put } = fixture();
    fingerprintAssets(directory);
    put(`site/images/desktop-${hash('light image')}.webp`, 'corrupted');
    expect(() => auditStatic(directory)).toThrow('Invalid content fingerprint');
    put(`site/images/desktop-${hash('light image')}.webp`, 'light image');
    put('site/images/private-export.webp', 'private');
    put(`site/images/private-export-${hash('private')}.webp`, 'private');
    expect(() => auditStatic(directory)).toThrow('Unexpected file');
  });

  it('accepts only the four curated capacity captures and native frames, including verified fingerprints', () => {
    const { directory, put } = fixture();
    put('site/infrastructure.css', '.home-infrastructure{}');
    for (const name of ['api', 'network', 'energy', 'datacenter'])
      for (const suffix of ['', '-dark'])
        for (const width of ['', '-480', '-960'])
          put(
            `site/images/infrastructure-${name}${width}${suffix}.webp`,
            `${name}${width}${suffix} synthetic fixture`,
          );
    for (const name of ['monitor', 'peripherals'])
      put(`site/devices/infrastructure-${name}.svg`, '<svg/>');
    const mapping = fingerprintAssets(directory);
    expect(auditStatic(directory)).toContain('site/infrastructure.css');
    for (const name of ['api', 'network', 'energy', 'datacenter'])
      expect(auditStatic(directory)).toContain(
        mapping.get(`/site/images/infrastructure-${name}.webp`)!.slice(1),
      );
    put('site/images/infrastructure-private-export.webp', 'unapproved');
    fingerprintAssets(directory);
    expect(() => auditStatic(directory)).toThrow('Unexpected file');
  });
});
