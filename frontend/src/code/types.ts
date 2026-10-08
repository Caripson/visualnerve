import type { Graph } from '../model/types';
import { DEFAULT_IMPORT_LIMIT_BYTES } from '../imports/limits';
import type { ProjectIgnoredReason } from './project/types';
export { projectIgnoredReasons } from './project/types';

export const codeLanguageIds = [
  'python',
  'javascript',
  'typescript',
  'java',
  'csharp',
  'cpp',
  'c',
  'sql',
  'go',
  'rust',
  'php',
  'kotlin',
  'swift',
  'shell',
  'r',
  'dart',
  'ruby',
  'powershell',
  'dax',
  'powerquery',
  'vba',
  'scala',
  'lua',
  'matlab',
  'objective-c',
  'perl',
  'groovy',
  'vbnet',
  'julia',
  'elixir',
  'solidity',
  'haskell',
  'fsharp',
  'clojure',
  'tsql',
  'plsql',
  'sas',
  'apex',
  'abap',
  'cobol',
  'fortran',
  'assembly',
  'pascal',
  'gdscript',
  'graphql',
  'mdx',
  'cypher',
  'vega',
  'hcl',
  'nix',
  'markdown',
] as const;
export type CodeLanguage = (typeof codeLanguageIds)[number];
export interface LanguageDefinition {
  id: CodeLanguage;
  name: string;
  extensions: string[];
  family: string;
  capabilities: string[];
}
export interface CodeFile {
  path: string;
  content: string;
  language?: CodeLanguage;
}
export interface CodeInput {
  name?: string;
  files: CodeFile[];
  /** Omitted: declarations for one file, file overview for multiple files. */
  mode?: 'files' | 'symbols' | 'folders';
  /** Case-insensitive path/name substring. Include immediate related objects. */
  focus?: string;
}
export const codeLimits = {
  bytes: DEFAULT_IMPORT_LIMIT_BYTES,
  fileBytes: DEFAULT_IMPORT_LIMIT_BYTES,
  files: 500,
  symbols: 10_000,
  nodes: 5_000,
  edges: 10_000,
  warnings: 100,
  lineLength: 20_000,
  lines: 100_000,
  totalLines: 500_000,
} as const;
export type CodeObjectKind =
  | 'file'
  | 'class'
  | 'function'
  | 'type'
  | 'resource'
  | 'query'
  | 'measure'
  | 'variable'
  | 'external';
export type CodeRelationKind =
  | 'contains'
  | 'imports'
  | 'calls'
  | 'inherits'
  | 'references'
  | 'reads'
  | 'writes'
  | 'depends-on';
export type CodeConfidence = 'syntax' | 'heuristic' | 'unresolved';
export interface CodeObject {
  version: 1;
  language: CodeLanguage;
  path: string;
  kind: CodeObjectKind;
  name: string;
  line?: number;
  endLine?: number;
  external?: boolean;
  /** Bounded names only; original source and string literal values are not retained. */
  summary?: string[];
}
export interface CodeRelation {
  version: 1;
  kind: CodeRelationKind;
  confidence: CodeConfidence;
  evidence?: { path: string; line: number };
  /** Number of source relationships represented by a folder overview connection. */
  occurrences?: number;
}
export interface ProjectDirectory {
  version: 1;
  /** '.' identifies the root; other paths are normalized relative directories. */
  path: string;
  fileCount: number;
  languages: CodeLanguage[];
}
export interface CodeProjectAnalysis {
  version: 1;
  name: string;
  expandedBytes: number;
  ignoredEntries: number;
  ignoredReasons: Partial<Record<ProjectIgnoredReason, number>>;
  /** Captured ZIP source-file limit; absent in earlier imported projects. */
  sourceFileLimit?: number;
}
export interface CodeAnalysis {
  version: 1;
  languages: CodeLanguage[];
  mode: 'files' | 'symbols' | 'folders';
  fileCount: number;
  directoryCount?: number;
  symbolCount: number;
  dependencyCount: number;
  unresolvedCount: number;
  warnings: string[];
  focus?: string;
  project?: CodeProjectAnalysis;
}
export interface CodeImportResult extends CodeAnalysis {
  graph: Graph;
}
/** Intermediate records use local keys, never editor UUIDs. */
export interface CodeSymbol {
  key: string;
  name: string;
  kind: Exclude<CodeObjectKind, 'file' | 'external'>;
  line: number;
  endLine?: number;
  parent?: string;
}
export interface CodeDependency {
  source?: string;
  target: string;
  kind: Exclude<CodeRelationKind, 'contains'>;
  line: number;
  /** Import path versus named symbol/resource. */
  targetType: 'module' | 'symbol';
  confidence: CodeConfidence;
  /** Wiki syntax permits an unambiguous Markdown basename lookup in the project. */
  markdownWiki?: boolean;
}
export interface ExtractedCode {
  symbols: CodeSymbol[];
  dependencies: CodeDependency[];
  warnings: string[];
  /** Local Markdown anchor identifiers used only during resolution. */
  anchors?: string[];
}
