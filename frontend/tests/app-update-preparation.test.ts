import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareAppUpdate } from '../src/updates/prepare-update';
import { AppUpdateBlockedError } from '../src/updates/errors';

const mocks = vi.hoisted(() => ({
  status: 'unlocked',
  state: {
    mcpAccess: 'off',
    preferenceError: null as null | { message: string },
    finishEditing: vi.fn(),
  },
  capture: vi.fn(),
  check: vi.fn(),
  dispose: vi.fn(),
  camera: vi.fn(),
  settled: vi.fn(),
  retrySaves: vi.fn(),
  preference: vi.fn(),
  video: vi.fn(),
  simulations: vi.fn(),
}));
vi.mock('../src/state/editor', () => ({ useEditor: { getState: () => mocks.state } }));
vi.mock('../src/storage/runtime', () => ({
  vaultSession: { getSnapshot: () => ({ status: mocks.status }) },
}));
vi.mock('../src/storage/workspace', () => ({
  flushSpatialCamera: mocks.camera,
  workspace: {
    repo: { db: { captureOperation: mocks.capture } },
    settled: mocks.settled,
    retryFailedSaves: mocks.retrySaves,
    setPreference: mocks.preference,
  },
}));
vi.mock('../src/presentation/commands', () => ({ isVideoExporting: mocks.video }));
vi.mock('../src/simulation/service', () => ({
  simulationService: { settleBeforeAppUpdate: mocks.simulations },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = 'unlocked';
  mocks.state.mcpAccess = 'off';
  mocks.state.preferenceError = null;
  mocks.check.mockImplementation(async () => {
    if (mocks.status !== 'unlocked') throw new Error('Workspace locked.');
  });
  mocks.capture.mockImplementation(async () => ({
    check: mocks.check,
    dispose: mocks.dispose,
    signal: new AbortController().signal,
  }));
  mocks.settled.mockResolvedValue(undefined);
  mocks.retrySaves.mockResolvedValue(undefined);
  mocks.preference.mockResolvedValue(undefined);
  mocks.video.mockReturnValue(false);
  mocks.simulations.mockResolvedValue(undefined);
});
afterEach(() => document.body.replaceChildren());

it('a locked tab can update without opening or authorizing private storage', async () => {
  mocks.status = 'locked';
  await prepareAppUpdate();
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.simulations).not.toHaveBeenCalled();
  expect(mocks.preference).not.toHaveBeenCalled();
});

it.each(['unlocking', 'uninitialized'])('does not interrupt %s authentication', async (status) => {
  mocks.status = status;
  await expect(prepareAppUpdate()).rejects.toMatchObject({ kind: 'finishTask' });
  expect(mocks.capture).not.toHaveBeenCalled();
});

it.each(['dialog', 'import'])('keeps unfinished %s input open', async (kind) => {
  const element = document.createElement('div');
  if (kind === 'dialog') {
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
  } else element.className = 'csv-import-progress';
  document.body.append(element);
  await expect(prepareAppUpdate()).rejects.toMatchObject({ kind: 'finishTask' });
  expect(mocks.capture).not.toHaveBeenCalled();
});

it('the update progress dialog does not block its own saved-work preflight', async () => {
  const element = document.createElement('div');
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('data-app-update-dialog', '');
  document.body.append(element);
  await prepareAppUpdate();
  expect(mocks.settled).toHaveBeenCalledTimes(2);
});

it('does not interrupt an active encoder or unarchived simulation', async () => {
  mocks.video.mockReturnValue(true);
  await expect(prepareAppUpdate()).rejects.toMatchObject({ kind: 'finishTask' });
  expect(mocks.capture).not.toHaveBeenCalled();
  mocks.video.mockReturnValue(false);
  mocks.simulations.mockRejectedValue(new AppUpdateBlockedError('waitForRun'));
  await expect(prepareAppUpdate()).rejects.toMatchObject({ kind: 'waitForRun' });
  expect(mocks.capture).not.toHaveBeenCalled();
});

it('finishes text and camera edits, saves them, lowers agent access, and checks savings again', async () => {
  mocks.state.mcpAccess = 'write';
  await prepareAppUpdate();
  expect(mocks.state.finishEditing).toHaveBeenCalledTimes(2);
  expect(mocks.camera).toHaveBeenCalledTimes(2);
  expect(mocks.settled).toHaveBeenCalledTimes(2);
  expect(mocks.preference).toHaveBeenCalledWith('mcp-access', 'off');
  expect(mocks.settled.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.preference.mock.invocationCallOrder[0],
  );
  expect(mocks.preference.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.settled.mock.invocationCallOrder[1],
  );
  expect(mocks.dispose).toHaveBeenCalledTimes(2);
});

it('a diagram or preference save failure cannot pass preflight', async () => {
  mocks.state.mcpAccess = 'write';
  mocks.settled.mockRejectedValueOnce(new Error('Local storage is full.'));
  await expect(prepareAppUpdate()).rejects.toThrow('Local storage is full.');
  expect(mocks.preference).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
  mocks.state.preferenceError = { message: 'Theme could not be saved.' };
  await expect(prepareAppUpdate()).rejects.toThrow('Theme could not be saved.');
});

it('a lock arriving while edits save revokes the originating update operation', async () => {
  mocks.state.mcpAccess = 'write';
  mocks.settled.mockImplementationOnce(async () => {
    mocks.status = 'locked';
  });
  await expect(prepareAppUpdate()).rejects.toThrow('Workspace locked.');
  expect(mocks.preference).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
