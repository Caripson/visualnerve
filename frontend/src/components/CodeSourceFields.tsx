import type { CodeFile, CodeLanguage } from '../code/types';
import { CodeFilesList } from './CodeFilesList';
import { CodeLanguageSelect } from './CodeLanguageSelect';

export function CodeSourceFields({
  files,
  language,
  text,
  disabled,
  loadNote,
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
  load: (files: File[], folder?: boolean) => Promise<void>;
  changeFileLanguage: (index: number, language: CodeLanguage) => void;
  clearFiles: () => void;
  changeLanguage: (language: CodeLanguage) => void;
  changeText: (text: string) => void;
}) {
  return (
    <>
      <div className="code-loaders">
        <label>
          Load source files
          <input
            aria-label="Load source files"
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
          Load source folder
          <input
            aria-label="Load source folder"
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
        Up to 500 files. The import size setting applies to each file and the complete project; its
        default is 50 MB. Folder selection skips dependencies and build output.
      </p>
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
            Source language
            <CodeLanguageSelect
              label="Source language"
              value={language}
              disabled={disabled}
              onChange={changeLanguage}
            />
          </label>
          <label className="field code-source">
            Source code
            <textarea
              aria-label="Source code"
              rows={8}
              value={text}
              disabled={disabled}
              spellCheck={false}
              placeholder="Paste source to explore how its parts connect…"
              onChange={(event) => changeText(event.target.value)}
            />
          </label>
        </>
      )}
    </>
  );
}
