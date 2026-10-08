import { beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import type { WorkspaceChange } from '../src/storage/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoiceSettings } from '../src/components/VoiceSettings';
import { workspaceStorage } from '../src/storage/runtime';
import { workspace } from '../src/storage/workspace';
import { speechService } from '../src/presentation/speech/service';
import { DEFAULT_VOICE_ID } from '../src/presentation/speech/voices';

const storageEvents = vi.hoisted(() => ({
  listeners: new Set<(change: WorkspaceChange) => void>(),
  unsubscribe: vi.fn(),
}));
vi.mock('../src/storage/runtime', () => ({
  workspaceStorage: {
    settings: { get: vi.fn() },
    subscribe: vi.fn((listener: (change: WorkspaceChange) => void) => {
      storageEvents.listeners.add(listener);
      return () => {
        storageEvents.listeners.delete(listener);
        storageEvents.unsubscribe();
      };
    }),
  },
}));
vi.mock('../src/storage/workspace', () => ({ workspace: { setPreference: vi.fn() } }));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { prepare: vi.fn(), cachedVoices: vi.fn(), clearCache: vi.fn() },
}));
vi.mock('../src/presentation/narrator', () => ({
  Narrator: class {
    unlock = vi.fn().mockResolvedValue(undefined);
    play = vi.fn().mockResolvedValue(1);
    dispose = vi.fn();
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  storageEvents.listeners.clear();
  vi.mocked(workspaceStorage.settings.get).mockReset().mockResolvedValue(undefined);
  vi.mocked(speechService.cachedVoices).mockResolvedValue([]);
  vi.mocked(workspace.setPreference).mockResolvedValue(undefined);
});
it('shows English by default with explicit download/privacy information and no automatic inference', async () => {
  render(<VoiceSettings />);
  expect(screen.getByRole('combobox', { name: 'Narration voice' })).toHaveValue(DEFAULT_VOICE_ID);
  expect(screen.getByText(/Alan, a British male voice, is the default/)).toHaveTextContent(
    'descriptions are never sent',
  );
  expect(screen.getByText(/First audio playback/)).toHaveTextContent('61 MB');
  await waitFor(() =>
    expect(workspaceStorage.settings.get).toHaveBeenCalledWith('presentation-voice'),
  );
  expect(speechService.prepare).not.toHaveBeenCalled();
});
it('saves a Swedish voice without downloading its model', async () => {
  render(<VoiceSettings />);
  await waitFor(() => expect(workspaceStorage.settings.get).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sv_SE-nst-medium' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice' }));
  await waitFor(() =>
    expect(workspace.setPreference).toHaveBeenCalledWith('presentation-voice', 'sv_SE-nst-medium'),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('saved');
  expect(speechService.prepare).not.toHaveBeenCalled();
});
it('retains the users voice choice when the initial workspace read arrives late', async () => {
  let finish!: () => void;
  const pending = new Promise<undefined>((resolve) => {
    finish = () => resolve(undefined);
  });
  vi.mocked(workspaceStorage.settings.get).mockReturnValue(
    pending as ReturnType<typeof workspaceStorage.settings.get>,
  );
  render(<VoiceSettings />);
  await waitFor(() => expect(workspaceStorage.settings.get).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sv_SE-nst-medium' } });
  await act(async () => {
    finish();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium');
  expect(screen.getByRole('button', { name: 'Save voice' })).toBeEnabled();
});
it('shows saved preference and cached models without downloading on mount', async () => {
  vi.mocked(workspaceStorage.settings.get).mockResolvedValue({
    key: 'presentation-voice',
    value: 'sv_SE-nst-medium',
  });
  vi.mocked(speechService.cachedVoices).mockResolvedValue(['sv_SE-nst-medium']);
  render(<VoiceSettings />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium'));
  expect(screen.getByText(/Voice downloaded/)).toHaveTextContent('available offline');
  expect(speechService.prepare).not.toHaveBeenCalled();
});
it('previews only on explicit action, exposes progress and aborts download on cancel', async () => {
  const prepare = vi.mocked(speechService.prepare);
  prepare.mockImplementation((_text, _voice, _signal, progress) => {
    progress?.({ stage: 'download', loaded: 50, total: 100, message: 'Downloading voice' });
    return new Promise(() => undefined);
  });
  render(<VoiceSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }));
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  expect(screen.getByRole('status')).toHaveTextContent('50%');
  expect(screen.getByRole('progressbar', { name: 'Voice preparation' })).toHaveAttribute(
    'value',
    '50',
  );
  const signal = prepare.mock.calls[0][2]!;
  expect(signal.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel voice preview' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
});
it('reports storage failure and lets the user clear downloaded weights', async () => {
  vi.mocked(workspace.setPreference).mockRejectedValue(new Error('Storage full'));
  render(<VoiceSettings />);
  await waitFor(() => expect(workspaceStorage.settings.get).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en_GB-cori-high' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full');
  fireEvent.click(screen.getByRole('button', { name: 'Clear downloaded voices' }));
  await waitFor(() => expect(speechService.clearCache).toHaveBeenCalledOnce());
  expect(await screen.findByRole('status')).toHaveTextContent('cleared');
});

it('refreshes committed workspace preferences without subscribing to unrelated table changes', async () => {
  const { unmount } = render(<VoiceSettings />);
  await waitFor(() => expect(workspaceStorage.settings.get).toHaveBeenCalledOnce());
  expect(storageEvents.listeners.size).toBe(1);
  act(() => {
    for (const listener of storageEvents.listeners) listener({ stores: ['nodes'] });
  });
  expect(workspaceStorage.settings.get).toHaveBeenCalledOnce();
  vi.mocked(workspaceStorage.settings.get).mockResolvedValue({
    key: 'presentation-voice',
    value: 'sv_SE-nst-medium',
  });
  act(() => {
    for (const listener of storageEvents.listeners) listener({ stores: ['settings'] });
  });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium'));
  expect(workspaceStorage.settings.get).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Save voice' })).toBeDisabled();
  unmount();
  expect(storageEvents.listeners.size).toBe(0);
  expect(storageEvents.unsubscribe).toHaveBeenCalledOnce();
});

it('does not let a late initial read replace a newer committed preference', async () => {
  let finish!: (record: Awaited<ReturnType<typeof workspaceStorage.settings.get>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof workspaceStorage.settings.get>>>(
    (resolve) => {
      finish = resolve;
    },
  );
  vi.mocked(workspaceStorage.settings.get)
    .mockReturnValueOnce(pending)
    .mockResolvedValue({ key: 'presentation-voice', value: 'sv_SE-nst-medium' });
  render(<VoiceSettings />);
  act(() => {
    for (const listener of storageEvents.listeners) listener({ stores: ['settings'] });
  });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium'));
  await act(async () => {
    finish({ key: 'presentation-voice', value: DEFAULT_VOICE_ID });
    await pending;
  });
  expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium');
  expect(screen.getByRole('button', { name: 'Save voice' })).toBeDisabled();
});

it('ignores disposed-effect responses after Strict Mode reconnects the backend subscription', async () => {
  let finish!: (record: Awaited<ReturnType<typeof workspaceStorage.settings.get>>) => void;
  let finishCache!: (voices: string[]) => void;
  const pending = new Promise<Awaited<ReturnType<typeof workspaceStorage.settings.get>>>(
    (resolve) => {
      finish = resolve;
    },
  );
  const pendingCache = new Promise<string[]>((resolve) => {
    finishCache = resolve;
  });
  vi.mocked(workspaceStorage.settings.get)
    .mockReturnValueOnce(pending)
    .mockResolvedValue({ key: 'presentation-voice', value: 'sv_SE-nst-medium' });
  vi.mocked(speechService.cachedVoices).mockReturnValueOnce(pendingCache).mockResolvedValue([]);
  const { unmount } = render(
    <StrictMode>
      <VoiceSettings />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium'));
  expect(storageEvents.listeners.size).toBe(1);
  expect(storageEvents.unsubscribe).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ key: 'presentation-voice', value: DEFAULT_VOICE_ID });
    finishCache(['sv_SE-nst-medium']);
    await Promise.all([pending, pendingCache]);
  });
  expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium');
  expect(screen.getByText(/First audio playback/)).toBeInTheDocument();
  unmount();
  expect(storageEvents.listeners.size).toBe(0);
  expect(storageEvents.unsubscribe).toHaveBeenCalledTimes(2);
});

it('preserves an unsaved voice selection when a committed preference changes elsewhere', async () => {
  render(<VoiceSettings />);
  await waitFor(() => expect(workspaceStorage.settings.get).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sv_SE-nst-medium' } });
  vi.mocked(workspaceStorage.settings.get).mockResolvedValue({
    key: 'presentation-voice',
    value: 'en_GB-cori-high',
  });
  await act(async () => {
    for (const listener of storageEvents.listeners) listener({ stores: ['settings'] });
  });
  expect(screen.getByRole('combobox')).toHaveValue('sv_SE-nst-medium');
  expect(screen.getByRole('button', { name: 'Save voice' })).toBeEnabled();
});
