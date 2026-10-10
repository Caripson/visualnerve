import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationSnapshot, CollaborationUiController } from '../src/collaboration/types';
import { defaultCollaborationShareScope } from '../src/collaboration/document/scope';
import en from '../src/i18n/collaboration/en';
import da from '../src/i18n/collaboration/da';
import nb from '../src/i18n/collaboration/nb';
import sv from '../src/i18n/collaboration/sv';
import fi from '../src/i18n/collaboration/fi';
import de from '../src/i18n/collaboration/de';
import es from '../src/i18n/collaboration/es';
import fr from '../src/i18n/collaboration/fr';

const runtime = vi.hoisted(() => ({
  encrypted: false,
  getController: vi.fn(),
  release: vi.fn(),
}));
vi.mock('../src/storage/runtime', () => ({
  get vaultSession() {
    return runtime.encrypted ? {} : undefined;
  },
  get vaultCrypto() {
    return runtime.encrypted ? {} : undefined;
  },
}));
vi.mock('../src/collaboration/runtime', () => ({ collaborationRuntime: runtime }));
import { CollaborationFeature } from '../src/collaboration/CollaborationFeature';

function controller(overrides: Partial<CollaborationSnapshot> = {}) {
  const snapshot: CollaborationSnapshot = {
    configured: false,
    status: 'idle',
    displayName: '',
    participants: [],
    pendingJoins: [],
    scope: { ...defaultCollaborationShareScope },
    ...overrides,
  };
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
  } as unknown as CollaborationUiController;
}
beforeEach(() => {
  runtime.encrypted = false;
  runtime.getController.mockReset();
  runtime.release.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('collaboration action accessibility in every language', () => {
  it.each(Object.entries({ en, da, nb, sv, fi, de, es, fr }))(
    '%s preserves the visible toolbar label inside its accessible name',
    (_language, messages) => {
      // WCAG label-in-name also lets speech-control users activate the action
      // by saying its short visible label. Keep the longer accessible purpose.
      const normalize = (text: string) =>
        text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      const visibleLabel = normalize(messages['collaboration.action']);
      expect(visibleLabel).not.toBe('');
      expect(normalize(messages['collaboration.open'])).toContain(visibleLabel);
    },
  );
});

describe('optional collaboration feature lifecycle', () => {
  it('explains the encrypted app requirement without constructing a legacy controller', () => {
    const close = vi.fn();
    render(<CollaborationFeature open close={close} onOpen={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Live collaboration' })).toBeVisible();
    expect(screen.getByText(/requires the encrypted app workspace/)).toBeVisible();
    expect(screen.getByText(/does not move or share your existing diagrams/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open the encrypted app' })).toHaveAttribute(
      'href',
      'https://app.visualnerve.com/',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.getController).not.toHaveBeenCalled();
  });

  it('has no unavailable dialog or overlay when the legacy panel is closed', () => {
    const { container } = render(
      <CollaborationFeature open={false} close={() => {}} onOpen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(runtime.getController).not.toHaveBeenCalled();
  });

  it('closing the encrypted panel retains live presence and the same session', () => {
    runtime.encrypted = true;
    const current = controller({ configured: true, status: 'live', roomId: 'private-room' });
    runtime.getController.mockReturnValue(current);
    const onOpen = vi.fn();
    const { rerender } = render(<CollaborationFeature open close={() => {}} onOpen={onOpen} />);
    expect(screen.getByRole('dialog', { name: 'Live collaboration' })).toBeVisible();
    rerender(<CollaborationFeature open={false} close={() => {}} onOpen={onOpen} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const presence = screen.getByRole('button', {
      name: 'Open collaboration and participants · Live · 0 connected',
    });
    expect(presence).toBeVisible();
    fireEvent.click(presence);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(runtime.release).not.toHaveBeenCalled();
  });

  it('unmounting the encrypted App releases its controller and presence', () => {
    runtime.encrypted = true;
    const current = controller({ configured: true, status: 'live', roomId: 'private-room' });
    runtime.getController.mockReturnValue(current);
    const { unmount } = render(
      <CollaborationFeature open={false} close={() => {}} onOpen={() => {}} />,
    );
    unmount();
    expect(runtime.release).toHaveBeenCalledExactlyOnceWith(current);
    expect(
      screen.queryByRole('button', { name: /Open collaboration and participants/ }),
    ).toBeNull();
  });
});
