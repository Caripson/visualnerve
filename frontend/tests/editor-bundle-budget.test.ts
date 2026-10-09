// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditEditorBundle, EDITOR_BUNDLE_BUDGETS } from '../../scripts/audit-editor-bundle.mjs';

const directories: string[] = [];
const locales = ['en', 'da', 'nb', 'sv', 'fi', 'de', 'es', 'fr'];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-bundle-'));
  directories.push(directory);
  const put = (path: string, source: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), source);
  };
  const catalog = (locale: string) =>
    `const messages=${JSON.stringify({
      'app.settings': `${locale} Settings`,
      'settings.appLanguage': `${locale} App language`,
      'presentation.play': `${locale} Play`,
      'workspace.newDiagram': `${locale} New diagram`,
    })}; export {messages as default};`;
  for (const [index, locale] of locales.entries())
    put(`assets/display-${index}.js`, catalog(locale));
  const loaders = `const imports={${locales.map((locale, index) => `${locale}:()=>import('./assets/display-${index}.js')`).join(',')}};`;
  put(
    'app.js',
    `import './assets/runtime.js';${loaders}export const open=()=>import('./assets/optional.js');`,
  );
  put('assets/runtime.js', `import './shared.js';globalThis.__BUNDLE_AUDIT_EXECUTED__=true;`);
  put('assets/shared.js', `export const shared='safe';`);
  put(
    'assets/optional.js',
    `export * from './shared.js';export const exportTool=()=>import('./export.js');`,
  );
  put('assets/export.js', `export const content='PDF';`);
  return { directory, put, catalog, loaders };
}
const padding = (bytes: number) => `/*${'a'.repeat(bytes)}*/`;
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it('audits built static/dynamic/re-export boundaries, not names or execution', () => {
  const f = fixture();
  f.put('assets/worker-only.js', `${padding(1_600_000)}throw new Error('Never executed');`);
  f.put(
    'assets/optional.js',
    "export const startWorker=()=>new Worker(new URL('./worker-only.js',import.meta.url),{type:'module'}); export const exportTool=()=>import('./export.js');",
  );
  const report = auditEditorBundle(f.directory);
  expect(report.initial.files).toEqual(['app.js', 'assets/runtime.js', 'assets/shared.js']);
  expect(report.mainThread.files).toContain('assets/export.js');
  expect(report.mainThread.files).not.toContain('assets/worker-only.js');
  expect(Object.keys(report.catalogs)).toEqual(locales);
  expect(report.catalogs.sv.file).toBe('assets/display-3.js');
  expect(globalThis).not.toHaveProperty('__BUNDLE_AUDIT_EXECUTED__');
});

it('rejects a static English catalogue import even when all eight literal lazy imports remain', () => {
  const f = fixture();
  f.put('assets/runtime.js', `export {default as english} from './display-0.js';`);
  expect(() => auditEditorBundle(f.directory)).toThrow(
    /catalogue .*display-0.js.*eagerly imported/,
  );
  expect(() => auditEditorBundle(f.directory)).toThrow(/static importer: assets\/runtime.js/);
});

it('rejects embedding English in a renamed optional UI chunk instead of its own dynamic catalogue', () => {
  const f = fixture();
  f.put('assets/optional.js', f.catalog('en'));
  expect(() => auditEditorBundle(f.directory)).toThrow('found 9');
});

it('collects all byte budget failures and catches an oversized lazy export without filename exemptions', () => {
  const f = fixture();
  f.put(
    'app.js',
    `${f.loaders}import './assets/runtime.js';${padding(EDITOR_BUNDLE_BUDGETS.entryBytes)}`,
  );
  f.put('assets/runtime.js', `import './optional.js';${padding(350_000)}`);
  f.put('assets/optional.js', `import './export.js';export const harmless=1;`);
  f.put('assets/export.js', padding(EDITOR_BUNDLE_BUDGETS.mainThreadChunkBytes));
  let message = '';
  try {
    auditEditorBundle(f.directory);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain('Entry app.js');
  expect(message).toContain('Initial static import closure');
  expect(message).toContain('Main-thread chunk assets/export.js');
});

it('rejects total eager growth spread across multiple individually small chunks', () => {
  const f = fixture();
  f.put('assets/runtime.js', `import './shared.js';${padding(380_000)}`);
  f.put('assets/shared.js', `import './optional.js';${padding(380_000)}`);
  f.put('assets/optional.js', padding(380_000));
  expect(() => auditEditorBundle(f.directory)).toThrow('Initial static import closure');
  expect(() => auditEditorBundle(f.directory)).not.toThrow('Main-thread chunk');
});

it('is cycle-safe while rejecting eager catalogue imports through optional UI', () => {
  const f = fixture();
  f.put('assets/export.js', `import './optional.js'; import './display-5.js';`);
  expect(() => auditEditorBundle(f.directory)).toThrow('static importer: assets/export.js');
});

it('rejects missing, merged or undiscoverable locale chunks', () => {
  const f = fixture();
  f.put(
    'app.js',
    f.loaders.replace(
      "fr:()=>import('./assets/display-7.js')",
      "fr:()=>import('./assets/display-0.js')",
    ),
  );
  expect(() => auditEditorBundle(f.directory)).toThrow('own distinct catalogue chunk');
  f.put('app.js', "const locale='en'; export const catalog=()=>import(`./assets/${locale}.js`);");
  expect(() => auditEditorBundle(f.directory)).toThrow('one literal local path');
});

it.each([
  "import '../outside.js';",
  "import 'https://example.com/code.js';",
  "import './assets/runtime.js?raw';",
])('rejects unsupported or escaping built import %s', (source) => {
  const f = fixture();
  f.put('app.js', source);
  expect(() => auditEditorBundle(f.directory)).toThrow(/escapes|Unsupported/);
});

it('rejects missing imports and symlinked modules instead of reading outside output', () => {
  const f = fixture();
  f.put('app.js', "import './assets/missing.js';");
  expect(() => auditEditorBundle(f.directory)).toThrow('Missing built module');
  symlinkSync(join(f.directory, 'assets/runtime.js'), join(f.directory, 'assets/alias.js'));
  f.put('app.js', "import './assets/alias.js';");
  expect(() => auditEditorBundle(f.directory)).toThrow('regular files inside');
});

it('rejects malformed emitted JavaScript instead of trusting partial import discovery', () => {
  const f = fixture();
  f.put('assets/optional.js', "export const broken = import('./export.js'); } }");
  expect(() => auditEditorBundle(f.directory)).toThrow('Invalid built JavaScript');
});
