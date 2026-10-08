import { useEditor } from '../../state/editor';
import { projectSourceFileLimit } from './limits';

export function currentProjectSourceFileLimit(): number {
  return projectSourceFileLimit(useEditor.getState().projectSourceFileLimit);
}
