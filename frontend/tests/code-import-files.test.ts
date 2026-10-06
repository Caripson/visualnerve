import { expect, it, vi } from 'vitest';
import { importKind, importSelection } from '../src/imports/fileRouting';
import { readCodeFiles, selectFolderFiles } from '../src/code/importFiles';
function file(name: string, path?: string) {
  const value = new File(['def run(): pass'], name);
  Object.defineProperty(value, 'text', { value: vi.fn().mockResolvedValue('def run(): pass') });
  if (path) Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
}
it('preserves CSV, native JSON and richer SQL routes and detects source files', () => {
  expect(importKind('business.sql')).toBe('sql');
  expect(importKind('sales.csv')).toBe('csv');
  expect(importKind('backup.json')).toBe('diagram');
  expect(importKind('schema.vega.json')).toBe('code');
  expect(importKind('model.m')).toBe('code');
  expect(importKind('main.ts')).toBe('code');
  expect(importSelection([file('main.py'), file('helper.py')])).toBe('code');
  expect(importSelection([file('main.py'), file('sales.csv')])).toBe('mixed');
  expect(importSelection([file('one.csv'), file('two.tsv')])).toBe('csv');
});
it('filters folders while keeping ambiguous files available for explicit language choice', () => {
  const files = [
    file('main.py', 'project/main.py'),
    file('model.m', 'project/model.m'),
    file('lib.js', 'project/node_modules/lib.js'),
    file('bundle.js', 'project/dist/bundle.js'),
    file('notes.txt', 'project/notes.txt'),
  ];
  expect(selectFolderFiles(files)).toEqual({ files: files.slice(0, 2), ignored: 3 });
});
it('bounds reads before loading source text and retains relative file paths', async () => {
  const first = file('main.py', 'project/main.py');
  expect(await readCodeFiles([first])).toEqual([
    { path: 'project/main.py', content: 'def run(): pass', language: 'python' },
  ]);
  const oversized = file('large.py');
  Object.defineProperty(oversized, 'size', { value: 5 * 1024 * 1024 + 1 });
  await expect(readCodeFiles([first, oversized])).rejects.toThrow('5 MiB');
  expect(oversized.text).not.toHaveBeenCalled();
  await expect(readCodeFiles(Array.from({ length: 501 }, () => first))).rejects.toThrow('500');
});
