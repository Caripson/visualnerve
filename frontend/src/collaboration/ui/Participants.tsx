import { useState } from 'react';
import { Check, UserRound, ShieldCheck, UserX } from 'lucide-react';
import { Field } from '../../components/Field';
import { CopyValue } from './CopyValue';
import { useI18n } from '../../i18n';
import type { CollaborationRole } from '../../../../collaboration-worker/src/protocol';
import type { CollaborationSnapshot, CollaborationUiController } from '../types';

export type RoomConfirmation =
  | { kind: 'remove'; deviceId: string; name: string }
  | { kind: 'role'; deviceId: string; name: string; role: 'editor' | 'viewer' }
  | { kind: 'reject'; deviceId: string }
  | { kind: 'leave' | 'close' };

function RoleChoice({
  role,
  change,
  disabled = false,
  name,
}: {
  role: 'editor' | 'viewer';
  change: (role: 'editor' | 'viewer') => void;
  disabled?: boolean;
  name?: string;
}) {
  const { t } = useI18n();
  return (
    <Field title={name ? `${t('collaboration.role')} · ${name}` : t('collaboration.role')}>
      <select
        value={role}
        disabled={disabled}
        onChange={(event) => change(event.target.value as 'editor' | 'viewer')}
      >
        <option value="viewer">{t('collaboration.role.viewer')}</option>
        <option value="editor">{t('collaboration.role.editor')}</option>
      </select>
    </Field>
  );
}

function PendingRequest({
  deviceId,
  credentialId,
  expiresAt,
  disabled,
  approve,
  reject,
}: {
  deviceId: string;
  credentialId: string;
  expiresAt: number;
  disabled: boolean;
  approve: (role: 'editor' | 'viewer') => void;
  reject: () => void;
}) {
  const { t, date } = useI18n();
  // Least privilege: a new device is a viewer unless the owner explicitly changes it.
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  return (
    <li className="collaboration-request">
      <CopyValue label={t('collaboration.deviceId')} value={deviceId} />
      <p className="muted">
        {t('collaboration.expires', {
          date: date(expiresAt, { dateStyle: 'medium', timeStyle: 'short' }),
        })}
      </p>
      <CopyValue label={t('collaboration.fingerprint')} value={credentialId} />
      <p>{t('collaboration.compareFingerprint')}</p>
      <RoleChoice role={role} change={setRole} disabled={disabled} />
      <div className="collaboration-actions">
        <button disabled={disabled} className="primary" onClick={() => approve(role)}>
          <Check size={16} />
          {t('collaboration.approve')}
        </button>
        <button disabled={disabled} onClick={reject}>
          {t('collaboration.reject')}
        </button>
      </div>
    </li>
  );
}

export function Participants({
  snapshot,
  controller,
  busy,
  run,
  confirm,
}: {
  snapshot: Readonly<CollaborationSnapshot>;
  controller: CollaborationUiController;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  confirm: (value: RoomConfirmation) => void;
}) {
  const { t } = useI18n();
  const owner = snapshot.role === 'owner';
  const mutable = owner && snapshot.status === 'live' && !busy;
  const roleLabel = (role: CollaborationRole) => t(`collaboration.role.${role}`);
  return (
    <>
      {owner && snapshot.pendingJoins.length > 0 && (
        <section aria-label={t('collaboration.pending')}>
          <h3>{t('collaboration.pending')}</h3>
          <p className="muted">{t('collaboration.roleHint')}</p>
          <ul className="collaboration-list">
            {snapshot.pendingJoins.map((request) => (
              <PendingRequest
                key={request.deviceId}
                {...request}
                disabled={!mutable}
                approve={(role) => run(() => controller.approve(request.deviceId, role))}
                reject={() => confirm({ kind: 'reject', deviceId: request.deviceId })}
              />
            ))}
          </ul>
        </section>
      )}
      <section aria-label={t('collaboration.participants')}>
        <h3>{t('collaboration.participants')}</h3>
        <p className="muted">{t('collaboration.nameHint')}</p>
        <ul className="collaboration-list">
          {snapshot.participants.map((participant) => (
            <li className="collaboration-participant" key={participant.deviceId}>
              <span className="collaboration-avatar" aria-hidden="true">
                <UserRound size={19} />
              </span>
              <div className="collaboration-person-details">
                <p className="collaboration-person-name">
                  {participant.name || participant.deviceId}
                  {participant.deviceId === snapshot.selfDeviceId && (
                    <span className="collaboration-badge">{t('collaboration.self')}</span>
                  )}
                </p>
                <p className="collaboration-person-status">
                  <span
                    className={`collaboration-dot ${participant.connected ? 'connected' : ''}`}
                    aria-hidden="true"
                  />
                  <span>
                    {t(participant.connected ? 'collaboration.online' : 'collaboration.offline')}
                  </span>
                  <span>·</span>
                  {roleLabel(participant.role)}
                  {participant.actor === 'mcp' && (
                    <span className="collaboration-badge">{t('collaboration.agent')}</span>
                  )}
                </p>
                {participant.selectedNodeIds.length > 0 && (
                  <p className="muted">
                    {t('collaboration.selected', { count: participant.selectedNodeIds.length })}
                  </p>
                )}
                <details className="collaboration-identity-details">
                  <summary>
                    <ShieldCheck size={14} />
                    {t('collaboration.fingerprint')}
                  </summary>
                  <CopyValue
                    hideLabel
                    label={`${t('collaboration.fingerprint')} · ${participant.name || participant.deviceId}`}
                    value={participant.credentialId}
                  />
                </details>
                {owner && participant.role !== 'owner' && (
                  <div className="collaboration-member-controls">
                    <RoleChoice
                      role={participant.role}
                      name={participant.name || participant.deviceId}
                      disabled={!mutable}
                      change={(role) =>
                        confirm({
                          kind: 'role',
                          deviceId: participant.deviceId,
                          name: participant.name || participant.deviceId,
                          role,
                        })
                      }
                    />
                    <button
                      className="danger"
                      disabled={!mutable}
                      onClick={() =>
                        confirm({
                          kind: 'remove',
                          deviceId: participant.deviceId,
                          name: participant.name || participant.deviceId,
                        })
                      }
                    >
                      <UserX size={16} />
                      {t('collaboration.remove')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
