import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataPrivacy, PrivacyIntro } from '../src/components/DataPrivacy';
import type { WorkspaceBackup } from '../src/storage/database';
import { isEncryptedWorkspaceSurface } from '../src/security/surface';
import { exportAllData } from '../src/storage/backup';
import { clearAppCache } from '../src/security/app-cache';
import { speechService } from '../src/presentation/speech/service';
import { presentation } from '../src/presentation/service';
import { disposeVideoExport } from '../src/presentation/video-service';

const editorState = vi.hoisted(() => ({
  diagrams: [],
  mcpAccess: 'off',
  workspaceId: 'local-workspace',
  lastExport: undefined,
}));
vi.mock('../src/state/editor', () => ({
  useEditor: (select: (state: typeof editorState) => unknown) => select(editorState),
}));
vi.mock('../src/storage/runtime', () => ({ workspaceStorage: { schemaVersion: 8 } }));
vi.mock('../src/storage/database', () => {
  throw new Error('Privacy settings must not import the legacy private database.');
});
vi.mock('../src/storage/workspace', () => ({
  workspace: { setPreference: vi.fn(), acceptStorage: vi.fn(), deleteAll: vi.fn() },
}));
vi.mock('../src/storage/backup', () => ({ exportAllData: vi.fn() }));
vi.mock('../src/security/surface', () => ({ isEncryptedWorkspaceSurface: vi.fn() }));
vi.mock('../src/security/app-cache', () => ({ clearAppCache: vi.fn() }));
vi.mock('../src/imports/preference', () => ({ currentImportLimitBytes: () => 50 * 1024 * 1024 }));
vi.mock('../src/presentation/speech/service', () => ({ speechService: { dispose: vi.fn() } }));
vi.mock('../src/presentation/service', () => ({
  presentation: { close: vi.fn(), settled: vi.fn(async () => {}) },
}));
vi.mock('../src/presentation/video-service', () => ({
  disposeVideoExport: vi.fn(async () => {}),
}));

function backup(): WorkspaceBackup {
  return {
    format: 'visual-nerve-workspace',
    formatVersion: 1,
    exportedAt: '2026-10-08T10:00:00.000Z',
    diagrams: [],
    nodes: [],
    edges: [],
    owners: [],
    settings: [],
    templates: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isEncryptedWorkspaceSurface).mockReturnValue(false);
  vi.mocked(exportAllData).mockResolvedValue(undefined);
  vi.mocked(clearAppCache).mockResolvedValue({ available: true, deletedCaches: [] });
  vi.mocked(disposeVideoExport).mockResolvedValue(undefined);
  vi.mocked(presentation.settled).mockResolvedValue(undefined);
});

describe('privacy settings on the selected workspace surface', () => {
  it('keeps readable-backup guidance for the legacy surface and displays the logical schema', () => {
    render(<DataPrivacy restore={vi.fn()} deleted={vi.fn()} />);
    expect(screen.getByLabelText('Security of downloaded copies')).toHaveTextContent(
      'JSON backups and JSON or Markdown exports contain readable workspace content',
    );
    expect(screen.getByText('IndexedDB · schema 8')).toBeInTheDocument();
  });

  it('shows old-credential guidance at encrypted first use and in data settings', () => {
    vi.mocked(isEncryptedWorkspaceSurface).mockReturnValue(true);
    const intro = render(<PrivacyIntro />);
    expect(screen.getByLabelText('Security of downloaded copies')).toHaveTextContent(
      'Older encrypted backups can still be opened with the password or recovery key used when they were created',
    );
    intro.unmount();
    render(<DataPrivacy restore={vi.fn()} deleted={vi.fn()} />);
    expect(screen.getByLabelText('Security of downloaded copies')).toHaveTextContent(
      'Plaintext exports remain unencrypted',
    );
    expect(
      screen.queryByText(/JSON backups and JSON or Markdown exports contain readable/),
    ).toBeNull();
  });

  it('downloads through the authoritative exporter and identifies the encrypted copy accurately', async () => {
    vi.mocked(isEncryptedWorkspaceSurface).mockReturnValue(true);
    render(<DataPrivacy restore={vi.fn()} deleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }));
    expect(exportAllData).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Encrypted backup downloaded. Use the password or recovery key from this export to restore it.',
    );
  });

  it('delegates the original encrypted file to the credential reader before opening restore', async () => {
    vi.mocked(isEncryptedWorkspaceSurface).mockReturnValue(true);
    const restored = backup();
    const restore = vi.fn();
    const onReadBackup = vi.fn(async () => restored);
    const encrypted = new File(['encrypted container'], 'encrypted-backup.json', {
      type: 'application/json',
    });
    const text = vi.fn(() => {
      throw new Error('Encrypted file must be read by the credential-aware reader.');
    });
    Object.defineProperty(encrypted, 'text', { value: text });
    render(<DataPrivacy restore={restore} deleted={vi.fn()} onReadBackup={onReadBackup} />);
    fireEvent.change(screen.getByLabelText('Restore backup file'), {
      target: { files: [encrypted] },
    });
    await waitFor(() => expect(restore).toHaveBeenCalledWith(restored));
    expect(onReadBackup).toHaveBeenCalledWith(encrypted);
    expect(text).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
  });

  it('still reads legacy backups when no encrypted credential reader is supplied', async () => {
    const restored = backup();
    const restore = vi.fn();
    const selected = new File([JSON.stringify(restored)], 'legacy-backup.json');
    Object.defineProperty(selected, 'text', {
      value: vi.fn(async () => JSON.stringify(restored)),
    });
    render(<DataPrivacy restore={restore} deleted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Restore backup file'), {
      target: { files: [selected] },
    });
    await waitFor(() => expect(restore).toHaveBeenCalledWith(restored));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('rejects oversized files before asking for credentials or reading their content', async () => {
    const restore = vi.fn();
    const onReadBackup = vi.fn(async () => backup());
    const selected = new File(['container'], 'too-large.json');
    Object.defineProperty(selected, 'size', { value: 51 * 1024 * 1024 });
    render(<DataPrivacy restore={restore} deleted={vi.fn()} onReadBackup={onReadBackup} />);
    fireEvent.change(screen.getByLabelText('Restore backup file'), {
      target: { files: [selected] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Backup file.*50 MB/);
    expect(onReadBackup).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('does not open restore after the component is disposed while credentials are pending', async () => {
    let finish!: (value: WorkspaceBackup) => void;
    const pending = new Promise<WorkspaceBackup>((resolve) => {
      finish = resolve;
    });
    const restore = vi.fn();
    const onReadBackup = vi.fn(() => pending);
    const { unmount } = render(
      <DataPrivacy restore={restore} deleted={vi.fn()} onReadBackup={onReadBackup} />,
    );
    fireEvent.change(screen.getByLabelText('Restore backup file'), {
      target: { files: [new File(['container'], 'backup.json')] },
    });
    expect(onReadBackup).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled();
    unmount();
    await act(async () => {
      finish(backup());
      await pending;
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it('reports rejected credentials without bypassing the reader or opening restore', async () => {
    const restore = vi.fn();
    const onReadBackup = vi.fn(async () => {
      throw new Error('The original backup password is required.');
    });
    render(<DataPrivacy restore={restore} deleted={vi.fn()} onReadBackup={onReadBackup} />);
    fireEvent.change(screen.getByLabelText('Restore backup file'), {
      target: { files: [new File(['container'], 'backup.json')] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The original backup password is required.',
    );
    expect(restore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
  });

  it('preserves the separate app-cache cleanup without deleting workspace data', async () => {
    const deleted = vi.fn();
    render(<DataPrivacy restore={vi.fn()} deleted={deleted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear app cache' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'App cache cleared. Your diagrams and settings are preserved.',
    );
    expect(presentation.close).toHaveBeenCalledOnce();
    expect(disposeVideoExport).toHaveBeenCalledOnce();
    expect(speechService.dispose).toHaveBeenCalledOnce();
    expect(clearAppCache).toHaveBeenCalledOnce();
    expect(deleted).not.toHaveBeenCalled();
  });

  it('waits for private video disposal before clearing app cache without deleting workspace data', async () => {
    let finish!: () => void;
    vi.mocked(disposeVideoExport).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const deleted = vi.fn();
    render(<DataPrivacy restore={vi.fn()} deleted={deleted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear app cache' }));
    expect(disposeVideoExport).toHaveBeenCalledOnce();
    expect(presentation.close).toHaveBeenCalledOnce();
    expect(speechService.dispose).toHaveBeenCalledOnce();
    expect(clearAppCache).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      finish();
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'App cache cleared. Your diagrams and settings are preserved.',
    );
    expect(clearAppCache).toHaveBeenCalledOnce();
    expect(deleted).not.toHaveBeenCalled();
  });

  it('waits for encrypted narration spill cleanup before clearing app cache', async () => {
    let finish!: () => void;
    vi.mocked(presentation.settled).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<DataPrivacy restore={vi.fn()} deleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear app cache' }));
    expect(presentation.close).toHaveBeenCalledOnce();
    expect(presentation.settled).toHaveBeenCalledOnce();
    expect(clearAppCache).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    await waitFor(() => expect(clearAppCache).toHaveBeenCalledOnce());
  });
});
