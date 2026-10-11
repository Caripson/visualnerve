import { useMemo, useState, type CSSProperties } from 'react';
import {
  participantInitials,
  presenceAvatar,
  presenceColor,
  presenceTextColor,
} from './presence-color';

interface PresenceIdentity {
  deviceId: string;
  profileId?: string;
  name: string;
  color?: string;
  avatarDataUrl?: string;
}

export function ParticipantAvatar({
  person,
  className = 'collaboration-avatar',
}: {
  person: PresenceIdentity;
  className?: string;
}) {
  const avatar = useMemo(() => presenceAvatar(person.avatarDataUrl), [person.avatarDataUrl]);
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const color = presenceColor(person);
  return (
    <span
      className={className}
      title={person.name || person.deviceId}
      aria-hidden="true"
      style={
        { '--presence-color': color, '--presence-text': presenceTextColor(color) } as CSSProperties
      }
    >
      {avatar && avatar !== failedAvatar ? (
        <img
          src={avatar}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setFailedAvatar(avatar)}
        />
      ) : (
        participantInitials(person.name)
      )}
    </span>
  );
}
