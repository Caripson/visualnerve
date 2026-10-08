import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { VoiceSettings } from '../src/components/VoiceSettings';
import { Narrator } from '../src/presentation/narrator';
import { speechService } from '../src/presentation/speech/service';

vi.mock('../src/storage/runtime', () => ({
  workspaceStorage: {
    settings: { get: vi.fn(async () => undefined) },
    subscribe: vi.fn(() => () => undefined),
  },
}));
vi.mock('../src/storage/workspace', () => ({ workspace: { setPreference: vi.fn() } }));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { prepare: vi.fn(), cachedVoices: vi.fn(), clearCache: vi.fn() },
}));

let gesture = false;
let events: string[] = [];
const contexts: TestContext[] = [];
class TestSource {
  buffer?: AudioBuffer;
  onended?: () => void;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn(() => events.push('start'));
  stop = vi.fn();
}
class TestContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  sources: TestSource[] = [];
  constructor() {
    contexts.push(this);
    events.push('context');
  }
  resume = vi.fn(async () => {
    events.push('unlock');
    if (!gesture) throw new DOMException('Gesture expired', 'NotAllowedError');
    this.state = 'running';
  });
  decodeAudioData = vi.fn(async () => {
    events.push('decode');
    return { duration: 1 } as AudioBuffer;
  });
  createBufferSource() {
    const source = new TestSource();
    this.sources.push(source);
    return source;
  }
  close = vi.fn(async () => {
    this.state = 'closed';
    events.push('close');
  });
}
const wav = () => new NodeBlob(['local wav']) as unknown as Blob;
function clickPreview() {
  gesture = true;
  fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }));
  gesture = false;
}
beforeEach(() => {
  vi.clearAllMocks();
  contexts.length = 0;
  events = [];
  gesture = false;
  vi.stubGlobal('AudioContext', TestContext);
  vi.mocked(speechService.cachedVoices).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('cold voice preview keeps its browser gesture', () => {
  it('unlocks synchronously before downloading, plays after the gesture expires and cleans up on natural end', async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(speechService.prepare).mockImplementation((_text, _voice, _signal, progress) => {
      events.push('prepare');
      progress?.({ stage: 'download', loaded: 50, total: 100, message: 'Downloading voice' });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<VoiceSettings />);
    clickPreview();
    expect(events).toEqual(['context', 'unlock']);
    expect(speechService.prepare).not.toHaveBeenCalled();
    await waitFor(() => expect(speechService.prepare).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('50%');
    vi.mocked(speechService.cachedVoices).mockResolvedValue(['en_GB-alan-medium']);
    await act(async () => {
      finish(wav());
    });
    expect(events).toEqual(['context', 'unlock', 'prepare', 'decode', 'start']);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel voice preview' })).toBeEnabled();
    expect(screen.getByText(/Voice downloaded and available offline/)).toBeVisible();
    act(() => contexts[0].sources[0].onended?.());
    expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(contexts[0].sources[0].disconnect).toHaveBeenCalledOnce();
    expect(vi.mocked(speechService.prepare).mock.calls[0][2]!.aborted).toBe(true);
  });

  it('cancels a cold download and ignores a late synthesized buffer', async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(speechService.prepare).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<VoiceSettings />);
    clickPreview();
    await waitFor(() => expect(speechService.prepare).toHaveBeenCalledOnce());
    const signal = vi.mocked(speechService.prepare).mock.calls[0][2]!;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel voice preview' }));
    expect(signal.aborted).toBe(true);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    await act(async () => {
      finish(wav());
    });
    expect(contexts[0].decodeAudioData).not.toHaveBeenCalled();
    expect(contexts[0].sources).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts preparation and closes the unlocked context when Settings unmounts', async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(speechService.prepare).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = render(<VoiceSettings />);
    clickPreview();
    await waitFor(() => expect(speechService.prepare).toHaveBeenCalledOnce());
    unmount();
    expect(vi.mocked(speechService.prepare).mock.calls[0][2]!.aborted).toBe(true);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    await act(async () => {
      finish(wav());
    });
    expect(contexts[0].sources).toEqual([]);
  });

  it('reports a rejected unlock without downloading and can retry with a fresh gesture', async () => {
    vi.mocked(speechService.prepare).mockResolvedValue(wav());
    render(<VoiceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Gesture expired');
    expect(speechService.prepare).not.toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    clickPreview();
    await waitFor(() => expect(contexts[1]?.sources).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel voice preview' })).toBeEnabled();
  });
});

describe('Narrator natural end callback', () => {
  it('ignores pause/manual stop events and notifies exactly once for the resumed natural end', async () => {
    const narrator = new Narrator();
    gesture = true;
    const unlocked = narrator.unlock();
    gesture = false;
    await unlocked;
    const ended = vi.fn();
    await narrator.play(wav(), new AbortController().signal, ended);
    const first = contexts[0].sources[0];
    contexts[0].currentTime = 0.3;
    narrator.pause();
    first.onended?.();
    expect(ended).not.toHaveBeenCalled();
    narrator.resume();
    const resumed = contexts[0].sources[1];
    resumed.onended?.();
    resumed.onended?.();
    expect(ended).toHaveBeenCalledOnce();
    await narrator.play(wav(), new AbortController().signal, ended);
    const cancelled = contexts[0].sources[2];
    narrator.dispose();
    cancelled.onended?.();
    expect(ended).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });
});
