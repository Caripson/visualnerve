import { useState } from 'react';
import type { CodeFile, CodeLanguage } from '../code/types';
import { CodeLanguageSelect } from './CodeLanguageSelect';

const pageSize = 25;
export function CodeFilesList({
  files,
  disabled,
  change,
  clear,
}: {
  files: CodeFile[];
  disabled: boolean;
  change: (index: number, language: CodeLanguage) => void;
  clear: () => void;
}) {
  const [page, setPage] = useState(0);
  const offset = Math.min(page, Math.max(0, Math.ceil(files.length / pageSize) - 1)) * pageSize;
  return (
    <div className="code-file-list" aria-label="Loaded source files">
      <p>
        {files.length} source {files.length === 1 ? 'file' : 'files'}. Review detected languages and
        choose one for any unidentified file.
      </p>
      {files.slice(offset, offset + pageSize).map((file, index) => (
        <label key={file.path} className="code-file-language">
          <span>{file.path}</span>
          <CodeLanguageSelect
            label={`Language for ${file.path}`}
            value={file.language ?? ''}
            disabled={disabled}
            onChange={(language) => change(offset + index, language)}
          />
        </label>
      ))}
      <div className="code-files-actions">
        {files.length > pageSize && (
          <>
            <button
              type="button"
              disabled={disabled || offset === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous files
            </button>
            <span>
              {offset + 1}–{Math.min(files.length, offset + pageSize)} of {files.length}
            </span>
            <button
              type="button"
              disabled={disabled || offset + pageSize >= files.length}
              onClick={() => setPage(page + 1)}
            >
              Next files
            </button>
          </>
        )}
        <button type="button" disabled={disabled} onClick={clear}>
          Use pasted source instead
        </button>
      </div>
    </div>
  );
}
