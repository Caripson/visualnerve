import { useI18n } from '../i18n';
import { getCodeObject, getCodeRelation, getProjectDirectory } from '../code/schema';
import type { CodeImportResult } from '../code/types';

export function CodeImportPreview({ preview }: { preview: CodeImportResult }) {
  const { t } = useI18n();
  const counts = new Map<string, number>();
  for (const edge of preview.graph.edges) {
    const relation = getCodeRelation(edge);
    if (relation) counts.set(relation.confidence, (counts.get(relation.confidence) ?? 0) + 1);
  }
  return (
    <section className="code-preview" aria-label={t('import.codePreview.title')}>
      <h3>{t('import.codePreview.title')}</h3>
      <dl className="code-counts">
        {[
          [t('import.codePreview.files'), preview.fileCount],
          [t('import.codePreview.folders'), preview.directoryCount ?? 0],
          [t('import.codePreview.symbols'), preview.symbolCount],
          [t('import.codePreview.dependencies'), preview.dependencyCount],
          [t('import.codePreview.visibleObjects'), preview.graph.nodes.length],
          [t('import.codePreview.connections'), preview.graph.edges.length],
          [t('import.codePreview.unresolved'), preview.unresolvedCount],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{(value as number).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p>
        {t('import.codePreview.confidenceCounts', {
          syntax: counts.get('syntax') ?? 0,
          inferred: counts.get('heuristic') ?? 0,
          unresolved: counts.get('unresolved') ?? 0,
        })}
      </p>
      <ul className="code-preview-objects" aria-label={t('import.codePreview.objectsAccessible')}>
        {preview.graph.nodes.slice(0, 30).map((node) => {
          const object = getCodeObject(node);
          const directory = getProjectDirectory(node);
          return (
            <li key={node.id}>
              <strong>{node.title}</strong>
              {directory && (
                <span>
                  {t('import.codePreview.folderLine', {
                    path: directory.path,
                    count: directory.fileCount,
                  })}
                </span>
              )}
              {object && (
                <span>
                  {object.kind} · {object.path}
                  {object.line ? `:${object.line}` : ''}
                  {object.external ? t('import.codePreview.externalSuffix') : ''}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {preview.graph.nodes.length > 30 && <p>{t('import.codePreview.first30')}</p>}
      {preview.warnings.length > 0 && (
        <details className="code-notes" open>
          <summary>{t('import.codePreview.notes', { count: preview.warnings.length })}</summary>
          <ul>
            {preview.warnings.slice(0, 20).map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          {preview.warnings.length > 20 && <p>{t('import.codePreview.savedNotes')}</p>}
        </details>
      )}
    </section>
  );
}
