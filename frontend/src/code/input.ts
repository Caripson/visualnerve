import { codeLanguages, detectProjectLanguage } from './catalog';
import { codeLimits, type CodeFile, type CodeInput, type CodeLanguage } from './types';
import {
  assertImportBytes,
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
  utf8Bytes,
} from '../imports/limits';

export interface NormalizedFile extends CodeFile {
  language: CodeLanguage;
}

export function defaultCodeMode(fileCount: number): 'files' | 'symbols' {
  return fileCount === 1 ? 'symbols' : 'files';
}

export function normalizeCodeInput(
  input: CodeInput,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): {
  files: NormalizedFile[];
  mode: 'files' | 'symbols' | 'folders';
  name: string;
  bytes: number;
  focus?: string;
} {
  const limit = checkedImportLimitBytes(byteLimit);
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['name', 'files', 'mode', 'focus'].includes(key))
  )
    throw new Error('Code input has unsupported fields.');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > codeLimits.files)
    throw new Error('Import between 1 and 500 code files.');
  if (input.mode !== undefined && !['files', 'symbols', 'folders'].includes(input.mode))
    throw new Error('Code mode must be files, symbols or folders.');
  for (const key of ['name', 'focus'] as const)
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' || !input[key]!.trim() || input[key]!.length > 500)
    )
      throw new Error(`${key} must be text of at most 500 characters.`);
  const paths = new Set<string>();
  let bytes = 0;
  let totalLines = 0;
  const files = input.files.map((file) => {
    if (
      !file ||
      typeof file !== 'object' ||
      Array.isArray(file) ||
      Object.keys(file).some((key) => !['path', 'content', 'language'].includes(key))
    )
      throw new Error('Each file needs a relative path, content and optional language.');
    if (typeof file.path !== 'string' || typeof file.content !== 'string')
      throw new Error('File path and content must be text.');
    const path = file.path.replaceAll('\\', '/');
    if (
      !path.trim() ||
      path.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(path) ||
      path.startsWith('/') ||
      /^[a-zA-Z]:/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Use a relative file path without empty segments or traversal.');
    if (paths.has(path)) throw new Error(`Duplicate file path: ${path}`);
    paths.add(path);
    assertImportBytes(file.content.length, limit, path);
    const fileBytes = utf8Bytes(file.content);
    assertImportBytes(fileBytes, limit, path);
    bytes += fileBytes;
    assertImportBytes(bytes, limit, 'Code project');
    let lines = 1;
    let lineLength = 0;
    for (const char of file.content) {
      if (char === '\n') {
        lines++;
        lineLength = 0;
      } else lineLength++;
      if (lineLength > codeLimits.lineLength)
        throw new Error(
          `${path} has a line longer than 20,000 characters. Format generated/minified code first.`,
        );
      if (lines > codeLimits.lines)
        throw new Error(`${path} exceeds 100,000 lines. Import a smaller file.`);
    }
    totalLines += lines;
    if (totalLines > codeLimits.totalLines)
      throw new Error('Project exceeds 500,000 lines. Import a smaller folder.');
    if (file.language !== undefined && !codeLanguages.some((entry) => entry.id === file.language))
      throw new Error(`Choose a supported language for ${path}.`);
    const language = file.language ?? detectProjectLanguage(path, file.content);
    if (!language || !codeLanguages.some((entry) => entry.id === language))
      throw new Error(
        `Choose a supported language for ${path}. Ambiguous extensions need an explicit language.`,
      );
    return { path, content: file.content, language };
  });
  return {
    files,
    bytes,
    mode: input.mode ?? defaultCodeMode(files.length),
    name: input.name?.trim() || 'Code relationships',
    ...(input.focus?.trim() ? { focus: input.focus.trim() } : {}),
  };
}
