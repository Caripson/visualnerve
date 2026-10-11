import { useState, type FormEvent } from 'react';
import { Field } from '../../../components/Field';
import { useI18n } from '../../../i18n';
import type { ParticipantProfile } from '../../model';
import { collaborationLimits, defaultParticipantColor } from '../../model';
import { ParticipantAvatar } from '../ParticipantAvatar';
import { presenceColor } from '../presence-color';
import { normalizeProfileAvatar } from './avatar-upload';
import { ConfirmRemoval, WorkPages } from './Shared';
import type { DocumentWorkProps } from './types';

function ProfileForm({
  profile,
  work,
  close,
}: {
  profile?: ParticipantProfile;
  work: DocumentWorkProps;
  close(): void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(
    profile?.color ??
      (profile
        ? presenceColor({ deviceId: profile.id })
        : defaultParticipantColor(work.document.profiles)),
  );
  const [avatar, setAvatar] = useState(profile?.avatarDataUrl);
  const [loading, setLoading] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [baseVersion] = useState(work.graph.diagram.version);
  const disabled = !work.writable || work.busy || loading;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const details = { name: name.trim(), color, avatarDataUrl: avatar ?? null };
    if (
      await work.run(
        profile
          ? { type: 'profile.update', id: profile.id, patch: details }
          : { type: 'profile.create', profile: details },
        profile ? baseVersion : undefined,
      )
    )
      close();
  };
  return (
    <form className="document-work-form" onSubmit={(event) => void submit(event)}>
      <Field title={t('collaboration.document.profileName')}>
        <input
          value={name}
          maxLength={collaborationLimits.name}
          required
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="document-profile-appearance">
        <ParticipantAvatar
          person={{
            deviceId: profile?.id ?? 'new-profile',
            profileId: profile?.id,
            name,
            color,
            avatarDataUrl: avatar,
          }}
        />
        <Field title={t('editor.properties.color')}>
          <input
            type="color"
            value={color}
            disabled={disabled}
            onChange={(event) => setColor(event.target.value)}
          />
        </Field>
      </div>
      <Field title={t('collaboration.document.avatar')}>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setLoading(true);
            setAvatarError(false);
            void normalizeProfileAvatar(file)
              .then(setAvatar)
              .catch(() => setAvatarError(true))
              .finally(() => setLoading(false));
            event.target.value = '';
          }}
        />
      </Field>
      <p className="muted">{t('collaboration.document.avatarHint')}</p>
      {avatarError && <p role="alert">{t('collaboration.document.avatarError')}</p>}
      {avatar && (
        <button type="button" disabled={disabled} onClick={() => setAvatar(undefined)}>
          {t('collaboration.document.removeAvatar')}
        </button>
      )}
      <div className="document-work-actions">
        <button type="submit" className="primary" disabled={disabled || !name.trim()}>
          {t('common.save')}
        </button>
        <button type="button" disabled={disabled} onClick={close}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

export function Profiles(work: DocumentWorkProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<ParticipantProfile | 'new'>();
  return (
    <section>
      <p className="muted">{t('collaboration.document.profileHint')}</p>
      {work.writable && work.owner && (
        <button disabled={work.busy || !!editing} onClick={() => setEditing('new')}>
          {t('collaboration.document.createProfile')}
        </button>
      )}
      {work.writable && work.owner && editing === 'new' && (
        <ProfileForm work={work} close={() => setEditing(undefined)} />
      )}
      {!work.document.profiles.length && (
        <p className="muted">{t('collaboration.document.empty')}</p>
      )}
      <WorkPages items={work.document.profiles}>
        {(profile) => (
          <article className="document-work-card" key={profile.id}>
            <div className="document-profile-heading">
              <ParticipantAvatar
                person={{ deviceId: profile.id, profileId: profile.id, ...profile }}
              />
              <strong>{profile.name}</strong>
              {profile.id === work.profileId && (
                <span className="collaboration-badge">{t('collaboration.self')}</span>
              )}
            </div>
            {work.writable &&
            (work.owner || profile.id === work.profileId) &&
            editing !== 'new' &&
            editing?.id === profile.id ? (
              <ProfileForm
                key={profile.id}
                profile={profile}
                work={work}
                close={() => setEditing(undefined)}
              />
            ) : (
              work.writable &&
              (work.owner || profile.id === work.profileId) && (
                <button disabled={work.busy || !!editing} onClick={() => setEditing(profile)}>
                  {t('collaboration.document.edit')}
                </button>
              )
            )}
            {work.writable && work.owner && (
              <ConfirmRemoval
                disabled={work.busy}
                unavailable={
                  profile.id === work.profileId ||
                  work.document.comments.some(
                    (thread) =>
                      thread.authorId === profile.id ||
                      thread.resolvedBy === profile.id ||
                      thread.messages.some((message) => message.authorId === profile.id),
                  ) ||
                  work.document.tasks.some(
                    (task) => task.authorId === profile.id || task.assigneeId === profile.id,
                  ) ||
                  work.document.activity.some((event) => event.authorId === profile.id)
                }
                remove={() => work.run({ type: 'profile.remove', id: profile.id })}
              />
            )}
          </article>
        )}
      </WorkPages>
    </section>
  );
}
