import { useEditor } from '../state/editor';
import { importLimitMb } from './limits';

export function currentImportLimitBytes(): number {
  return importLimitMb(useEditor.getState().importFileLimitMb) * 1024 * 1024;
}
