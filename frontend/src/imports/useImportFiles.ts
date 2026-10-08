import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { importKind, importSelection } from './fileRouting';
import { assertImportBytes } from './limits';
import { currentImportLimitBytes } from './preference';
import { openCsvFile } from '../data/client';
import { parseImport } from '../export/semantic';
import { workspace } from '../storage/workspace';
import { useEditor } from '../state/editor';
import type { WorkspaceBackup } from '../storage/database';
import type { CsvDataset } from '../data/types';
import type { WorkspaceOperation } from '../storage/contracts';

interface ImportFilesOptions {
  busy: MutableRefObject<boolean>;
  setImporting: (value: boolean) => void;
  sql: (draft: { id: string; text: string; name: string }) => void;
  code: (files: File[]) => void;
  diagramFile: (file: File) => void;
  csv: (dataset: CsvDataset, file: File) => void;
  csvFiles: (files: File[]) => void;
  backup: (backup: WorkspaceBackup) => void;
  readBackup?: (file: File) => Promise<WorkspaceBackup>;
  failed: () => void;
}
/** File routing and browser drop lifecycle stay separate from the workspace UI. */
export function useImportFiles(options: ImportFilesOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [draggingFile, setDraggingFile] = useState(false);
  const depth = useRef(0);
  const lifecycle = useRef(0);
  const operations = useRef(new Set<WorkspaceOperation>());
  useEffect(
    () => () => {
      lifecycle.current++;
      for (const operation of operations.current) operation.dispose();
      operations.current.clear();
    },
    [],
  );
  const importFile = useCallback(async (picked: File) => {
    const handlers = latest.current;
    if (!useEditor.getState().privacyAcknowledged || handlers.busy.current) return;
    handlers.busy.current = true;
    handlers.setImporting(true);
    const origin = lifecycle.current;
    let operation: WorkspaceOperation | undefined;
    try {
      operation = await workspace.repo.db.captureOperation();
      operations.current.add(operation);
      const check = async () => {
        if (origin !== lifecycle.current) throw new DOMException('Import cancelled.', 'AbortError');
        await operation!.check();
      };
      await check();
      const byteLimit = currentImportLimitBytes();
      assertImportBytes(picked.size, byteLimit, 'Import file');
      switch (importKind(picked.name)) {
        case 'diagram-file':
          handlers.diagramFile(picked);
          break;
        case 'sql': {
          const text = await picked.text();
          await check();
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
        case 'csv': {
          const dataset = await openCsvFile(picked, byteLimit);
          await check();
          handlers.csv(dataset, picked);
          break;
        }
        default: {
          const format = /\.json$/i.test(picked.name) ? 'json' : 'markdown';
          const text = await picked.text();
          await check();
          const json = format === 'json' ? JSON.parse(text) : undefined;
          if (json?.format === 'visualnerve-backup') {
            if (!handlers.readBackup)
              throw new Error('Use Restore backup to unlock this encrypted backup.');
            const backup = await handlers.readBackup(picked);
            await check();
            handlers.backup(backup);
          } else if (json?.format === 'visual-nerve-workspace')
            handlers.backup(json as WorkspaceBackup);
          else await workspace.create(parseImport(format, text, byteLimit), operation);
        }
      }
    } catch (error) {
      if (origin !== lifecycle.current || operation?.signal.aborted) return;
      handlers.failed();
      useEditor.setState({
        status: 'error',
        message: `Import failed: ${(error as Error).message}`,
      });
    } finally {
      operation?.dispose();
      if (operation) operations.current.delete(operation);
      handlers.busy.current = false;
      if (origin === lifecycle.current) handlers.setImporting(false);
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
