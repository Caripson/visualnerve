import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { utf8Bytes } from '../imports/limits';
import { ImportSizeNotice } from './ImportSizeNotice';
import { Modal } from './Modal';
import { CodeSourceFields } from './CodeSourceFields';
import { CodeImportPreview } from './CodeImportPreview';
import { parseCodeAsync } from '../code/client';
import { codeLanguages } from '../code/catalog';
import { readProjectArchive } from '../code/project/client';
import type { ProjectArchiveProgress } from '../code/project/types';
import { currentProjectSourceFileLimit } from '../code/project/preference';
import { currentImportLimitBytes } from '../imports/preference';
import { attachProjectAnalysis, type ProjectArchiveSummary } from '../code/project/analysis';
import { ProjectImportStatus } from './ProjectImportStatus';
import { defaultCodeMode } from '../code/input';
import { readCodeFiles, selectFolderFiles } from '../code/importFiles';
import type { CodeFile, CodeImportResult, CodeLanguage } from '../code/types';
import type { Graph } from '../model/types';
import './code-import.css';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to analyze this source.';
export function CodeImportDialog({
  initialFiles,
  close,
  create,
}: {
  initialFiles?: File[];
  close: () => void;
  create: (graph: Graph) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('Code diagram');
  const [language, setLanguage] = useState<CodeLanguage>('typescript');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<CodeFile[]>([]);
  const sourceBytes = useMemo(
    () =>
      files.length
        ? files.reduce((sum, file) => sum + utf8Bytes(file.content), 0)
        : utf8Bytes(text),
    [files, text],
  );
  const [chosenMode, setChosenMode] = useState<'files' | 'symbols' | 'folders'>();
  const mode = chosenMode ?? defaultCodeMode(files.length || 1);
  const detailHelpId = useId();
  const [focus, setFocus] = useState('');
  const [preview, setPreview] = useState<CodeImportResult | null>(null);
  const [working, setWorking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loadNote, setLoadNote] = useState('');
  const [project, setProject] = useState<ProjectArchiveSummary | null>(null);
  const [progress, setProgress] = useState<ProjectArchiveProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const invalidate = useCallback(() => {
    cancel();
    setWorking(false);
    setProgress(null);
    setPreview(null);
    setError('');
  }, [cancel]);
  const dismiss = useCallback(() => {
    cancel();
    close();
  }, [cancel, close]);
  const load = useCallback(
    async (selected: File[], folder = false) => {
      invalidate();
      const current = generation.current;
      const pending = new AbortController();
      controller.current = pending;
      setWorking(true);
      setLoadNote('');
      setFiles([]);
      setProject(null);
      setProgress(null);
      try {
        if (selected.some((file) => /\.zip$/i.test(file.name))) {
          if (folder || selected.length !== 1) throw new Error('Choose one ZIP project at a time.');
          const archive = await readProjectArchive(selected[0], {
            signal: pending.signal,
            fileLimit: currentProjectSourceFileLimit(),
            byteLimit: currentImportLimitBytes(),
            onProgress: (value) => {
              if (mounted.current && current === generation.current) setProgress(value);
            },
          });
          if (!mounted.current || current !== generation.current) return;
          setFiles(archive.files);
          setName(archive.name);
          setChosenMode((value) => value ?? 'files');
          setProject({
            name: archive.name,
            ignored: archive.ignored,
            expandedBytes: archive.expandedBytes,
            fileLimit: archive.fileLimit,
          });
          return;
        }
        const accepted = folder ? selectFolderFiles(selected) : { files: selected, ignored: 0 };
        if (!accepted.files.length)
          throw new Error(
            'No supported source files found. Load a file and choose its language, or paste source.',
          );
        const loaded = await readCodeFiles(accepted.files, { signal: pending.signal });
        if (!mounted.current || current !== generation.current) return;
        setFiles(loaded);
        setName(
          loaded.length === 1 ? loaded[0].path.split('/').at(-1)!.slice(0, 500) : 'Code project',
        );
        if (accepted.ignored)
          setLoadNote(`${accepted.ignored} non-source or dependency/build files ignored.`);
      } catch (error) {
        if (mounted.current && current === generation.current) setError(message(error));
      } finally {
        if (mounted.current && current === generation.current) {
          controller.current = null;
          setWorking(false);
          setProgress(null);
        }
      }
    },
    [invalidate],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  useEffect(() => {
    if (initialFiles?.length) void load(initialFiles);
  }, [initialFiles, load]);

  const analyze = async () => {
    if (working || creating) return;
    invalidate();
    const current = generation.current;
    const pending = new AbortController();
    controller.current = pending;
    setWorking(true);
    try {
      const extension = codeLanguages.find((item) => item.id === language)?.extensions[0] ?? '.txt';
      const inputFiles = files.length
        ? files
        : [
            {
              path: `source${extension.startsWith('.') ? extension : `.${extension}`}`,
              content: text,
              language,
            },
          ];
      const result = await parseCodeAsync(
        {
          name: name.trim(),
          files: inputFiles,
          mode,
          ...(focus.trim() ? { focus: focus.trim() } : {}),
        },
        { signal: pending.signal, ...(project ? { fileLimit: project.fileLimit } : {}) },
      );
      if (!mounted.current || current !== generation.current || pending.signal.aborted) return;
      if (!result.graph.nodes.length)
        throw new Error('No objects match this view. Broaden the focus and preview again.');
      setPreview(project ? attachProjectAnalysis(result, project) : result);
    } catch (error) {
      if (mounted.current && current === generation.current && !pending.signal.aborted)
        setError(message(error));
    } finally {
      if (mounted.current && current === generation.current) {
        controller.current = null;
        setWorking(false);
      }
    }
  };
  const save = async () => {
    if (!preview || working || creating) return;
    setCreating(true);
    setError('');
    try {
      await create(preview.graph);
      if (mounted.current) dismiss();
    } catch (error) {
      if (mounted.current) {
        setError(message(error));
        setCreating(false);
      }
    }
  };
  const canPreview =
    name.trim() && (files.length ? files.every((file) => !!file.language) : text.trim());
  return (
    <Modal title={t('import.code.title')} close={dismiss} wide dismissible={!creating}>
      <form
        className="code-import"
        aria-busy={working || creating}
        onSubmit={(event) => {
          event.preventDefault();
          void analyze();
        }}
      >
        <p>{t('import.code.localStructuralOnly')}</p>
        <ImportSizeNotice bytes={sourceBytes} />
        <label className="field">
          {t('data.csv.nameLabel')}
          <input
            aria-label={t('import.code.nameAccessible')}
            value={name}
            maxLength={500}
            disabled={creating}
            onChange={(event) => {
              invalidate();
              setName(event.target.value);
            }}
          />
        </label>
        <CodeSourceFields
          files={files}
          language={language}
          text={text}
          disabled={creating}
          loadNote={loadNote}
          projectFileLimit={project?.fileLimit}
          load={load}
          changeFileLanguage={(index, language) => {
            invalidate();
            setFiles(files.map((file, row) => (row === index ? { ...file, language } : file)));
          }}
          clearFiles={() => {
            invalidate();
            setFiles([]);
            setLoadNote('');
            setProject(null);
            setProgress(null);
          }}
          changeLanguage={(value) => {
            invalidate();
            setLanguage(value);
          }}
          changeText={(value) => {
            invalidate();
            setText(value);
          }}
        />
        <div className="code-view-settings">
          <label className="field">
            {t('import.code.detailLabel')}
            <select
              aria-label={t('import.code.detailAccessible')}
              aria-describedby={detailHelpId}
              value={mode}
              disabled={creating}
              onChange={(event) => {
                invalidate();
                setChosenMode(event.target.value as typeof mode);
              }}
            >
              <option value="files">{t('import.code.modeFiles')}</option>
              <option value="folders">{t('import.code.modeFolders')}</option>
              <option value="symbols">{t('import.code.modeSymbols')}</option>
            </select>
          </label>
          <label className="field">
            {t('import.code.focusLabel')}
            <input
              aria-label={t('import.code.focusAccessible')}
              value={focus}
              maxLength={500}
              disabled={creating}
              placeholder={t('import.code.focusHint')}
              onChange={(event) => {
                invalidate();
                setFocus(event.target.value);
              }}
            />
          </label>
        </div>
        <p className="code-note" id={detailHelpId}>
          {mode === 'folders'
            ? t('import.code.folderModeExplanation')
            : mode === 'symbols'
              ? t('import.code.symbolModeExplanation')
              : t('import.code.fileModeExplanation')}
        </p>
        <p className="code-note">{t('import.code.inferenceBoundary')}</p>
        <p className="code-note">{t('import.code.sourceRetention')}</p>
        <ProjectImportStatus project={project} progress={progress} />
        {working && (
          <div className="code-import-progress">
            {!progress && <p role="status">{t('import.code.preparing')}</p>}
            <button
              type="button"
              onClick={() => {
                invalidate();
                setProgress(null);
              }}
            >
              {t('import.code.cancelPreparation')}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="code-error">
            {localizedFeedback(error, t)}
          </p>
        )}
        {preview && <CodeImportPreview preview={preview} />}
        <div className="modal-actions code-actions">
          <button type="button" disabled={creating} onClick={dismiss}>
            {t('data.action.cancel')}
          </button>
          <button type="submit" disabled={!canPreview || working || creating}>
            {t('import.code.preview')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!preview || working || creating}
            onClick={() => void save()}
          >
            {creating ? t('import.action.creatingDiagram') : t('import.action.createDiagram')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
