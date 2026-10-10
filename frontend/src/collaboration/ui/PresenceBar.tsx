import { Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { CollaborationSnapshot } from '../types';
import './collaboration.css';

export function PresenceBar({
  snapshot,
  onOpen,
}: {
  snapshot: Readonly<CollaborationSnapshot>;
  onOpen: () => void;
}) {
  const { t, number } = useI18n();
  if (!snapshot.roomId) return null;
  const online = snapshot.participants.filter((participant) => participant.connected);
  return (
    <button
      className={`collaboration-presence status-${snapshot.status}`}
      onClick={onOpen}
      aria-label={`${t('collaboration.open')} · ${t(`collaboration.status.${snapshot.status}`)} · ${t('collaboration.connectedCount', { count: number(online.length) })}`}
    >
      <Users size={16} aria-hidden="true" />
      <span>{t(`collaboration.status.${snapshot.status}`)}</span>
      <span className="collaboration-presence-count">{number(online.length)}</span>
      <span className="collaboration-presence-avatars" aria-hidden="true">
        {online.slice(0, 3).map((person) => (
          <span key={person.deviceId} title={person.name}>
            {person.name.trim().slice(0, 1).toLocaleUpperCase() || '?'}
          </span>
        ))}
      </span>
    </button>
  );
}
