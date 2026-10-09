import { useI18n } from '../i18n';
import type { KeyboardEvent } from 'react';
import type { GraphNode } from '../model/types';
import { getCodeObject, getProjectDirectory } from '../code/schema';
import { codeLanguages } from '../code/catalog';
import './code-summary.css';

const protectReading = (event: KeyboardEvent) => {
  if (
    [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
    ].includes(event.key)
  )
    event.stopPropagation();
};

export function CodeSummary({
  node,
  exporting = false,
  selected = false,
}: {
  node: GraphNode;
  exporting?: boolean;
  selected?: boolean;
}) {
  const { t } = useI18n();
  const object = getCodeObject(node);
  const directory = getProjectDirectory(node);
  if (directory)
    return (
      <div
        className="code-summary"
        aria-label={t('data.codeSummary.folderRegion')}
        data-exporting={exporting}
      >
        <div className="code-object-kind">
          {t('data.codeSummary.folderCount', { count: directory.fileCount })}
        </div>
        <div
          className="code-object-scroll nodrag nopan nowheel"
          data-node-scroll
          role="region"
          aria-label={t('data.codeSummary.folderDetailsFor', { title: node.title })}
          tabIndex={exporting ? undefined : 0}
          onKeyDown={protectReading}
        >
          <div className="code-object-path">
            {directory.path === '.' ? t('data.code.projectRoot') : directory.path}
          </div>
          <div>
            {directory.languages
              .map((id) => codeLanguages.find((item) => item.id === id)?.name ?? id)
              .join(', ')}
          </div>
          <p>{t('data.codeSummary.aggregateFolders')}</p>
        </div>
        {!exporting && (
          <div className="code-summary-footer">
            <span className="code-resize-hint">
              {selected ? t('data.codeSummary.dragResize') : t('data.codeSummary.selectResize')}
            </span>
          </div>
        )}
      </div>
    );
  if (!object) return null;
  return (
    <div
      className="code-summary"
      aria-label={t('data.codeSummary.objectRegion')}
      data-exporting={exporting}
    >
      <div className="code-object-kind">
        {codeLanguages.find((language) => language.id === object.language)?.name ?? object.language}{' '}
        · {object.kind}
        {object.external && <span> {t('data.codeSummary.unresolvedSuffix')}</span>}
      </div>
      <div
        className="code-object-scroll nodrag nopan nowheel"
        data-node-scroll
        role="region"
        aria-label={t('data.codeSummary.codeDetailsFor', { title: node.title })}
        tabIndex={exporting ? undefined : 0}
        onKeyDown={protectReading}
      >
        {object.kind !== 'file' && (
          <div className="code-object-name">
            <span>{t('data.codeSummary.symbolLabel')}</span> {object.name}
          </div>
        )}
        <div className="code-object-path">
          {object.path}
          {object.line ? `:${object.line}` : ''}
          {object.endLine && object.endLine !== object.line ? `–${object.endLine}` : ''}
        </div>
        {!!object.summary?.length && (
          <ul aria-label={t('data.codeSummary.declarationsAccessible')}>
            {object.summary.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="code-summary-footer">
        {!!object.summary?.length && (
          <span>{t('data.codeSummary.declarationCount', { count: object.summary.length })}</span>
        )}
        {!exporting && (
          <span className="code-resize-hint" title={t('data.codeSummary.readResizeHint')}>
            {selected ? t('data.codeSummary.dragResize') : t('data.codeSummary.selectResize')}
          </span>
        )}
      </div>
    </div>
  );
}
