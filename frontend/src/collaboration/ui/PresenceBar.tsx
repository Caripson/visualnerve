import { Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { CollaborationSnapshot } from '../types';
import { ParticipantAvatar } from './ParticipantAvatar';
import { usePresenceDock } from './usePresenceDock';
import './collaboration.css';

export function PresenceBar({
  snapshot,
  onOpen,
}: {
  snapshot: Readonly<CollaborationSnapshot>;
  onOpen: () => void;
}) {
  const { t, number } = useI18n();
  const dock = usePresenceDock(!!snapshot.roomId);
  if (!snapshot.roomId) return null;
  const online = snapshot.participants.filter((participant) => participant.connected);
  const visible = online.slice(0, 3);
  const status = t(`collaboration.status.${snapshot.status}`);
  const connected = t('collaboration.connectedCount', { count: number(online.length) });
  return (
    <button
      ref={dock}
      className={`collaboration-presence status-${snapshot.status}`}
      type="button"
      onClick={onOpen}
      title={`${status} · ${connected}${online.length ? ` · ${visible.map((person) => person.name || person.deviceId).join(', ')}` : ''}`}
      aria-label={`${t('collaboration.open')} · ${status} · ${connected}${online.length ? ` · ${visible.map((person) => person.name || person.deviceId).join(', ')}` : ''}`}
    >
      <Users size={16} aria-hidden="true" />
      <span className="collaboration-presence-label">{status}</span>
      <span className="collaboration-presence-count">{number(online.length)}</span>
      <span className="collaboration-presence-avatars" aria-hidden="true">
        {visible.map((person) => (
          <ParticipantAvatar
            key={person.deviceId}
            person={person}
            className="collaboration-presence-avatar"
          />
        ))}
        {online.length > visible.length && (
          <span className="collaboration-presence-more">
            +{number(online.length - visible.length)}
          </span>
        )}
      </span>
    </button>
  );
}
