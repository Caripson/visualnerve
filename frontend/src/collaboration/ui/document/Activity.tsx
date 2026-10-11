import { useI18n } from '../../../i18n';
import type { MessageId } from '../../../i18n';
import { ProfileName, TargetLabel, WorkPages } from './Shared';
import type { DocumentWorkProps } from './types';

export function Activity(work: DocumentWorkProps) {
  const { t, date } = useI18n();
  const category = (kind: string): MessageId =>
    kind.startsWith('profile.')
      ? 'collaboration.document.profiles'
      : kind.startsWith('comment.')
        ? 'collaboration.document.comments'
        : kind.startsWith('task.')
          ? 'collaboration.document.tasks'
          : 'collaboration.document.diagramTarget';
  return (
    <section>
      <p className="muted">{t('collaboration.document.activityHint')}</p>
      {!work.document.activity.length && (
        <p className="muted">{t('collaboration.document.empty')}</p>
      )}
      <WorkPages
        items={[...work.document.activity].sort(
          (a, b) => b.sequence - a.sequence || a.id.localeCompare(b.id),
        )}
      >
        {(event) => (
          <article className="document-work-card" key={event.id}>
            <div className="document-work-meta">
              <strong>
                {t(category(event.kind))} ·{' '}
                {t(`collaboration.document.event.${event.kind.split('.')[1]}` as MessageId)}
              </strong>
              <time dateTime={event.timestamp}>
                {date(event.timestamp, { dateStyle: 'short', timeStyle: 'short' })}
              </time>
            </div>
            <div className="document-work-meta">
              <ProfileName document={work.document} id={event.authorId} />
              <span>{t(`collaboration.document.source.${event.source}`)}</span>
            </div>
            {event.nodeIds?.map((id) => (
              <TargetLabel key={id} graph={work.graph} nodeId={id} />
            ))}
          </article>
        )}
      </WorkPages>
    </section>
  );
}
