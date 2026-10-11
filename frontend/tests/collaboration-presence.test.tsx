import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CollaborationSnapshot } from '../src/collaboration/types';
import { PresenceBar } from '../src/collaboration/ui/PresenceBar';
import { ParticipantAvatar } from '../src/collaboration/ui/ParticipantAvatar';
import {
  participantInitials,
  presenceAvatar,
  presenceColor,
  presencePalette,
  presenceTextColor,
} from '../src/collaboration/ui/presence-color';
import {
  boundsOverlap,
  reservePresenceBounds,
  type ControlBounds,
} from '../src/collaboration/ui/presence-layout';

const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const person = {
  deviceId: 'one',
  profileId: 'stable-profile',
  name: 'Pat Lee',
  role: 'editor' as const,
  credentialId: 'a'.repeat(64),
  selectedNodeIds: [],
  connected: true,
  lastSeen: 0,
};

describe('bounded, identifiable collaboration presence', () => {
  it('retains color across names and devices using the public profile identity', () => {
    const renamed = { ...person, deviceId: 'new-device', name: 'Renamed' };
    expect(presenceColor(person)).toBe(presenceColor(renamed));
    expect(presencePalette).toContain(presenceColor({ deviceId: 'legacy-device' }));
    expect(presenceColor({ ...person, color: 'url(https://example.com)' })).toBe(
      presenceColor(person),
    );
    expect(presenceColor({ ...person, color: '#F0F0F0' })).toBe('#f0f0f0');
  });

  it('pairs arbitrary canonical colors with readable black or white initials', () => {
    const luminance = (color: string) =>
      [1, 3, 5]
        .map((at) => {
          const value = Number.parseInt(color.slice(at, at + 2), 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    for (const color of [...presencePalette, '#ffffff', '#000000', '#808080', '#55aa00']) {
      const values = [luminance(color), luminance(presenceTextColor(color))].sort((a, b) => b - a);
      expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses readable initials and validates raster size, format and canonical encoding before rendering', () => {
    expect(participantInitials('  Pat   Lee  ')).toBe('PL');
    expect(participantInitials('𐐀lex')).toBe('𐐀');
    expect(participantInitials('')).toBe('?');
    expect(presenceAvatar(pixel)).toBe(pixel);
    for (const value of [
      'https://example.com/avatar.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,AAAA',
      pixel + ' ',
      'data:image/png;base64,' + 'A'.repeat(90_000),
    ])
      expect(presenceAvatar(value)).toBeUndefined();
  });

  it('falls back to initials when a bounded raster cannot be decoded', () => {
    const result = render(<ParticipantAvatar person={{ ...person, avatarDataUrl: pixel }} />);
    fireEvent.error(result.container.querySelector('img')!);
    expect(result.container.querySelector('img')).toBeNull();
    expect(screen.getByText('PL')).toBeVisible();
  });

  it('shows a bounded avatar set, total count, names and a working keyboard/pointer control', () => {
    const snapshot: CollaborationSnapshot = {
      configured: true,
      roomId: 'room',
      status: 'live',
      displayName: 'Pat',
      scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
      participants: Array.from({ length: 25 }, (_, index) => ({
        ...person,
        deviceId: `${index}`,
        name: `${'Long participant name '.repeat(8)} ${index}`,
        connected: index !== 24,
      })),
      pendingJoins: [],
    };
    const open = vi.fn();
    const result = render(<PresenceBar snapshot={snapshot} onOpen={open} />);
    const button = screen.getByRole('button', { name: /24 connected.*Long participant name/ });
    expect(result.container.querySelectorAll('.collaboration-presence-avatar')).toHaveLength(3);
    expect(screen.getByText('+21')).toBeVisible();
    fireEvent.click(button);
    expect(open).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('type', 'button');
  });
});

describe('shared canvas control reservation', () => {
  const desktop = { left: 236, top: 110, right: 1158, bottom: 874 };
  const mobile = { left: 0, top: 100, right: 390, bottom: 820 };
  function slot(canvas: ControlBounds, controls: ControlBounds[]) {
    const result = reservePresenceBounds(canvas, 230, 44, controls);
    expect(result).toBeDefined();
    for (const control of controls) expect(boundsOverlap(result!, control, 8)).toBe(false);
    expect(result!.left).toBeGreaterThanOrEqual(canvas.left + 12);
    expect(result!.right).toBeLessThanOrEqual(canvas.right - 12);
    expect(result!.top).toBeGreaterThanOrEqual(canvas.top + 12);
    expect(result!.bottom).toBeLessThanOrEqual(canvas.bottom - 12);
    return result!;
  }
  it('places desktop presence beside zoom/Fit with a gap instead of under its click targets', () => {
    const zoom = { left: 254, top: 762, right: 284, bottom: 850 };
    expect(slot(desktop, [zoom, { left: 550, top: 820, right: 900, bottom: 862 }]).left).toBe(292);
  });
  it('stacks above the mobile selection drawer and its raised Fit/toggle row', () => {
    const fit = { left: 12, top: 630, right: 58, bottom: 676 };
    const toggles = { left: 148, top: 630, right: 378, bottom: 682 };
    const drawer = { left: 12, top: 708, right: 378, bottom: 828 };
    expect(slot(mobile, [fit, toggles, drawer]).bottom).toBeLessThanOrEqual(fit.top - 8);
  });
  it('avoids expanded player, update notice and 3D layers/HUD controls', () => {
    slot(desktop, [
      { left: 248, top: 122, right: 1146, bottom: 180 },
      { left: 252, top: 192, right: 562, bottom: 610 },
      { left: 270, top: 634, right: 1120, bottom: 862 },
      { left: 980, top: 610, right: 1420, bottom: 960 },
    ]);
  });
  it('does not cover controls when no canvas slot is available', () => {
    expect(reservePresenceBounds(mobile, 230, 44, [mobile])).toBeUndefined();
    expect(
      reservePresenceBounds({ left: 0, top: 0, right: 200, bottom: 50 }, 230, 44, []),
    ).toBeUndefined();
  });
});
