import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { loadProjectArchive } from '../src/code/project/archive';
import { applyProjectLanguages } from '../src/code/project/languages';
import { parseCode } from '../src/code/analyzer';
import { getCodeAnalysis, getCodeObject } from '../src/code/schema';
import type { CodeFile } from '../src/code/types';

const files: CodeFile[] = [
  { path: 'include/public.h', content: 'void run(void);' },
  { path: 'src/main.py', content: 'def run(): pass', language: 'python' },
];
describe('explicit project language selection', () => {
  it('resolves an ambiguous ZIP file through the same analyzer used by UI imports', () => {
    const archive = loadProjectArchive(
      zipSync({
        'repo/include/public.h': strToU8('void run(void);'),
        'repo/src/main.py': strToU8('def run(): pass'),
      }),
    );
    expect(archive.files[0].language).toBeUndefined();
    expect(() => parseCode({ files: archive.files })).toThrow('explicit language');
    const result = parseCode({
      files: applyProjectLanguages(archive.files, { 'include/public.h': 'c' }),
      mode: 'files',
    });
    expect(getCodeAnalysis(result.graph)?.languages).toEqual(['c', 'python']);
    expect(
      result.graph.nodes.map(getCodeObject).find((object) => object?.path === 'include/public.h')
        ?.language,
    ).toBe('c');
    expect(archive.files[0].language).toBeUndefined();
  });

  it('allows overrides of detected languages without mutating source content or other files', () => {
    const selected = applyProjectLanguages(files, {
      'include/public.h': 'cpp',
      'src/main.py': 'shell',
    });
    expect(selected.map((file) => file.language)).toEqual(['cpp', 'shell']);
    expect(selected.map((file) => file.content)).toEqual(files.map((file) => file.content));
    expect(files.map((file) => file.language)).toEqual([undefined, 'python']);
    expect(applyProjectLanguages(files, undefined)).toBe(files);
    expect(applyProjectLanguages(files, {})).toEqual(files);
    expect(
      applyProjectLanguages(
        files,
        Object.assign(Object.create(null), { 'include/public.h': 'c' }),
      )[0].language,
    ).toBe('c');
  });

  it.each([
    null,
    [],
    'c',
    1,
    true,
    new Date(),
    new Map(),
    Object.create({ 'include/public.h': 'c' }),
  ])('rejects an invalid or inherited override object: %j', (overrides) => {
    expect(() => applyProjectLanguages(files, overrides)).toThrow('must be an object');
  });

  it.each([
    'repo/include/public.h',
    'Include/public.h',
    'include/public.h ',
    ' include/public.h',
    './include/public.h',
    '../include/public.h',
    '/include/public.h',
    'include\\public.h',
    'src/missing.py',
    'src/main.py/../main.py',
    'dynamic.prototype',
  ])('rejects unknown, noncanonical or misspelled paths: %s', (path) => {
    expect(() => applyProjectLanguages(files, { [path]: 'c' })).toThrow('does not match');
  });

  it.each(['C', 'c++', 'unknown', '', undefined, null, 1, {}, ['c']])(
    'rejects unsupported language values: %j',
    (language) => {
      expect(() => applyProjectLanguages(files, { 'include/public.h': language })).toThrow(
        'supported language ID',
      );
    },
  );

  it('rejects prototype-property injection without changing any prototype', () => {
    for (const path of ['__proto__', 'prototype', 'constructor']) {
      const overrides = JSON.parse(`{"${path}":"c"}`);
      expect(() =>
        applyProjectLanguages([...files, { path, content: '#!/bin/sh\ntrue' }], overrides),
      ).toThrow('prototype properties');
    }
    expect(({} as Record<string, unknown>).language).toBeUndefined();
  });

  it('does not invoke accessor properties or accept symbolic overrides', () => {
    const getter = vi.fn(() => 'c');
    const overrides = Object.defineProperty({}, 'include/public.h', {
      enumerable: true,
      get: getter,
    });
    expect(() => applyProjectLanguages(files, overrides)).toThrow('supported language ID');
    expect(getter).not.toHaveBeenCalled();
    expect(() => applyProjectLanguages(files, { [Symbol('private')]: 'c' })).toThrow(
      'must be an object',
    );
  });

  it('bounds override count before examining values or matching paths', () => {
    const overrides = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`file${index}.py`, 'python']),
    );
    expect(() => applyProjectLanguages(files, overrides)).toThrow('at most 500');
  });
});
