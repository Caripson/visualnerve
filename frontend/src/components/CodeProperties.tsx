import {
  getCodeAnalysis,
  getCodeObject,
  getCodeRelation,
  getProjectDirectory,
} from '../code/schema';
import { codeLanguages } from '../code/catalog';
import type { Graph, GraphEdge, GraphNode } from '../model/types';
import './code-summary.css';

const languageName = (id: string) =>
  codeLanguages.find((language) => language.id === id)?.name ?? id;
export function CodeObjectProperties({ node }: { node: GraphNode }) {
  const object = getCodeObject(node);
  const directory = getProjectDirectory(node);
  if (directory)
    return (
      <section className="code-details" aria-label="Project folder details">
        <div className="property-section">Project folder</div>
        <dl>
          <dt>Folder</dt>
          <dd>{directory.path === '.' ? 'Project root' : directory.path}</dd>
          <dt>Source files</dt>
          <dd>{directory.fileCount}</dd>
          <dt>Languages</dt>
          <dd>{directory.languages.map(languageName).join(', ')}</dd>
        </dl>
        <p>
          Counts include nested folders. Connections combine file dependencies between their
          containing folders; they do not prove runtime behavior.
        </p>
      </section>
    );
  if (!object) return null;
  return (
    <section className="code-details" aria-label="Code object details">
      <div className="property-section">Source structure</div>
      <dl>
        <dt>Language</dt>
        <dd>{languageName(object.language)}</dd>
        <dt>Object</dt>
        <dd>{object.kind}</dd>
        <dt>Source file</dt>
        <dd>{object.path}</dd>
        {object.line && (
          <>
            <dt>Source lines</dt>
            <dd>
              {object.line}
              {object.endLine && object.endLine !== object.line ? `–${object.endLine}` : ''}
            </dd>
          </>
        )}
      </dl>
      {object.external && (
        <p>
          External or unresolved object. Its implementation was not resolved from the loaded source.
        </p>
      )}
      {!!object.summary?.length && (
        <details>
          <summary>Declarations ({object.summary.length})</summary>
          <ul>
            {object.summary.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </details>
      )}
      <p>Original source is not stored. Paths and line numbers refer to the imported version.</p>
    </section>
  );
}
export function CodeRelationProperties({ edge }: { edge: GraphEdge }) {
  const relation = getCodeRelation(edge);
  if (!relation) return null;
  return (
    <section className="code-details" aria-label="Code connection details">
      <div className="property-section">Code relationship</div>
      <dl>
        <dt>Relationship</dt>
        <dd>{relation.kind}</dd>
        <dt>Confidence</dt>
        <dd>
          {relation.confidence === 'syntax'
            ? 'Syntax'
            : relation.confidence === 'heuristic'
              ? 'Inferred'
              : 'Unresolved'}
        </dd>
        {relation.occurrences !== undefined && (
          <>
            <dt>Source relationships</dt>
            <dd>{relation.occurrences}</dd>
          </>
        )}
        {relation.evidence && (
          <>
            <dt>Evidence</dt>
            <dd>
              {relation.evidence.path}:{relation.evidence.line}
            </dd>
          </>
        )}
      </dl>
      <p>
        {relation.confidence === 'syntax'
          ? 'Identified from explicit source syntax. Runtime behavior and dynamic dispatch may differ.'
          : relation.confidence === 'heuristic'
            ? 'Inferred from names or source patterns. Check the source before treating this as a confirmed dependency.'
            : 'The target could not be resolved unambiguously from the loaded files.'}
      </p>
    </section>
  );
}
export function CodeAnalysisProperties({ graph }: { graph: Graph }) {
  const analysis = getCodeAnalysis(graph);
  if (!analysis) return null;
  return (
    <section className="code-details" aria-label="Code analysis details">
      <div className="property-section">Code analysis</div>
      <p>{analysis.languages.map(languageName).join(', ')}</p>
      <p>
        {analysis.fileCount} files · {analysis.symbolCount} symbols · {analysis.dependencyCount}{' '}
        dependencies · {analysis.unresolvedCount} unresolved
      </p>
      <p>
        {analysis.mode === 'folders'
          ? 'Folder relationships'
          : analysis.mode === 'files'
            ? 'File overview'
            : 'Declarations and dependencies'}
        {analysis.focus ? ` · focus: ${analysis.focus}` : ''}
      </p>
      {analysis.directoryCount !== undefined && <p>{analysis.directoryCount} folders</p>}
      {analysis.project && (
        <p>
          ZIP project: {analysis.project.name} ·{' '}
          {(analysis.project.expandedBytes / 1024 / 1024).toFixed(1)} MB expanded ·{' '}
          {analysis.project.ignoredEntries} excluded entries
        </p>
      )}
      {analysis.warnings.length > 0 && (
        <details>
          <summary>Analysis notes ({analysis.warnings.length})</summary>
          <ul>
            {analysis.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <p>
        Structural analysis of imported source. Connections show syntax, inferred or unresolved
        evidence; they do not represent a runtime trace.
      </p>
    </section>
  );
}
