import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoiceSettings } from '../src/components/VoiceSettings';
import { database } from '../src/storage/database';
import { workspace } from '../src/storage/workspace';
import { speechService } from '../src/presentation/speech/service';
import { DEFAULT_VOICE_ID } from '../src/presentation/speech/voices';

vi.mock('../src/storage/database', () => ({ database: { settings: { get: vi.fn() } } }));
vi.mock('../src/storage/workspace', () => ({ workspace: { setPreference: vi.fn() } }));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { prepare: vi.fn(), cachedVoices: vi.fn(), clearCache: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(database.settings.get).mockResolvedValue(undefined);
  vi.mocked(speechService.cachedVoices).mockResolvedValue([]);
  vi.mocked(workspace.setPreference).mockResolvedValue(undefined);
});
it('shows English by default with explicit download/privacy information and no automatic inference', async () => {
  render(<VoiceSettings />);
  expect(screen.getByRole('combobox', { name: 'Narration voice' })).toHaveValue(DEFAULT_VOICE_ID);
  expect(screen.getByText(/English is the default/)).toHaveTextContent(
    'descriptions are never sent',
  );
  expect(screen.getByText(/First audio playback/)).toHaveTextContent('109 MB');
  await waitFor(() => expect(database.settings.get).toHaveBeenCalledWith('presentation-voice'));
  expect(speechService.prepare).not.toHaveBeenCalled();
});
it('saves a Swedish voice without downloading its model', async () => {
  render(<VoiceSettings />);
  await waitFor(() => expect(database.settings.get).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sv_SE-nst-medium' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice' }));
  await waitFor(() =>
    expect(workspace.setPreference).toHaveBeenCalledWith('presentation-voice', 'sv_SE-nst-medium'),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('saved');
  expect(speechService.prepare).not.toHaveBeenCalled();
});
it('retains the users voice choice when the initial database read arrives late', async () => {
  let finish!: () => void;
  const pending = new Promise<undefined>((resolve) => {
    finish = () => resolve(undefined);
  });
  vi.mocked(database.settings.get).mockReturnValue(
    pending as ReturnType<typeof database.settings.get>,
  );
  render(<VoiceSettings />);
  await waitFor(() => expect(database.settings.get).toHaveBeenCalled());
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
  vi.mocked(database.settings.get).mockResolvedValue({
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
  const signal = prepare.mock.calls[0][2]!;
  expect(signal.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel voice preview' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
});
it('reports storage failure and lets the user clear downloaded weights', async () => {
  vi.mocked(workspace.setPreference).mockRejectedValue(new Error('Storage full'));
  render(<VoiceSettings />);
  await waitFor(() => expect(database.settings.get).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en_GB-cori-high' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save voice' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full');
  fireEvent.click(screen.getByRole('button', { name: 'Clear downloaded voices' }));
  await waitFor(() => expect(speechService.clearCache).toHaveBeenCalledOnce());
  expect(await screen.findByRole('status')).toHaveTextContent('cleared');
});
