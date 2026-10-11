import type { ParticipantProfile } from './types';

/** Shared display palette; colors identify labels and do not confer identity or permissions. */
export const participantProfilePalette = [
  '#2563eb',
  '#7c3aed',
  '#0f766e',
  '#be123c',
  '#b45309',
  '#4338ca',
  '#047857',
  '#a21caf',
] as const;

/** Pick the first unused color, then balance reuse deterministically in palette order. */
export function defaultParticipantColor(
  profiles: readonly Pick<ParticipantProfile, 'color'>[],
): string {
  const counts = participantProfilePalette.map(
    (color) => profiles.filter((profile) => profile.color?.toLowerCase() === color).length,
  );
  return participantProfilePalette[counts.indexOf(Math.min(...counts))];
}
