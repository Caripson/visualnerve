import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { importKind, importSelection } from './fileRouting';
import { SQL_FILE_LIMIT } from '../sql/client';
import { openCsvFile } from '../data/client';
import { parseImport } from '../export/semantic';
import { workspace } from '../storage/workspace';
import { useEditor } from '../state/editor';
import type { WorkspaceBackup } from '../storage/database';
import type { CsvDataset } from '../data/types';

interface ImportFilesOptions {
  busy: MutableRefObject<boolean>;
  setImporting: (value: boolean) => void;
  sql: (draft: { id: string; text: string; name: string }) => void;
  code: (files: File[]) => void;
  csv: (dataset: CsvDataset, file: File) => void;
  csvFiles: (files: File[]) => void;
  backup: (backup: WorkspaceBackup) => void;
  failed: () => void;
}
/** File routing and browser drop lifecycle stay separate from the workspace UI. */
export function useImportFiles(options: ImportFilesOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [draggingFile, setDraggingFile] = useState(false);
  const depth = useRef(0);
  const importFile = useCallback(async (picked: File) => {
    const handlers = latest.current;
    if (!useEditor.getState().privacyAcknowledged || handlers.busy.current) return;
    handlers.busy.current = true;
    handlers.setImporting(true);
    try {
      switch (importKind(picked.name)) {
        case 'sql': {
          if (picked.size > SQL_FILE_LIMIT) throw new Error('SQL exceeds the 50 MiB file limit.');
          const text = await picked.text();
          handlers.sql({
            id: crypto.randomUUID(),
            text,
            name: picked.name.replace(/\.(sql|ddl)$/i, '').slice(0, 500) || 'Imported SQL',
          });
          break;
        }
        case 'code':
          handlers.code([picked]);
          break;
        case 'csv':
          handlers.csv(await openCsvFile(picked), picked);
          break;
        default: {
          const format = /\.json$/i.test(picked.name) ? 'json' : 'markdown';
          const text = await picked.text();
          const json = format === 'json' ? JSON.parse(text) : undefined;
          if (json?.format === 'visual-nerve-workspace') handlers.backup(json as WorkspaceBackup);
          else await workspace.create(parseImport(format, text));
        }
      }
    } catch (error) {
      handlers.failed();
      useEditor.setState({
        status: 'error',
        message: `Import failed: ${(error as Error).message}`,
      });
    } finally {
      handlers.busy.current = false;
      handlers.setImporting(false);
    }
  }, []);
  useEffect(() => {
    const isFile = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      if (!useEditor.getState().privacyAcknowledged) return;
      depth.current++;
      setDraggingFile(true);
    };
    const over = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!isFile(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDraggingFile(false);
    };
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented || !isFile(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDraggingFile(false);
      if (!useEditor.getState().privacyAcknowledged || latest.current.busy.current) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      if (files.length === 1) {
        void importFile(files[0]);
        return;
      }
      switch (importSelection(files)) {
        case 'csv':
          latest.current.csvFiles(files);
          break;
        case 'code':
          latest.current.code(files);
          break;
        default:
          useEditor.setState({
            status: 'error',
            message:
              'Drop source files together, CSV files together, or one diagram file at a time.',
          });
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFile]);
  return { importFile, draggingFile };
}
