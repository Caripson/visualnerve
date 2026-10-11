import { useState, type FormEvent } from 'react';
import { Field } from '../../../components/Field';
import { useI18n } from '../../../i18n';
import { collaborationLimits, type CommentMessage, type CommentThread } from '../../model';
import { ConfirmRemoval, NodeTarget, ProfileName, TargetLabel, WorkPages } from './Shared';
import type { DocumentWorkProps } from './types';

function Message({
  message,
  thread,
  work,
}: {
  message: CommentMessage;
  thread: CommentThread;
  work: DocumentWorkProps;
}) {
  const { t, date } = useI18n();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const [baseVersion, setBaseVersion] = useState(work.graph.diagram.version);
  return (
    <div className="document-comment-message">
      <div className="document-work-meta">
        <ProfileName document={work.document} id={message.authorId} />
        <time dateTime={message.createdAt}>
          {date(message.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
        </time>
      </div>
      {editing && work.writable && message.authorId === work.profileId ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void work
              .run(
                {
                  type: 'comment.edit',
                  id: thread.id,
                  messageId: message.id,
                  text: text.trim(),
                },
                baseVersion,
              )
              .then((saved) => saved && setEditing(false));
          }}
        >
          <Field title={t('collaboration.document.commentText')}>
            <textarea
              value={text}
              maxLength={collaborationLimits.text}
              disabled={work.busy}
              required
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="document-work-actions">
            <button disabled={work.busy || !text.trim()}>{t('common.save')}</button>
            <button type="button" disabled={work.busy} onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <p className="document-work-text">{message.text}</p>
      )}
      {!editing && work.writable && message.authorId === work.profileId && (
        <button
          disabled={work.busy}
          onClick={() => {
            setText(message.text);
            setBaseVersion(work.graph.diagram.version);
            setEditing(true);
          }}
        >
          {t('collaboration.document.edit')}
        </button>
      )}
      {work.writable && (work.owner || message.authorId === work.profileId) && (
        <ConfirmRemoval
          disabled={work.busy}
          remove={() => work.run({ type: 'comment.remove', id: thread.id, messageId: message.id })}
        />
      )}
    </div>
  );
}
function Thread({ thread, work }: { thread: CommentThread; work: DocumentWorkProps }) {
  const { t } = useI18n();
  const [reply, setReply] = useState('');
  return (
    <article className="document-work-card">
      <div className="document-work-meta">
        <TargetLabel graph={work.graph} nodeId={thread.nodeId} title={thread.nodeTitle} />
        <span>
          {t(thread.resolved ? 'collaboration.document.resolved' : 'collaboration.document.open')}
        </span>
      </div>
      <WorkPages
        items={[...thread.messages].sort(
          (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id),
        )}
      >
        {(message) => <Message key={message.id} message={message} thread={thread} work={work} />}
      </WorkPages>
      {work.writable &&
        (work.owner ||
          (thread.authorId === work.profileId &&
            thread.messages.every((message) => message.authorId === work.profileId))) && (
          <ConfirmRemoval
            disabled={work.busy}
            remove={() => work.run({ type: 'comment.remove', id: thread.id })}
          />
        )}
      {work.writable && work.profileId && (
        <>
          {(work.owner || thread.authorId === work.profileId) && (
            <button
              disabled={work.busy}
              onClick={() =>
                void work.run({
                  type: 'comment.resolve',
                  id: thread.id,
                  resolved: !thread.resolved,
                })
              }
            >
              {t(
                thread.resolved
                  ? 'collaboration.document.reopen'
                  : 'collaboration.document.resolve',
              )}
            </button>
          )}
          {!thread.resolved && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void work
                  .run({ type: 'comment.reply', id: thread.id, text: reply.trim() })
                  .then((saved) => saved && setReply(''));
              }}
            >
              <Field title={t('collaboration.document.reply')}>
                <textarea
                  value={reply}
                  required
                  maxLength={collaborationLimits.text}
                  disabled={work.busy}
                  onChange={(event) => setReply(event.target.value)}
                />
              </Field>
              <button disabled={work.busy || !reply.trim()}>
                {t('collaboration.document.reply')}
              </button>
            </form>
          )}
        </>
      )}
    </article>
  );
}
export function Comments(work: DocumentWorkProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [nodeId, setNodeId] = useState(work.selectedNodeId ?? '');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await work.run({ type: 'comment.create', ...(nodeId ? { nodeId } : {}), text: text.trim() })
    )
      setText('');
  };
  return (
    <section>
      {work.writable && work.profileId && (
        <form className="document-work-form" onSubmit={(event) => void submit(event)}>
          <NodeTarget
            graph={work.graph}
            value={nodeId}
            change={setNodeId}
            diagram
            disabled={work.busy}
          />
          <Field title={t('collaboration.document.commentText')}>
            <textarea
              value={text}
              required
              maxLength={collaborationLimits.text}
              disabled={work.busy}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <button
            className="primary"
            disabled={
              work.busy ||
              !text.trim() ||
              (!!nodeId && !work.graph.nodes.some((node) => node.id === nodeId))
            }
          >
            {t('collaboration.document.addComment')}
          </button>
        </form>
      )}
      {!work.document.comments.length && (
        <p className="muted">{t('collaboration.document.empty')}</p>
      )}
      <WorkPages
        items={[...work.document.comments].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        )}
      >
        {(thread) => <Thread key={thread.id} thread={thread} work={work} />}
      </WorkPages>
    </section>
  );
}
