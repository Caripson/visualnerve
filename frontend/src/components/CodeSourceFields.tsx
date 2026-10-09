import { useI18n } from '../i18n';
import type { CodeFile, CodeLanguage } from '../code/types';
import { CodeFilesList } from './CodeFilesList';
import { CodeLanguageSelect } from './CodeLanguageSelect';
import { useEditor } from '../state/editor';
import { LARGE_PROJECT_FILE_WARNING, projectSourceFileLimit } from '../code/project/limits';

export function CodeSourceFields({
  files,
  language,
  text,
  disabled,
  loadNote,
  projectFileLimit,
  load,
  changeFileLanguage,
  clearFiles,
  changeLanguage,
  changeText,
}: {
  files: CodeFile[];
  language: CodeLanguage;
  text: string;
  disabled: boolean;
  loadNote: string;
  projectFileLimit?: number;
  load: (files: File[], folder?: boolean) => Promise<void>;
  changeFileLanguage: (index: number, language: CodeLanguage) => void;
  clearFiles: () => void;
  changeLanguage: (language: CodeLanguage) => void;
  changeText: (text: string) => void;
}) {
  const { t } = useI18n();
  const activeProjectLimit = useEditor((state) => state.projectSourceFileLimit);
  const zipFileLimit = projectSourceFileLimit(projectFileLimit ?? activeProjectLimit);
  return (
    <>
      <div className="code-loaders">
        <label>
          {t('import.codeSources.zip')}
          <input
            aria-label={t('import.codeSources.zip')}
            type="file"
            accept=".zip,application/zip"
            disabled={disabled}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (picked.length) void load(picked);
            }}
          />
        </label>
        <label>
          {t('import.codeSources.files')}
          <input
            aria-label={t('import.codeSources.files')}
            type="file"
            multiple
            disabled={disabled}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (picked.length) void load(picked);
            }}
          />
        </label>
        <label>
          {t('import.codeSources.folder')}
          <input
            aria-label={t('import.codeSources.folder')}
            type="file"
            multiple
            {...{ webkitdirectory: '' }}
            disabled={disabled}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (picked.length) void load(picked, true);
            }}
          />
        </label>
      </div>
      <p className="code-note">
        {t('import.codeSources.projectLimits', { fileLimit: zipFileLimit.toLocaleString('en-US') })}
      </p>
      {zipFileLimit > 500 && (
        <p className="import-limit-warning" role="note" data-testid="project-import-file-warning">
          {LARGE_PROJECT_FILE_WARNING}
        </p>
      )}
      {loadNote && <p className="code-note">{loadNote}</p>}
      {files.length ? (
        <CodeFilesList
          files={files}
          disabled={disabled}
          change={changeFileLanguage}
          clear={clearFiles}
        />
      ) : (
        <>
          <label className="field">
            {t('import.codeSources.language')}
            <CodeLanguageSelect
              label={t('import.codeSources.language')}
              value={language}
              disabled={disabled}
              onChange={changeLanguage}
            />
          </label>
          <label className="field code-source">
            {t('import.codeSources.code')}
            <textarea
              aria-label={t('import.codeSources.code')}
              rows={8}
              value={text}
              disabled={disabled}
              spellCheck={false}
              placeholder={t('import.codeSources.pasteHint')}
              onChange={(event) => changeText(event.target.value)}
            />
          </label>
        </>
      )}
    </>
  );
}
