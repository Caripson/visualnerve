import { validateAvatarDataUrl } from '../model/avatar';
import { participantProfilePalette } from '../model/color';

/** Presence colors are independent of diagram node/status colors. */
export const presencePalette = participantProfilePalette;

export function presenceColor(person: { profileId?: string; deviceId: string; color?: string }) {
  const selected = person.color?.toLowerCase();
  if (selected && /^#[0-9a-f]{6}$/u.test(selected)) return selected;
  let hash = 2166136261;
  for (const character of person.profileId || person.deviceId) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return presencePalette[(hash >>> 0) % presencePalette.length];
}

export function presenceTextColor(color: string) {
  const components = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2];
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export function participantInitials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const selected = parts.length > 1 ? [parts[0], parts.at(-1)!] : parts.slice(0, 1);
  return (
    selected
      .map((part) => Array.from(part)[0])
      .join('')
      .toLocaleUpperCase() || '?'
  );
}

/** Remote and executable image URLs must never be loaded by a presence badge. */
export function presenceAvatar(avatar?: string) {
  if (!avatar) return undefined;
  try {
    validateAvatarDataUrl(avatar);
    return avatar;
  } catch {
    return undefined;
  }
}
