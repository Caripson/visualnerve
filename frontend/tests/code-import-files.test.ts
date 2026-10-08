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
  expect(importKind('Workflow.DRAWIO')).toBe('diagram-file');
  expect(importKind('Plan.vsdx')).toBe('diagram-file');
  expect(importKind('schema.vega.json')).toBe('code');
  expect(importKind('model.m')).toBe('code');
  expect(importKind('main.ts')).toBe('code');
  expect(importSelection([file('main.py'), file('helper.py')])).toBe('code');
  expect(importSelection([file('main.py'), file('sales.csv')])).toBe('mixed');
  expect(importSelection([file('one.csv'), file('two.tsv')])).toBe('csv');
  expect(importSelection([file('one.drawio'), file('two.vsdx')])).toBe('mixed');
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
  Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
  await expect(readCodeFiles([first, oversized])).rejects.toThrow('50 MB');
  expect(oversized.text).not.toHaveBeenCalled();
  await expect(readCodeFiles(Array.from({ length: 501 }, () => first))).rejects.toThrow('500');
});

it('loads Markdown folders and identifies ambiguous source from content without guessing', async () => {
  const examples = [
    ['start.md', '# Start\n[Next](./next.md)', 'markdown'],
    ['engine.h', 'namespace app { class Engine {}; }', 'cpp'],
    ['plain.h', 'void run(void);', undefined],
    ['calculate.m', 'function result = calculate(value)\n result = value;\nend', 'matlab'],
    ['query.m', 'let Source = 1 in Source', 'powerquery'],
    ['Model.cls', 'public class Model {}', 'apex'],
    ['Legacy.cls', 'Option Explicit\nPrivate Sub Run()\nEnd Sub', 'vba'],
  ] as const;
  const files = examples.map(([name, content]) => {
    const value = new File([content], name);
    Object.defineProperty(value, 'webkitRelativePath', { value: `project/${name}` });
    Object.defineProperty(value, 'text', { value: vi.fn().mockResolvedValue(content) });
    return value;
  });
  expect(selectFolderFiles(files)).toEqual({ files, ignored: 0 });
  expect(
    (await readCodeFiles(files)).map(({ path, content, language }) => [path, content, language]),
  ).toEqual(examples.map(([name, content, language]) => [`project/${name}`, content, language]));
});

it('applies archive path exclusions to folder selection while avoiding unknown extensionless files', () => {
  const selected = file('guide.md', 'project/docs/guide.md');
  const input = [
    selected,
    file('helper.py', 'project/.ssh/helper.py'),
    file('credentials.py', 'project/credentials.py'),
    file('bundle.min.js', 'project/ui/bundle.min.js'),
    file('generated.py', 'project/generated/generated.py'),
    file('output.py', 'project/target/output.py'),
    file('README', 'project/README'),
    file('LICENSE', 'project/LICENSE'),
  ];
  expect(selectFolderFiles(input)).toEqual({ files: [selected], ignored: 7 });
});
