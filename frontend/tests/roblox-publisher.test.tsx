import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridge, Bridge } from '../src/integration/bridge';
import { bridgeDiagnostics } from '../src/integration/diagnostics';
import type {
  RobloxPublishAction,
  RobloxPublishCapabilities,
  RobloxPublishReceipt,
  RobloxPublishSession,
} from '../src/integration/roblox-publish-types';
import { RobloxPublisher } from '../src/roblox/ui/RobloxPublisher';
import { createGameGraph } from '../src/roblox/document';
import { createRobloxStarterGame } from '../src/roblox/starter';
import { compileRobloxGame } from '../src/roblox/compiler';
import { useEditor } from '../src/state/editor';
import {
  recoverRobloxPreparation,
  type RobloxPreparationIdentity,
} from '../src/roblox/publish-recovery';

const capabilities: RobloxPublishCapabilities = {
  configured: true,
  terminalApprovalRequired: true,
  target: { universeId: '123', placeId: '456' },
  limits: {
    chunkBytes: 65536,
    artifactBytes: 10 * 1024 * 1024,
    pendingPerPeer: 1,
    retainedOwners: 64,
    pendingBytes: 32 * 1024 * 1024,
    preparationMs: 60000,
    approvalMs: 60000,
    networkMs: 60000,
  },
};
const currentInfo = {
  type: 'bridge-info',
  version: '0.11.0',
  tools: ['visual_nerve_request', 'visual_nerve_api_docs'],
  capabilities: [
    'operations-v1',
    'endpoint-docs-v1',
    'fork-join-v1',
    'async-svg-export-v1',
    'exchange-export-v1',
    'analytics-v1',
    'ibm-flowcharting-v1',
    'standard-notations-v1',
    'infrastructure-resources-v1',
    'roblox-game-builder-v1',
  ],
};
const instances: Bridge[] = [];
beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({
    status: 'saved',
    mcpAccess: 'write',
    bridgeStatus: 'connected',
    workspaceId: crypto.randomUUID(),
    bridgeUrl: 'ws://127.0.0.1:4317/bridge',
  });
});
afterEach(() => {
  cleanup();
  for (const instance of instances.splice(0)) instance.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  bridgeDiagnostics.disconnect();
  useEditor.getState().setGraph(null);
  useEditor.setState({ mcpAccess: 'off', bridgeStatus: 'disabled' });
});
type MockRequest = (
  action: RobloxPublishAction,
  data: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;
function publisher(request?: MockRequest) {
  const graph = createGameGraph('My island', createRobloxStarterGame());
  graph.diagram.version = 1;
  useEditor.getState().setGraph(graph);
  useEditor.setState({ status: 'saved' });
  const controller = new AbortController();
  const call = vi.fn(
    request ??
      (async (action) => {
        if (action === 'capabilities') return capabilities;
        throw Object.assign(new Error('No receipt'), { status: 404 });
      }),
  );
  const session: RobloxPublishSession = {
    signal: controller.signal,
    assertCurrent: () => controller.signal.throwIfAborted(),
    request: call as RobloxPublishSession['request'],
  };
  vi.spyOn(bridge, 'captureRobloxPublisher').mockReturnValue(session);
  const game = graph.diagram.game!,
    build = compileRobloxGame(game),
    result = render(<RobloxPublisher game={game} build={build} />);
  return { ...result, graph, game, build, call, controller };
}

describe('human Roblox publication boundary', () => {
  it.each([
    { ...capabilities, terminalApprovalRequired: undefined },
    { ...capabilities, limits: { ...capabilities.limits, approvalMs: 0 } },
  ])(
    'refuses a configured broker that lacks the current terminal approval contract',
    async (legacy) => {
      const f = publisher(async () => legacy);
      expect(await screen.findByRole('alert')).toHaveTextContent('separate terminal approval');
      expect(screen.queryByText('Universe ID')).not.toBeInTheDocument();
      expect(f.call.mock.calls.map((args) => args[0])).toEqual(['capabilities']);
    },
  );
  it('refuses a synthetic click even after the destination and Studio-test reminder are completed', async () => {
    const f = publisher();
    await screen.findByText('Universe ID');
    fireEvent.click(screen.getByRole('checkbox', { name: /I have opened this build in Studio/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Type Universe ID/ }), {
      target: { value: '123/456' },
    });
    const upload = screen.getByRole('button', { name: 'Upload this version' });
    await waitFor(() => expect(upload).toBeEnabled());
    fireEvent.click(upload);
    expect(screen.getByRole('alert')).toHaveTextContent('Use the Upload button yourself');
    expect(f.call.mock.calls.map((args) => args[0])).toEqual(['capabilities', 'status']);
    expect(f.call).not.toHaveBeenCalledWith('begin', expect.anything(), expect.anything());
  });
  it('requires the current saved version and resets review state when game semantics change', async () => {
    const f = publisher();
    await screen.findByText('Universe ID');
    fireEvent.click(screen.getByRole('checkbox', { name: /I have opened this build in Studio/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Type Universe ID/ }), {
      target: { value: '123/456' },
    });
    act(() => useEditor.setState({ status: 'saving' }));
    expect(screen.getByRole('button', { name: 'Upload this version' })).toBeDisabled();
    const changed = { ...f.game, description: 'A new version must be tested' };
    f.rerender(<RobloxPublisher game={changed} build={compileRobloxGame(changed)} />);
    expect(
      screen.getByRole('checkbox', { name: /I have opened this build in Studio/ }),
    ).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /Type Universe ID/ })).toHaveValue('');
    expect(
      f.call.mock.calls.every((args) => args[0] === 'capabilities' || args[0] === 'status'),
    ).toBe(true);
  });
  it('aborts the capability lease and ignores its late reply when write access is revoked', async () => {
    let finish!: (value: unknown) => void, capturedSignal: AbortSignal | undefined;
    const f = publisher((action, _data, signal) => {
      expect(action).toBe('capabilities');
      capturedSignal = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    act(() => useEditor.setState({ mcpAccess: 'off' }));
    expect(capturedSignal!.aborted).toBe(true);
    await act(async () => {
      finish(capabilities);
      await Promise.resolve();
    });
    expect(screen.queryByText('Universe ID')).not.toBeInTheDocument();
    expect(screen.getByText(/To enable direct upload/)).toBeVisible();
    expect(f.call).toHaveBeenCalledOnce();
  });
  it('drops late metadata and makes no receipt follow-up after the publisher is unmounted', async () => {
    let finish!: (value: unknown) => void;
    const f = publisher(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.unmount();
    await act(async () => {
      finish(capabilities);
      await Promise.resolve();
    });
    expect(f.call).toHaveBeenCalledOnce();
  });
  it('does not acknowledge an unknown outcome through a synthetic click', async () => {
    const f = publisher(async (action) => {
      if (action === 'capabilities') return capabilities;
      if (action === 'status')
        return {
          nonce: 'previous-unknown',
          state: 'unknown',
          target: capabilities.target,
          sha256: 'a'.repeat(64),
          totalBytes: 100,
          receivedBytes: 100,
          nextIndex: 1,
          expiresAt: new Date().toISOString(),
          requiresDashboardReconciliation: true,
        };
      throw new Error('Synthetic input must not reach the broker');
    });
    const review = await screen.findByRole('checkbox', { name: /I checked version history/ });
    fireEvent.click(review);
    const acknowledge = screen.getByRole('button', { name: 'Acknowledge reviewed outcome' });
    expect(acknowledge).toBeEnabled();
    fireEvent.click(acknowledge);
    expect(f.call.mock.calls.map((args) => args[0])).toEqual(['capabilities', 'status']);
    expect(screen.getByText(/Publication: unknown/)).toBeVisible();
  });
});

class TestSocket {
  static OPEN = 1;
  static all: TestSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(_url: string | URL) {
    TestSocket.all.push(this);
  }
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
async function connectedBridge() {
  TestSocket.all = [];
  vi.stubGlobal('WebSocket', TestSocket);
  const instance = new Bridge();
  instances.push(instance);
  instance.start();
  await waitFor(() => expect(TestSocket.all).toHaveLength(1));
  const socket = TestSocket.all[0];
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify(currentInfo) });
  expect(bridgeDiagnostics.snapshot().state).toBe('current');
  return { instance, socket };
}
describe('publisher bridge lease isolation', () => {
  it('revokes an in-flight status request on a fresh access choice and ignores the old correlated response', async () => {
    const { instance, socket } = await connectedBridge();
    const session = instance.captureRobloxPublisher();
    const pending = session.request('status', {}),
      denied = expect(pending).rejects.toMatchObject({ status: 409 });
    const request = JSON.parse(socket.sent.at(-1)!);
    instance.beginAccessChoice();
    expect(session.signal.aborted).toBe(true);
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'roblox-publish-result',
        requestId: request.requestId,
        status: 200,
        body: { privateLateReceipt: 'must not return' },
      }),
    });
    await denied;
    expect(() => session.assertCurrent()).toThrow();
    expect(() => instance.captureRobloxPublisher()).not.toThrow();
  });
  it('keeps a control-only locked connection from capturing fresh publication authority', async () => {
    const { instance } = await connectedBridge();
    const old = instance.captureRobloxPublisher();
    instance.restrictToControl();
    expect(old.signal.aborted).toBe(true);
    expect(() => instance.captureRobloxPublisher()).toThrow(/Publishing requires/);
    useEditor.setState({ mcpAccess: 'off' });
    expect(() => old.assertCurrent()).toThrow();
  });
});

const preparation: RobloxPreparationIdentity = {
  sha256: 'a'.repeat(64),
  totalBytes: 128,
  target: { universeId: '123', placeId: '456' },
};
function preparationReceipt(changes: Partial<RobloxPublishReceipt> = {}): RobloxPublishReceipt {
  return {
    nonce: 'prepared-upload',
    state: 'receiving',
    target: preparation.target,
    sha256: preparation.sha256,
    totalBytes: preparation.totalBytes,
    receivedBytes: 0,
    nextIndex: 0,
    expiresAt: new Date().toISOString(),
    requiresDashboardReconciliation: false,
    ...changes,
  };
}
function publicationFrames(socket: TestSocket) {
  return socket.sent
    .map((frame) => JSON.parse(frame))
    .filter((frame) => frame.type === 'roblox-publish');
}
function publicationReply(socket: TestSocket, requestId: string, receipt: RobloxPublishReceipt) {
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'roblox-publish-result',
      requestId,
      status: 200,
      body: receipt,
    }),
  });
}
describe('interrupted Roblox preparation recovery', () => {
  it('recovers and cancels an accepted begin after its local aborted correlation discards the late response', async () => {
    const { instance, socket } = await connectedBridge();
    const session = instance.captureRobloxPublisher();
    const local = new AbortController();
    const begin = session.request<RobloxPublishReceipt>(
      'begin',
      {
        diagramId: crypto.randomUUID(),
        baseVersion: 1,
        artifactName: 'game.rbxlx',
        sha256: preparation.sha256,
        totalBytes: preparation.totalBytes,
        universeId: preparation.target.universeId,
        placeId: preparation.target.placeId,
      },
      local.signal,
    );
    const denied = expect(begin).rejects.toMatchObject({ status: 409 });
    const beginning = publicationFrames(socket).at(-1)!;
    local.abort();
    await denied;
    expect(session.signal.aborted).toBe(false);
    const receiving = preparationReceipt();
    publicationReply(socket, beginning.requestId, receiving);

    const recovery = recoverRobloxPreparation(session, preparation, true);
    const status = publicationFrames(socket).at(-1)!;
    expect(status.action).toBe('status');
    expect(status.data).toEqual({});
    publicationReply(socket, status.requestId, receiving);
    await waitFor(() => expect(publicationFrames(socket).at(-1)!.action).toBe('cancel'));
    const cancel = publicationFrames(socket).at(-1)!;
    expect(cancel.data).toEqual({ nonce: receiving.nonce });
    expect(cancel.accessGrantId).toBe(beginning.accessGrantId);
    expect(cancel.browserInstanceId).toBe(beginning.browserInstanceId);
    const cancelled = preparationReceipt({ state: 'cancelled' });
    publicationReply(socket, cancel.requestId, cancelled);
    await expect(recovery).resolves.toEqual(cancelled);
    expect(publicationFrames(socket).map((frame) => frame.action)).toEqual([
      'begin',
      'status',
      'cancel',
    ]);
  });

  it('does not expose a recovered receipt or cancel it after the original grant is revoked', async () => {
    const { instance, socket } = await connectedBridge();
    const session = instance.captureRobloxPublisher();
    const recovery = recoverRobloxPreparation(session, preparation, true);
    const denied = expect(recovery).rejects.toMatchObject({ status: 409 });
    const status = publicationFrames(socket).at(-1)!;
    instance.beginAccessChoice();
    publicationReply(socket, status.requestId, preparationReceipt());
    await denied;
    expect(session.signal.aborted).toBe(true);
    expect(publicationFrames(socket).map((frame) => frame.action)).toEqual(['status']);
  });

  it.each([
    { sha256: 'b'.repeat(64) },
    { totalBytes: preparation.totalBytes + 1 },
    { target: { universeId: '124', placeId: '456' } },
    { target: { universeId: '123', placeId: '457' } },
  ])('does not expose or cancel an unrelated previous receipt: %j', async (changes) => {
    const { instance, socket } = await connectedBridge();
    const recovery = recoverRobloxPreparation(instance.captureRobloxPublisher(), preparation, true);
    const status = publicationFrames(socket).at(-1)!;
    publicationReply(socket, status.requestId, preparationReceipt(changes));
    await expect(recovery).resolves.toBeUndefined();
    expect(publicationFrames(socket).map((frame) => frame.action)).toEqual(['status']);
  });

  it('uses the known nonce and refuses a receipt for a different preparation with matching bytes', async () => {
    const { instance, socket } = await connectedBridge();
    const expected = { ...preparation, nonce: 'original-preparation' };
    const recovery = recoverRobloxPreparation(instance.captureRobloxPublisher(), expected, true);
    const status = publicationFrames(socket).at(-1)!;
    expect(status.data).toEqual({ nonce: expected.nonce });
    publicationReply(socket, status.requestId, preparationReceipt());
    await expect(recovery).resolves.toBeUndefined();
    expect(publicationFrames(socket).map((frame) => frame.action)).toEqual(['status']);
  });

  it.each(['awaiting-approval', 'publishing'] as const)(
    'cancels a recovered %s receipt only through its original grant',
    async (state) => {
      const { instance, socket } = await connectedBridge();
      const recovery = recoverRobloxPreparation(
        instance.captureRobloxPublisher(),
        preparation,
        true,
      );
      const status = publicationFrames(socket).at(-1)!;
      const receiving = preparationReceipt({ state });
      publicationReply(socket, status.requestId, receiving);
      await waitFor(() => expect(publicationFrames(socket).at(-1)!.action).toBe('cancel'));
      const cancel = publicationFrames(socket).at(-1)!;
      expect(cancel.data).toEqual({ nonce: receiving.nonce });
      const cancelled = preparationReceipt({
        state: state === 'publishing' ? 'unknown' : 'cancelled',
        requiresDashboardReconciliation: state === 'publishing',
      });
      publicationReply(socket, cancel.requestId, cancelled);
      await expect(recovery).resolves.toEqual(cancelled);
      expect(publicationFrames(socket).map((frame) => frame.action)).toEqual(['status', 'cancel']);
    },
  );

  it.each([
    { cancelRequested: false, state: 'receiving' },
    { cancelRequested: true, state: 'succeeded' },
    { cancelRequested: true, state: 'failed' },
    { cancelRequested: true, state: 'cancelled' },
    { cancelRequested: true, state: 'unknown' },
  ] as const)(
    'returns the matching $state receipt without mutation when cancelRequested is $cancelRequested',
    async ({ cancelRequested, state }) => {
      const { instance, socket } = await connectedBridge();
      const recovery = recoverRobloxPreparation(
        instance.captureRobloxPublisher(),
        preparation,
        cancelRequested,
      );
      const status = publicationFrames(socket).at(-1)!;
      const receipt = preparationReceipt({
        state,
        requiresDashboardReconciliation: state === 'unknown',
      });
      publicationReply(socket, status.requestId, receipt);
      await expect(recovery).resolves.toEqual(receipt);
      expect(publicationFrames(socket).map((frame) => frame.action)).toEqual(['status']);
    },
  );
});
