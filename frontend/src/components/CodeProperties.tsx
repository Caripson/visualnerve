import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const object = getCodeObject(node);
  const directory = getProjectDirectory(node);
  if (directory)
    return (
      <section className="code-details" aria-label={t('data.code.folderRegion')}>
        <div className="property-section">{t('data.code.folderTitle')}</div>
        <dl>
          <dt>{t('data.code.folderLabel')}</dt>
          <dd>{directory.path === '.' ? t('data.code.projectRoot') : directory.path}</dd>
          <dt>{t('data.code.sourceFilesLabel')}</dt>
          <dd>{directory.fileCount}</dd>
          <dt>{t('data.code.languagesLabel')}</dt>
          <dd>{directory.languages.map(languageName).join(', ')}</dd>
        </dl>
        <p>{t('data.code.folderAggregationBoundary')}</p>
      </section>
    );
  if (!object) return null;
  return (
    <section className="code-details" aria-label={t('data.code.objectRegion')}>
      <div className="property-section">{t('data.code.sourceStructureTitle')}</div>
      <dl>
        <dt>{t('data.code.languageLabel')}</dt>
        <dd>{languageName(object.language)}</dd>
        <dt>{t('data.code.objectLabel')}</dt>
        <dd>{object.kind}</dd>
        <dt>{t('data.code.sourceFileLabel')}</dt>
        <dd>{object.path}</dd>
        {object.line && (
          <>
            <dt>{t('data.code.sourceLinesLabel')}</dt>
            <dd>
              {object.line}
              {object.endLine && object.endLine !== object.line ? `–${object.endLine}` : ''}
            </dd>
          </>
        )}
      </dl>
      {object.external && <p>{t('data.code.externalObjectNotice')}</p>}
      {!!object.summary?.length && (
        <details>
          <summary>
            {t('data.code.declarationsWithCount', { count: object.summary.length })}
          </summary>
          <ul>
            {object.summary.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </details>
      )}
      <p>{t('data.code.originalSourceNotStored')}</p>
    </section>
  );
}
export function CodeRelationProperties({ edge }: { edge: GraphEdge }) {
  const { t } = useI18n();
  const relation = getCodeRelation(edge);
  if (!relation) return null;
  return (
    <section className="code-details" aria-label={t('data.code.relationRegion')}>
      <div className="property-section">{t('data.code.relationTitle')}</div>
      <dl>
        <dt>{t('data.code.relationLabel')}</dt>
        <dd>{relation.kind}</dd>
        <dt>{t('data.code.confidenceLabel')}</dt>
        <dd>
          {relation.confidence === 'syntax'
            ? t('data.code.confidenceSyntax')
            : relation.confidence === 'heuristic'
              ? t('data.code.confidenceInferred')
              : t('data.code.confidenceUnresolved')}
        </dd>
        {relation.occurrences !== undefined && (
          <>
            <dt>{t('data.code.sourceRelationsLabel')}</dt>
            <dd>{relation.occurrences}</dd>
          </>
        )}
        {relation.evidence && (
          <>
            <dt>{t('data.code.evidenceLabel')}</dt>
            <dd>
              {relation.evidence.path}:{relation.evidence.line}
            </dd>
          </>
        )}
      </dl>
      <p>
        {relation.confidence === 'syntax'
          ? t('data.code.syntaxExplanation')
          : relation.confidence === 'heuristic'
            ? t('data.code.inferredExplanation')
            : t('data.code.unresolvedExplanation')}
      </p>
    </section>
  );
}
export function CodeAnalysisProperties({ graph }: { graph: Graph }) {
  const { t } = useI18n();
  const analysis = getCodeAnalysis(graph);
  if (!analysis) return null;
  return (
    <section className="code-details" aria-label={t('data.code.analysisRegion')}>
      <div className="property-section">{t('data.code.analysisTitle')}</div>
      <p>{analysis.languages.map(languageName).join(', ')}</p>
      <p>
        {t('data.code.analysisCounts', {
          files: analysis.fileCount,
          symbols: analysis.symbolCount,
          dependencies: analysis.dependencyCount,
          unresolved: analysis.unresolvedCount,
        })}
      </p>
      <p>
        {analysis.mode === 'folders'
          ? t('import.code.modeFolders')
          : analysis.mode === 'files'
            ? t('import.code.modeFiles')
            : t('import.code.modeSymbols')}
        {analysis.focus ? t('data.code.focusSuffix', { focus: analysis.focus }) : ''}
      </p>
      {analysis.directoryCount !== undefined && (
        <p>{t('data.code.folderCount', { count: analysis.directoryCount })}</p>
      )}
      {analysis.project && (
        <p>
          {t('data.code.zipDetails', {
            name: analysis.project.name,
            size: (analysis.project.expandedBytes / 1024 / 1024).toFixed(1),
            count: analysis.project.ignoredEntries,
          })}
        </p>
      )}
      {analysis.warnings.length > 0 && (
        <details>
          <summary>{t('import.codePreview.notes', { count: analysis.warnings.length })}</summary>
          <ul>
            {analysis.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <p>{t('data.code.structuralNotTrace')}</p>
    </section>
  );
}
