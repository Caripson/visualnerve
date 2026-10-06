import { detectCodeLanguage, supportedCodeFile } from './catalog';
import { codeLimits, type CodeFile } from './types';

export function codeFilePath(file: File): string {
  return file.webkitRelativePath || file.name;
}
export function selectFolderFiles(files: File[]): { files: File[]; ignored: number } {
  const selected = files.filter((file) => {
    const path = codeFilePath(file);
    return (
      !/(^|\/)(node_modules|\.git|\.venv|venv|vendor|dist|build)(\/|$)/i.test(path) &&
      supportedCodeFile(path)
    );
  });
  return { files: selected, ignored: files.length - selected.length };
}
export async function readCodeFiles(
  files: File[],
  options: { signal?: AbortSignal } = {},
): Promise<CodeFile[]> {
  if (files.length > codeLimits.files) throw new Error('Choose at most 500 source files.');
  let total = 0;
  for (const file of files) {
    if (file.size > codeLimits.fileBytes)
      throw new Error(`${file.name} exceeds the 5 MiB source file limit.`);
    total += file.size;
  }
  if (total > codeLimits.bytes) throw new Error('Source files exceed the 20 MiB total limit.');
  const result: CodeFile[] = [];
  for (const file of files) {
    if (options.signal?.aborted)
      throw new DOMException('Source loading was cancelled.', 'AbortError');
    const path = codeFilePath(file);
    result.push({ path, content: await file.text(), language: detectCodeLanguage(path) });
  }
  return result;
}
