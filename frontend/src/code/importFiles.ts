import { detectProjectLanguage, supportedCodeFile } from './catalog';
import { codeLimits, type CodeFile } from './types';
import { assertImportBytes, checkedImportLimitBytes, utf8Bytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';
import { projectPathReason } from './project/policy';

export function codeFilePath(file: File): string {
  return file.webkitRelativePath || file.name;
}
export function selectFolderFiles(files: File[]): { files: File[]; ignored: number } {
  const selected = files.filter((file) => {
    const path = codeFilePath(file);
    return !projectPathReason(path) && supportedCodeFile(path);
  });
  return { files: selected, ignored: files.length - selected.length };
}
export async function readCodeFiles(
  files: File[],
  options: { signal?: AbortSignal; byteLimit?: number } = {},
): Promise<CodeFile[]> {
  const limit = checkedImportLimitBytes(options.byteLimit ?? currentImportLimitBytes());
  if (options.signal?.aborted)
    throw new DOMException('Source loading was cancelled.', 'AbortError');
  if (files.length > codeLimits.files) throw new Error('Choose at most 500 source files.');
  let total = 0;
  for (const file of files) {
    assertImportBytes(file.size, limit, file.name);
    total += file.size;
  }
  assertImportBytes(total, limit, 'Source project');
  const result: CodeFile[] = [];
  let actualBytes = 0;
  for (const file of files) {
    if (options.signal?.aborted)
      throw new DOMException('Source loading was cancelled.', 'AbortError');
    const path = codeFilePath(file);
    const content = await file.text();
    const bytes = utf8Bytes(content);
    assertImportBytes(bytes, limit, path);
    actualBytes += bytes;
    assertImportBytes(actualBytes, limit, 'Source project');
    result.push({ path, content, language: detectProjectLanguage(path, content) });
  }
  return result;
}
