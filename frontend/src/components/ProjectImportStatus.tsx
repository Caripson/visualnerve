import type { ProjectArchiveProgress } from '../code/project/types';
import type { ProjectArchiveSummary } from '../code/project/analysis';

const labels: Record<string, [string, string]> = {
  dependency: ['dependency', 'dependencies'],
  build: ['build output entry', 'build output entries'],
  vcs: ['version-control entry', 'version-control entries'],
  private: ['private file', 'private files'],
  binary: ['binary file', 'binary files'],
  generated: ['generated file', 'generated files'],
  unsupported: ['unsupported file', 'unsupported files'],
  directory: ['directory entry', 'directory entries'],
};
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(2)} KB`
      : `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;

export function ProjectImportStatus({
  project,
  progress,
}: {
  project: ProjectArchiveSummary | null;
  progress: ProjectArchiveProgress | null;
}) {
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.floor((progress.completed / progress.total) * 100))
      : 0;
  return (
    <>
      {progress && (
        <div className="code-archive-progress" role="status">
          <p>
            {progress.stage === 'scan' ? 'Scanning ZIP project' : 'Reading project files'} ·{' '}
            {percent}%
          </p>
          <progress aria-label="Project scan progress" value={percent} max={100} />
          {progress.path && <span>{progress.path}</span>}
        </div>
      )}
      {project && (
        <aside className="code-project-info" aria-label="Project scan summary">
          <strong>{project.name}</strong>
          <p>
            {size(project.expandedBytes)} expanded · {project.ignored.total} archive entries
            excluded
          </p>
          {project.ignored.total > 0 && (
            <ul>
              {Object.entries(project.ignored.reasons)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => (
                  <li key={reason}>
                    {count} {labels[reason]?.[count === 1 ? 0 : 1] ?? reason}
                  </li>
                ))}
            </ul>
          )}
          <p>
            Review detected languages. Uncertain files need an explicit language before preview.
          </p>
        </aside>
      )}
    </>
  );
}
