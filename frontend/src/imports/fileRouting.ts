import { codeLanguages, supportedCodeFile } from '../code/catalog';
export const importFileAccept = [
  ...new Set([
    '.zip',
    '.json',
    '.md',
    '.markdown',
    '.csv',
    '.tsv',
    '.sql',
    '.ddl',
    '.drawio',
    '.vsdx',
    ...codeLanguages.flatMap((language) => language.extensions),
  ]),
].join(',');

export type ImportKind = 'sql' | 'csv' | 'code' | 'diagram' | 'diagram-file';
export function importKind(name: string): ImportKind {
  if (/\.zip$/i.test(name)) return 'code';
  if (/\.(md|markdown)$/i.test(name)) return 'diagram';
  if (/\.(drawio|vsdx)$/i.test(name)) return 'diagram-file';
  if (/\.(sql|ddl)$/i.test(name)) return 'sql';
  if (/\.(csv|tsv)$/i.test(name)) return 'csv';
  if (supportedCodeFile(name)) return 'code';
  return 'diagram';
}
export function importSelection(files: File[]): ImportKind | 'mixed' {
  if (files.length === 1) return importKind(files[0].name);
  if (files.every((file) => importKind(file.name) === 'csv')) return 'csv';
  if (
    files.every(
      (file) =>
        !/\.zip$/i.test(file.name) &&
        (['sql', 'code'].includes(importKind(file.name)) || /\.(md|markdown)$/i.test(file.name)),
    )
  )
    return 'code';
  return 'mixed';
}
