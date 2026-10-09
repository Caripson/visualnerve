import { useI18n, type MessageId } from '../i18n';
import type { ProjectArchiveProgress } from '../code/project/types';
import type { ProjectArchiveSummary } from '../code/project/analysis';

const labels = {
  dependency: [
    'data.projectStatus.excluded.dependency.one',
    'data.projectStatus.excluded.dependency.other',
  ],
  build: ['data.projectStatus.excluded.build.one', 'data.projectStatus.excluded.build.other'],
  vcs: ['data.projectStatus.excluded.vcs.one', 'data.projectStatus.excluded.vcs.other'],
  private: ['data.projectStatus.excluded.private.one', 'data.projectStatus.excluded.private.other'],
  binary: ['data.projectStatus.excluded.binary.one', 'data.projectStatus.excluded.binary.other'],
  generated: [
    'data.projectStatus.excluded.generated.one',
    'data.projectStatus.excluded.generated.other',
  ],
  unsupported: [
    'data.projectStatus.excluded.unsupported.one',
    'data.projectStatus.excluded.unsupported.other',
  ],
  directory: [
    'data.projectStatus.excluded.directory.one',
    'data.projectStatus.excluded.directory.other',
  ],
} as const satisfies Record<string, readonly [MessageId, MessageId]>;

export function ProjectImportStatus({
  project,
  progress,
}: {
  project: ProjectArchiveSummary | null;
  progress: ProjectArchiveProgress | null;
}) {
  const { t, plural, number } = useI18n();
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.floor((progress.completed / progress.total) * 100))
      : 0;
  const size = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${number(bytes / (1024 * 1024), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`
      : bytes >= 1024
        ? `${number(bytes / 1024, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KB`
        : plural('data.projectStatus.byteSize.one', 'data.projectStatus.byteSize.other', bytes);
  return (
    <>
      {progress && (
        <div className="code-archive-progress" role="status">
          <p>
            {t(
              progress.stage === 'scan'
                ? 'data.projectStatus.scanning'
                : 'data.projectStatus.reading',
              { percent },
            )}
          </p>
          <progress
            aria-label={t('data.projectStatus.progressAccessible')}
            value={percent}
            max={100}
          />
          {progress.path && <span>{progress.path}</span>}
        </div>
      )}
      {project && (
        <aside className="code-project-info" aria-label={t('data.projectStatus.summaryAccessible')}>
          <strong>{project.name}</strong>
          <p>
            {t('data.projectStatus.summary', {
              size: size(project.expandedBytes),
              count: project.ignored.total,
            })}
          </p>
          {project.fileLimit !== undefined && (
            <p>{t('data.projectStatus.capturedLimit', { count: number(project.fileLimit) })}</p>
          )}
          {project.ignored.total > 0 && (
            <ul>
              {Object.entries(project.ignored.reasons)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => {
                  const pair = Object.hasOwn(labels, reason)
                    ? labels[reason as keyof typeof labels]
                    : undefined;
                  return (
                    <li key={reason}>
                      {pair ? plural(pair[0], pair[1], count) : `${number(count)} ${reason}`}
                    </li>
                  );
                })}
            </ul>
          )}
          <p>{t('data.projectStatus.reviewLanguages')}</p>
        </aside>
      )}
    </>
  );
}
