import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { loadProjectArchive } from '../src/code/project/archive';
import { applyProjectLanguages } from '../src/code/project/languages';
import { attachProjectAnalysis } from '../src/code/project/analysis';
import { parseCode } from '../src/code/analyzer';
import { normalizeCodeInput } from '../src/code/input';
import { readCodeFiles } from '../src/code/importFiles';
import { getCodeAnalysis, getProjectDirectory } from '../src/code/schema';
import { LARGE_PROJECT_FILE_WARNING } from '../src/code/project/limits';
import { useEditor } from '../src/state/editor';

const zip = (count: number) =>
  zipSync(
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`repo/src/file${index}.py`, strToU8('pass')]),
    ),
  );
afterEach(() => useEditor.setState({ projectSourceFileLimit: 500 }));

describe('independent ZIP source-file budgets', () => {
  it('fails a real 501-file ZIP by default, analyzes every file with a raised budget, and retains valid metadata after reset', () => {
    const bytes = zip(501);
    expect(() => loadProjectArchive(bytes)).toThrow('more than 500 analyzable files');
    const archive = loadProjectArchive(bytes, 'Large project', { fileLimit: 1000 });
    expect(archive.files).toHaveLength(501);
    expect(archive.fileLimit).toBe(1000);
    const result = attachProjectAnalysis(
      parseCode({ files: archive.files, mode: 'folders' }, undefined, archive.fileLimit),
      archive,
    );
    expect(result.fileCount).toBe(501);
    expect(result.warnings).toContain(LARGE_PROJECT_FILE_WARNING);
    expect(
      getProjectDirectory(
        result.graph.nodes.find((node) => getProjectDirectory(node)?.path === '.')!,
      )?.fileCount,
    ).toBe(501);
    useEditor.setState({ projectSourceFileLimit: 500 });
    const reloaded = JSON.parse(JSON.stringify(result.graph));
    expect(getCodeAnalysis(reloaded)).toMatchObject({
      fileCount: 501,
      project: { sourceFileLimit: 1000 },
    });
  });

  it('still rejects 5,001 file cards but allows an aggregated folder map without dropping source files', () => {
    const archive = loadProjectArchive(zip(5001), 'Many files', { fileLimit: 10000 });
    expect(() =>
      parseCode({ files: archive.files, mode: 'files' }, undefined, archive.fileLimit),
    ).toThrow('5,000 objects');
    const folders = parseCode(
      { files: archive.files, mode: 'folders' },
      undefined,
      archive.fileLimit,
    );
    expect(folders.fileCount).toBe(5001);
    expect(folders.graph.nodes.length).toBeLessThan(10);
  });

  it('keeps the archive-entry budget independent, including ignored files and directories', () => {
    const bytes = zipSync(
      Object.fromEntries([
        ['repo/', strToU8('')],
        ['repo/src/', strToU8('')],
        ...Array.from({ length: 9999 }, (_, index) => [
          `repo/node_modules/file${index}.py`,
          strToU8('pass'),
        ]),
      ]),
    );
    expect(() => loadProjectArchive(bytes, 'Too many entries', { fileLimit: 10000 })).toThrow(
      '10,000 entries',
    );
  });

  it('accepts 501 explicit language decisions only with the captured ZIP budget', () => {
    const files = Array.from({ length: 501 }, (_, index) => ({
      path: `file${index}.h`,
      content: 'void run(void);',
    }));
    const languages = Object.fromEntries(files.map((file) => [file.path, 'c']));
    expect(() => applyProjectLanguages(files, languages)).toThrow('at most 500');
    expect(applyProjectLanguages(files, languages, 1000)).toHaveLength(501);
    expect(() => applyProjectLanguages(files, { ...languages, 'missing.h': 'c' }, 1000)).toThrow(
      'does not match',
    );
  });

  it('does not increase ordinary source/folder or per-file line budgets when the saved ZIP preference is higher', async () => {
    useEditor.setState({ projectSourceFileLimit: 10000 });
    const files = Array.from({ length: 501 }, (_, index) => ({
      path: `file${index}.py`,
      content: 'pass',
    }));
    expect(() => normalizeCodeInput({ files })).toThrow('between 1 and 500 code files');
    await expect(
      readCodeFiles(files.map((file) => new File([file.content], file.path))),
    ).rejects.toThrow('at most 500 source files');
    expect(() =>
      parseCode(
        { files: [{ path: 'too-long.py', content: 'pass\n'.repeat(100001) }] },
        undefined,
        10000,
      ),
    ).toThrow('100,000 lines');
  });
});
