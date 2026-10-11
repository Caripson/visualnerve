import { useState, type ReactNode } from 'react';
import { useI18n } from '../../../i18n';
import type { Graph } from '../../../model/types';
import type { CollaborationDocument } from '../../model';

export function NodeTarget({
  graph,
  value,
  change,
  diagram = false,
  disabled = false,
  missingTitle,
}: {
  graph: Graph;
  value: string;
  change(value: string): void;
  diagram?: boolean;
  disabled?: boolean;
  missingTitle?: string;
}) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t('collaboration.document.target')}</span>
      <select
        aria-label={t('collaboration.document.target')}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
      >
        {diagram && <option value="">{t('collaboration.document.diagramTarget')}</option>}
        {!diagram && !value && <option value="">{t('collaboration.document.chooseNode')}</option>}
        {!!value && !graph.nodes.some((node) => node.id === value) && (
          <option value={value}>
            {missingTitle ? `${missingTitle} · ` : ''}
            {t('collaboration.document.missingNode')}
          </option>
        )}
        {graph.nodes.map((node) => (
          <option value={node.id} key={node.id}>
            {node.title || node.id}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TargetLabel({
  graph,
  nodeId,
  title,
}: {
  graph: Graph;
  nodeId?: string;
  title?: string;
}) {
  const { t } = useI18n();
  if (!nodeId) return <span>{t('collaboration.document.diagramTarget')}</span>;
  const node = graph.nodes.find((node) => node.id === nodeId);
  return (
    <span>
      {node?.title || title || nodeId}
      {!node && ` · ${t('collaboration.document.missingNode')}`}
    </span>
  );
}

export function ProfileName({ document, id }: { document: CollaborationDocument; id?: string }) {
  const { t } = useI18n();
  return (
    <span>
      {document.profiles.find((profile) => profile.id === id)?.name ||
        t('collaboration.document.unassigned')}
    </span>
  );
}

/** Read every record without mounting thousands of full forms at once. */
export function WorkPages<T>({
  items,
  children,
}: {
  items: readonly T[];
  children(item: T): ReactNode;
}) {
  const { t, number } = useI18n();
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / 25) - 1));
  return (
    <>
      <div className="document-work-list">
        {items.slice(current * 25, (current + 1) * 25).map(children)}
      </div>
      {items.length > 25 && (
        <nav className="document-work-pages" aria-label={t('collaboration.document.pages')}>
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            {t('common.previous')}
          </button>
          <span>
            {number(current + 1)} / {number(Math.ceil(items.length / 25))}
          </span>
          <button
            disabled={(current + 1) * 25 >= items.length}
            onClick={() => setPage(current + 1)}
          >
            {t('common.next')}
          </button>
        </nav>
      )}
    </>
  );
}

export function ConfirmRemoval({
  disabled,
  unavailable = false,
  remove,
}: {
  disabled: boolean;
  unavailable?: boolean;
  remove(): Promise<boolean>;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button
        type="button"
        disabled={disabled || unavailable}
        title={unavailable ? t('collaboration.document.removeUnavailable') : undefined}
        onClick={() => setConfirming(true)}
      >
        {t('collaboration.document.remove')}
      </button>
    );
  return (
    <div
      className="document-work-confirmation"
      role="group"
      aria-label={t('collaboration.document.confirmRemove')}
    >
      <p>{t('collaboration.document.removeHint')}</p>
      <div className="document-work-actions">
        <button
          type="button"
          disabled={disabled || unavailable}
          onClick={() => void remove().then((removed) => removed && setConfirming(false))}
        >
          {t('collaboration.document.confirmRemove')}
        </button>
        <button type="button" disabled={disabled} onClick={() => setConfirming(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
