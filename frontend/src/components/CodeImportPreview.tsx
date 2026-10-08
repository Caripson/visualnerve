import { getCodeObject, getCodeRelation, getProjectDirectory } from '../code/schema';
import type { CodeImportResult } from '../code/types';

export function CodeImportPreview({ preview }: { preview: CodeImportResult }) {
  const counts = new Map<string, number>();
  for (const edge of preview.graph.edges) {
    const relation = getCodeRelation(edge);
    if (relation) counts.set(relation.confidence, (counts.get(relation.confidence) ?? 0) + 1);
  }
  return (
    <section className="code-preview" aria-label="Code preview">
      <h3>Code preview</h3>
      <dl className="code-counts">
        {[
          ['Files', preview.fileCount],
          ['Folders', preview.directoryCount ?? 0],
          ['Symbols', preview.symbolCount],
          ['Dependencies', preview.dependencyCount],
          ['Visible objects', preview.graph.nodes.length],
          ['Connections', preview.graph.edges.length],
          ['Unresolved', preview.unresolvedCount],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{(value as number).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p>
        Structural analysis: {counts.get('syntax') ?? 0} syntax connections,{' '}
        {counts.get('heuristic') ?? 0} inferred connections, {counts.get('unresolved') ?? 0}{' '}
        unresolved connections. Dynamic behavior may differ when the program runs.
      </p>
      <ul className="code-preview-objects" aria-label="Preview code objects">
        {preview.graph.nodes.slice(0, 30).map((node) => {
          const object = getCodeObject(node);
          const directory = getProjectDirectory(node);
          return (
            <li key={node.id}>
              <strong>{node.title}</strong>
              {directory && (
                <span>
                  Folder · {directory.path} · {directory.fileCount} files
                </span>
              )}
              {object && (
                <span>
                  {object.kind} · {object.path}
                  {object.line ? `:${object.line}` : ''}
                  {object.external ? ' · external / unresolved' : ''}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {preview.graph.nodes.length > 30 && <p>Showing the first 30 objects in the preview.</p>}
      {preview.warnings.length > 0 && (
        <details className="code-notes" open>
          <summary>Analysis notes ({preview.warnings.length})</summary>
          <ul>
            {preview.warnings.slice(0, 20).map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          {preview.warnings.length > 20 && <p>Additional notes are saved with the diagram.</p>}
        </details>
      )}
    </section>
  );
}
