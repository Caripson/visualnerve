import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollaborationPanel, PresenceBar } from '../src/collaboration/ui';
import type { CollaborationSnapshot, CollaborationUiController } from '../src/collaboration/types';
import { defaultCollaborationShareScope } from '../src/collaboration/document/scope';
import { APP_LOCALES, I18nProvider, type AppLocale } from '../src/i18n';
import { AppLocaleController } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { MessageFormatter } from '../src/i18n/message-formatter';

const scopes = { ...defaultCollaborationShareScope };
const fingerprint = 'c'.repeat(64);
const participant = {
  deviceId: 'guest-device',
  name: 'Pat Lee',
  role: 'editor' as const,
  credentialId: fingerprint,
  connected: true,
  selectedNodeIds: ['a'],
  lastSeen: Date.now(),
};
function fixture(overrides: Partial<CollaborationSnapshot> = {}) {
  let snapshot: Readonly<CollaborationSnapshot> = {
    configured: true,
    status: 'idle',
    diagramId: 'selected-diagram',
    participants: [],
    pendingJoins: [],
    displayName: '',
    scope: scopes,
    ...overrides,
  };
  const listeners = new Set<() => void>();
  const controller: CollaborationUiController = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    create: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockResolvedValue(undefined),
    createInvitation: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    changeRole: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    closeRoom: vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller,
    emit(next: Partial<CollaborationSnapshot>) {
      snapshot = { ...snapshot, ...next };
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}
const active = {
  status: 'live' as const,
  roomId: 'room-one',
  role: 'owner' as const,
  selfDeviceId: 'owner-device',
  participants: [participant],
};
const languages: AppLocaleController[] = [];
async function language(locale: AppLocale) {
  const controller = new AppLocaleController(new LocaleCatalogLoader(), {
    getItem: () => locale,
    setItem: vi.fn(),
  });
  languages.push(controller);
  await controller.start();
  return { controller, formatter: new MessageFormatter(locale, controller.getSnapshot().catalog!) };
}
afterEach(() => {
  for (const language of languages.splice(0)) language.dispose();
  vi.restoreAllMocks();
});

describe('collaboration consent, permissions and authoritative UI state', () => {
  it('shows review and disclosure limits before creating or joining without opening help', () => {
    const { controller } = fixture();
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    const notice = screen.getByText(/Optional collaboration has not been independently audited/);
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent('approved participants can keep copies');
    fireEvent.click(screen.getByRole('button', { name: 'Join a room' }));
    expect(notice).toBeVisible();
    expect(screen.getByRole('button', { name: 'Request to join' })).toBeDisabled();
    expect(controller.create).not.toHaveBeenCalled();
    expect(controller.join).not.toHaveBeenCalled();
  });
  it('shows the pending device its complete fingerprint for approval through a trusted channel', () => {
    const { controller } = fixture({
      ...active,
      status: 'awaiting-approval',
      role: undefined,
      participants: [],
      ownerCredentialId: 'a'.repeat(64),
      selfCredentialId: 'b'.repeat(64),
    });
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    expect(screen.getByText('Your device fingerprint')).toBeVisible();
    expect(screen.getByText('b'.repeat(64))).toBeVisible();
    expect(screen.getByText('a'.repeat(64))).toBeVisible();
    expect(screen.getByText(/separate trusted channel before approval/)).toBeVisible();
  });

  it('explains a retained local recovery copy without exposing an invitation or interpreting its title as HTML', () => {
    const { controller } = fixture({
      ...active,
      role: 'viewer',
      recoveryCopy: { diagramId: 'local-recovery-id', title: '<img src=x> unsent work' },
    });
    const rendered = render(<CollaborationPanel controller={controller} close={() => {}} />);
    expect(
      screen.getByText(/unsent changes were kept in a local recovery diagram/),
    ).toHaveTextContent('<img src=x> unsent work');
    expect(screen.getByText(/Find it in Projects/)).toBeVisible();
    expect(rendered.container.querySelector('img')).toBeNull();
  });

  it('explains an unconfigured relay without pretending to create or join a room', () => {
    const { controller } = fixture({ configured: false });
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    expect(screen.getByText(/relay is not configured/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start private room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument();
    expect(controller.create).not.toHaveBeenCalled();
  });

  it('requires an open diagram and explicit consent, with every optional disclosure initially off', async () => {
    const test = fixture({
      diagramId: undefined,
      scope: { shareMetadata: true, shareOwners: true, shareDatasets: true },
    });
    render(<CollaborationPanel controller={test.controller} close={() => {}} />);
    for (const label of [
      'Custom metadata and integration IDs',
      'Assigned owners and their details',
      'Raw datasets and CSV analysis data',
    ])
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Your display name'), { target: { value: '  Alex  ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I have reviewed/ }));
    expect(screen.getByRole('button', { name: 'Start private room' })).toBeDisabled();
    test.emit({ diagramId: 'selected-diagram' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Assigned owners and their details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start private room' }));
    await waitFor(() =>
      expect(test.controller.create).toHaveBeenCalledWith('selected-diagram', 'Alex', {
        shareMetadata: false,
        shareOwners: true,
        shareDatasets: false,
      }),
    );
    expect(
      screen
        .getAllByText(/cannot revoke screenshots/)
        .some((item) => item.closest('details') === null),
    ).toBe(true);
  });

  it('fills an incoming private link without joining before the user chooses a name and requests access', async () => {
    const { controller } = fixture();
    const invitation = 'https://app.example/#collaboration=private-one-use-link';
    render(
      <CollaborationPanel
        controller={controller}
        close={() => {}}
        initialInvitation={invitation}
      />,
    );
    expect(screen.getByLabelText('Private invitation link')).toHaveValue(invitation);
    expect(controller.join).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Your display name'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request to join' }));
    await waitFor(() => expect(controller.join).toHaveBeenCalledWith(invitation, 'Sam'));
    await waitFor(() => expect(screen.getByLabelText('Private invitation link')).toHaveValue(''));
  });

  it('shows complete admission fingerprints and defaults a new device to viewer', async () => {
    const { controller } = fixture({
      ...active,
      pendingJoins: [
        {
          deviceId: 'pending-device',
          credentialId: 'd'.repeat(64),
          expiresAt: Date.now() + 60_000,
        },
      ],
    });
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    const pending = screen.getByRole('region', { name: 'Waiting for your approval' });
    expect(within(pending).getByText('d'.repeat(64))).toBeVisible();
    expect(within(pending).getByRole('combobox', { name: 'Permission' })).toHaveValue('viewer');
    fireEvent.change(within(pending).getByLabelText('New profile name'), {
      target: { value: 'Sam' },
    });
    fireEvent.click(within(pending).getByRole('button', { name: 'Approve device' }));
    await waitFor(() =>
      expect(controller.approve).toHaveBeenCalledWith('pending-device', 'viewer', undefined, 'Sam'),
    );
  });

  it('requires a concrete confirmation before removing a participant, and cancellation does nothing', async () => {
    const { controller } = fixture(active);
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove participant' }));
    expect(controller.remove).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog');
    expect(within(confirmation).getByText(/Remove Pat Lee/)).toBeVisible();
    expect(
      within(confirmation).getByText(/Copies already received cannot be recalled/),
    ).toBeVisible();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(controller.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove participant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(controller.remove).toHaveBeenCalledWith('guest-device'));
  });

  it('confirms role changes and prevents viewers from using owner controls', async () => {
    const test = fixture(active);
    render(<CollaborationPanel controller={test.controller} close={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Permission · Pat Lee' }), {
      target: { value: 'viewer' },
    });
    expect(test.controller.changeRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await waitFor(() =>
      expect(test.controller.changeRole).toHaveBeenCalledWith('guest-device', 'viewer'),
    );
    test.emit({ role: 'viewer' });
    expect(
      screen.queryByRole('button', { name: 'Create one-use invitation' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove participant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave room' })).toBeVisible();
  });

  it('reflects live controller progress and recovery without changing the shared model in the panel', async () => {
    const test = fixture({
      ...active,
      status: 'syncing',
      syncProgress: { completed: 2, total: 5 },
    });
    render(<CollaborationPanel controller={test.controller} close={() => {}} />);
    expect(screen.getByRole('progressbar', { name: 'Synchronizing diagram' })).toHaveAttribute(
      'value',
      '2',
    );
    expect(screen.getByText('Syncing: 2 of 5 parts')).toBeVisible();
    test.emit({ status: 'offline', syncProgress: undefined });
    expect(screen.getByText('Offline · live sync paused')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove participant' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect live session' }));
    await waitFor(() => expect(test.controller.reconnect).toHaveBeenCalledOnce());
    test.emit({ status: 'live', participants: [{ ...participant, connected: false }] });
    expect(screen.getByText('Disconnected')).toBeVisible();
  });

  it.each([
    { status: 'error' as const, role: 'owner' as const },
    { status: 'conflict' as const, role: 'owner' as const },
    { status: 'error' as const, role: 'editor' as const },
    { status: 'conflict' as const, role: 'viewer' as const },
  ])(
    'offers local cleanup for a $role after $status without attempting room closure',
    async (failed) => {
      const { controller } = fixture({ ...active, ...failed });
      render(<CollaborationPanel controller={controller} close={() => {}} />);
      expect(
        screen.queryByRole('button', { name: 'Reconnect live session' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Close room for everyone' }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'End local session' }));
      expect(controller.leave).not.toHaveBeenCalled();
      const confirmation = screen.getByRole('alertdialog');
      expect(within(confirmation).getByText(/Your saved local diagram remains/)).toBeVisible();
      expect(
        within(confirmation).getByText(/relay room and other participants are not closed/),
      ).toBeVisible();
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm change' }));
      await waitFor(() => expect(controller.leave).toHaveBeenCalledOnce());
      expect(controller.closeRoom).not.toHaveBeenCalled();
      expect(controller.reconnect).not.toHaveBeenCalled();
    },
  );

  it('offers explicit local cleanup after startup fails before a room exists', async () => {
    const { controller } = fixture({ status: 'error', error: 'Local startup failed' });
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    expect(screen.queryByLabelText(/^Copy Room ID/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start private room' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End local session' }));
    expect(screen.getByText(/relay room and other participants are not closed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(controller.leave).toHaveBeenCalledOnce());
    expect(controller.closeRoom).not.toHaveBeenCalled();
  });

  it('changes an open owner close confirmation to local cleanup if the live session fails', async () => {
    const test = fixture(active);
    render(<CollaborationPanel controller={test.controller} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close room for everyone' }));
    expect(screen.getByText(/All participants are disconnected/)).toBeVisible();
    test.emit({ status: 'error' });
    expect(screen.queryByText(/All participants are disconnected/)).not.toBeInTheDocument();
    expect(screen.getByText(/relay room and other participants are not closed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(test.controller.leave).toHaveBeenCalledOnce());
    expect(test.controller.closeRoom).not.toHaveBeenCalled();
  });

  it.each(['live', 'offline'] as const)(
    'keeps the owner room-close action during ordinary %s state',
    async (status) => {
      const { controller } = fixture({ ...active, status });
      render(<CollaborationPanel controller={controller} close={() => {}} />);
      expect(screen.queryByRole('button', { name: 'End local session' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Close room for everyone' }));
      expect(screen.getByText(/All participants are disconnected/)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
      await waitFor(() => expect(controller.closeRoom).toHaveBeenCalledOnce());
      expect(controller.leave).not.toHaveBeenCalled();
    },
  );

  it('does not issue duplicate creates while an asynchronous creation is pending', async () => {
    const { controller } = fixture();
    let complete!: () => void;
    vi.mocked(controller.create).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const close = vi.fn();
    render(<CollaborationPanel controller={controller} close={close} />);
    fireEvent.change(screen.getByLabelText('Your display name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I have reviewed/ }));
    const create = screen.getByRole('button', { name: 'Start private room' });
    fireEvent.click(create);
    fireEvent.click(create);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(controller.create).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    await act(async () => complete());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('shows the room owner fingerprint and safely treats participant names as text', () => {
    const { controller } = fixture({
      ...active,
      ownerCredentialId: 'a'.repeat(64),
      participants: [{ ...participant, name: '<img src=x onerror=alert(1)>' }],
    });
    render(<CollaborationPanel controller={controller} close={() => {}} />);
    expect(screen.getByText('a'.repeat(64))).toBeVisible();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('uses actual connected participants in the compact presence control', () => {
    const { controller } = fixture({
      ...active,
      participants: [participant, { ...participant, deviceId: 'offline-person', connected: false }],
    });
    const open = vi.fn();
    render(<PresenceBar snapshot={controller.getSnapshot()} onOpen={open} />);
    const button = screen.getByRole('button', { name: /1 connected/ });
    fireEvent.click(button);
    expect(open).toHaveBeenCalledOnce();
  });

  it.each(APP_LOCALES.map(({ id }) => id))(
    'provides consent and security messages in %s while keeping semantic controller values canonical',
    async (locale) => {
      const lang = await language(locale);
      const { controller } = fixture();
      render(
        <I18nProvider controller={lang.controller}>
          <CollaborationPanel controller={controller} close={() => {}} />
        </I18nProvider>,
      );
      const { t } = lang.formatter;
      expect(screen.getByRole('dialog', { name: t('collaboration.title') })).toBeVisible();
      expect(screen.getByRole('checkbox', { name: t('collaboration.datasets') })).not.toBeChecked();
      fireEvent.change(screen.getByLabelText(t('collaboration.displayName')), {
        target: { value: 'My authored name' },
      });
      fireEvent.click(screen.getByRole('checkbox', { name: t('collaboration.shareConsent') }));
      fireEvent.click(screen.getByRole('button', { name: t('collaboration.createAction') }));
      await waitFor(() =>
        expect(controller.create).toHaveBeenCalledWith(
          'selected-diagram',
          'My authored name',
          scopes,
        ),
      );
    },
  );
});
