export const EDITOR_BUNDLE_BUDGETS: Readonly<{
  entryBytes: number;
  mainThreadChunkBytes: number;
  initialStaticBytes: number;
}>;
export interface EditorBundleReport {
  entry: { file: string; bytes: number };
  initial: { files: string[]; bytes: number };
  mainThread: { files: string[]; maximumChunkBytes: number };
  catalogs: Record<string, { file: string; bytes: number }>;
}
export class BrowserBundleAudit {
  constructor(directory: string);
  run(): EditorBundleReport;
}
export function auditEditorBundle(directory: string): EditorBundleReport;
