import { useI18n } from '../i18n';
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
  const { t, plural } = useI18n();
  const [page, setPage] = useState(0);
  const offset = Math.min(page, Math.max(0, Math.ceil(files.length / pageSize) - 1)) * pageSize;
  return (
    <div className="code-file-list" aria-label={t('import.codeFiles.region')}>
      <p>
        {plural('import.codeFiles.summary.one', 'import.codeFiles.summary.other', files.length)}
      </p>
      {files.slice(offset, offset + pageSize).map((file, index) => (
        <label key={file.path} className="code-file-language">
          <span>{file.path}</span>
          <CodeLanguageSelect
            label={t('import.codeFiles.fileLanguage', { path: file.path })}
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
              {t('import.codeFiles.previous')}
            </button>
            <span>
              {t('import.codeFiles.pageRange', {
                first: offset + 1,
                last: Math.min(files.length, offset + pageSize),
                total: files.length,
              })}
            </span>
            <button
              type="button"
              disabled={disabled || offset + pageSize >= files.length}
              onClick={() => setPage(page + 1)}
            >
              {t('import.codeFiles.next')}
            </button>
          </>
        )}
        <button type="button" disabled={disabled} onClick={clear}>
          {t('import.codeFiles.pastedInstead')}
        </button>
      </div>
    </div>
  );
}
