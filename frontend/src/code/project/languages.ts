import { codeLanguageIds, codeLimits, type CodeFile, type CodeLanguage } from '../types';

/** Explicit choices use the same relative paths displayed by the ZIP preview. */
export function applyProjectLanguages(files: CodeFile[], overrides: unknown): CodeFile[] {
  if (overrides === undefined) return files;
  if (
    !overrides ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides) ||
    (Object.getPrototypeOf(overrides) !== Object.prototype &&
      Object.getPrototypeOf(overrides) !== null) ||
    Object.getOwnPropertySymbols(overrides).length
  )
    throw new Error(
      'Project language overrides must be an object of file paths and supported language IDs.',
    );
  const names = Object.keys(overrides);
  if (names.length > codeLimits.files)
    throw new Error('Choose language overrides for at most 500 project files.');
  const paths = new Set(files.map((file) => file.path));
  const selected = new Map<string, CodeLanguage>();
  for (const path of names) {
    if (['__proto__', 'prototype', 'constructor'].includes(path))
      throw new Error('Project language override paths cannot use prototype properties.');
    if (!paths.has(path))
      throw new Error(
        `Language override does not match an analyzed project file: ${path.slice(0, 500)}. Use the exact relative path shown after archive root removal.`,
      );
    const descriptor = Object.getOwnPropertyDescriptor(overrides, path);
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !codeLanguageIds.includes(descriptor.value as CodeLanguage)
    )
      throw new Error(`Choose a supported language ID for project file ${path}.`);
    selected.set(path, descriptor.value as CodeLanguage);
  }
  return files.map((file) =>
    selected.has(file.path) ? { ...file, language: selected.get(file.path)! } : file,
  );
}
