import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../integration/bridge';
import type {
  RobloxPublishCapabilities,
  RobloxPublishReceipt,
  RobloxPublishSession,
} from '../../integration/roblox-publish-types';
import { workspace } from '../../storage/workspace';
import { Repository } from '../../storage/repository';
import { useEditor } from '../../state/editor';
import type { GameDefinition, RobloxBuild } from '../types';
import { gameBase64, gameDigest } from '../../storage/roblox-api-jobs';
import { recoverRobloxPreparation, type RobloxPreparationIdentity } from '../publish-recovery';

/** Only native UI clicks enter this broker. No repository/MCP publication command exists. */
export function RobloxPublisher({ game, build }: { game: GameDefinition; build: RobloxBuild }) {
  const access = useEditor((state) => state.mcpAccess),
    connection = useEditor((state) => state.bridgeStatus),
    saveState = useEditor((state) => state.status);
  const [capabilities, setCapabilities] = useState<RobloxPublishCapabilities>();
  const [fingerprint, setFingerprint] = useState('');
  const [receipt, setReceipt] = useState<RobloxPublishReceipt>();
  const [tested, setTested] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [targetConfirmation, setTargetConfirmation] = useState('');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState('');
  const mounted = useRef(true),
    active = useRef<
      | {
          controller: AbortController;
          session: RobloxPublishSession;
          nonce?: string;
          preparation?: RobloxPreparationIdentity;
        }
      | undefined
    >(undefined);
  const source = JSON.stringify(game);
  useEffect(() => {
    const controller = new AbortController();
    setFingerprint('');
    void gameDigest(new TextEncoder().encode(build.placeXml))
      .then((value) => {
        if (!controller.signal.aborted && mounted.current) setFingerprint(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [build.placeXml, source]);
  const cancel = () => {
    const pending = active.current;
    if (!pending) return;
    pending.controller.abort();
    if (pending.nonce)
      void pending.session.request('cancel', { nonce: pending.nonce }).catch(() => undefined);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, []);
  useEffect(() => {
    cancel();
    setTested(false);
    setReviewed(false);
    setTargetConfirmation('');
  }, [source]);
  useEffect(() => {
    const controller = new AbortController();
    setCapabilities(undefined);
    setReceipt(undefined);
    if (access === 'write' && connection === 'connected') {
      try {
        const session = bridge.captureRobloxPublisher();
        void session
          .request<RobloxPublishCapabilities>('capabilities', {}, controller.signal)
          .then(async (value) => {
            if (controller.signal.aborted || !mounted.current) return;
            if (
              value.configured &&
              (value.terminalApprovalRequired !== true ||
                value.limits.approvalMs !== 60000 ||
                value.limits.chunkBytes !== 65536 ||
                value.limits.artifactBytes !== 10485760)
            )
              throw new Error(
                'Update the local bridge. This publisher requires separate terminal approval and the current bounded upload protocol.',
              );
            setCapabilities(value);
            if (value.configured)
              try {
                const previous = await session.request<RobloxPublishReceipt>(
                  'status',
                  {},
                  controller.signal,
                );
                if (!controller.signal.aborted && mounted.current) setReceipt(previous);
              } catch (failure) {
                if (
                  (failure as { status?: number }).status !== 404 &&
                  !controller.signal.aborted &&
                  mounted.current
                )
                  setError((failure as Error).message);
              }
          })
          .catch((failure) => {
            if (!controller.signal.aborted && mounted.current) setError((failure as Error).message);
          });
      } catch (failure) {
        setError((failure as Error).message);
      }
    }
    return () => controller.abort();
  }, [access, connection]);
  const target = capabilities?.target;
  const expectedTarget = target ? `${target.universeId}/${target.placeId}` : '';
  const upload = (trusted: boolean) => {
    if (!trusted) {
      setError('Use the Upload button yourself. API/MCP cannot approve publication.');
      return;
    }
    if (
      !tested ||
      !target ||
      !fingerprint ||
      targetConfirmation !== expectedTarget ||
      receipt?.requiresDashboardReconciliation ||
      busy
    )
      return;
    let session: RobloxPublishSession;
    try {
      session = bridge.captureRobloxPublisher();
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    const graph = useEditor.getState().graph;
    if (
      !graph ||
      useEditor.getState().status !== 'saved' ||
      JSON.stringify(graph.diagram.game) !== source
    ) {
      setError('Wait until this exact game version is saved before uploading.');
      return;
    }
    const captured = workspace.repo.db.captureOperation(); // Capture before the first asynchronous boundary.
    const controller = new AbortController();
    active.current = { controller, session };
    setBusy(true);
    setProgress(0);
    setError('');
    void (async () => {
      const operation = await captured;
      const signal = AbortSignal.any([operation.signal, session.signal, controller.signal]);
      const check = async () => {
        signal.throwIfAborted();
        session.assertCurrent();
        await operation.check();
        signal.throwIfAborted();
        const current = useEditor.getState().graph;
        if (
          !mounted.current ||
          current?.diagram.id !== graph.diagram.id ||
          current.diagram.version !== graph.diagram.version ||
          JSON.stringify(current.diagram.game) !== source
        )
          throw new Error(
            'The saved game changed. Check and build its latest version before uploading.',
          );
      };
      try {
        await check();
        const saved = await new Repository(operation.storage).getGraph(graph.diagram.id);
        await check();
        if (
          saved.diagram.version !== graph.diagram.version ||
          JSON.stringify(saved.diagram.game) !== source
        )
          throw new Error('This game has not finished saving. Wait for Saved, then try again.');
        const bytes = new TextEncoder().encode(build.placeXml);
        if (!capabilities || bytes.length > capabilities.limits.artifactBytes)
          throw new Error(
            'This place exceeds Roblox’s 10 MiB upload limit. Reduce the game or use Studio.',
          );
        const sha256 = await gameDigest(bytes);
        if (sha256 !== fingerprint)
          throw new Error(
            'The build fingerprint changed. Review the current files before uploading.',
          );
        await check();
        active.current!.preparation = {
          sha256,
          totalBytes: bytes.length,
          target,
        };
        let next = await session.request<RobloxPublishReceipt>(
          'begin',
          {
            diagramId: graph.diagram.id,
            baseVersion: graph.diagram.version,
            artifactName: 'game.rbxlx',
            sha256,
            totalBytes: bytes.length,
            universeId: target.universeId,
            placeId: target.placeId,
          },
          signal,
        );
        active.current!.nonce = next.nonce;
        await check();
        setReceipt(next);
        for (
          let offset = 0, index = 0;
          offset < bytes.length;
          offset += capabilities.limits.chunkBytes, index++
        ) {
          await check();
          const chunk = bytes.subarray(
            offset,
            Math.min(bytes.length, offset + capabilities.limits.chunkBytes),
          );
          next = await session.request<RobloxPublishReceipt>(
            'chunk',
            { nonce: next.nonce, index, offset, data: gameBase64(chunk) },
            signal,
          );
          await check();
          setReceipt(next);
          setProgress(Math.round((next.receivedBytes / bytes.length) * 100));
        }
        await check();
        // Exactly one dispatch: a timeout is an unknown outcome, never an automatic retry.
        next = await session.request<RobloxPublishReceipt>(
          'finalize',
          { nonce: next.nonce },
          signal,
        );
        await check();
        setReceipt(next);
      } finally {
        operation.dispose();
      }
    })()
      .catch(async (failure) => {
        if (mounted.current)
          setError(
            controller.signal.aborted
              ? 'Cancelled. If publication had begun, inspect Creator Dashboard version history before uploading again.'
              : (failure as Error).message,
          );
        const pending = active.current;
        if (pending?.preparation)
          try {
            const recovered = await recoverRobloxPreparation(
              session,
              { ...pending.preparation, nonce: pending.nonce },
              controller.signal.aborted,
            );
            if (
              recovered &&
              mounted.current &&
              source === JSON.stringify(useEditor.getState().graph?.diagram.game)
            )
              setReceipt(recovered);
          } catch {
            // A revoked original session cannot reveal a receipt or regain publication authority.
          }
      })
      .finally(() => {
        active.current = undefined;
        if (mounted.current) setBusy(false);
      });
  };
  const reconcile = (trusted: boolean) => {
    if (!trusted || !reviewed || !receipt?.requiresDashboardReconciliation) return;
    try {
      const session = bridge.captureRobloxPublisher();
      setBusy(true);
      void session
        .request<RobloxPublishReceipt>('acknowledge-unknown', { nonce: receipt.nonce })
        .then((value) => {
          if (mounted.current) {
            setReceipt(value);
            setReviewed(false);
          }
        })
        .catch((failure) => {
          if (mounted.current) setError((failure as Error).message);
        })
        .finally(() => {
          if (mounted.current) setBusy(false);
        });
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const cancelPrevious = () => {
    if (!receipt || busy) return;
    try {
      const session = bridge.captureRobloxPublisher();
      setBusy(true);
      void session
        .request<RobloxPublishReceipt>('cancel', { nonce: receipt.nonce })
        .then((value) => {
          if (mounted.current) setReceipt(value);
        })
        .catch((failure) => {
          if (mounted.current) setError((failure as Error).message);
        })
        .finally(() => {
          if (mounted.current) setBusy(false);
        });
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  return (
    <section className="roblox-card" aria-labelledby="roblox-publish-title">
      <h3 id="roblox-publish-title">Upload a place version</h3>
      <p>
        Studio is the easiest way to test and publish. This optional local bridge uploads to one
        preconfigured Roblox place. It does not make a private experience public. Each upload also
        needs a separate confirmation in the bridge’s local terminal.
      </p>
      {!target && (
        <p>
          To enable direct upload, configure the local bridge with your own restricted Open Cloud
          key, Universe ID and Place ID. Then explicitly choose Read + write in Settings. No Roblox
          credential belongs in this page, your diagram or a backup.{' '}
          <a href="/help/roblox-game-builder/#optional-direct-upload">Setup guide</a>
        </p>
      )}
      {target && (
        <>
          <dl>
            <dt>Universe ID</dt>
            <dd>{target.universeId}</dd>
            <dt>Place ID</dt>
            <dd>{target.placeId}</dd>
            <dt>Built file</dt>
            <dd>
              game.rbxlx · {new TextEncoder().encode(build.placeXml).length.toLocaleString()} bytes
            </dd>
          </dl>
          <p>
            Compare this build fingerprint and the destination with the fresh prompt in your local
            terminal. Approve only if both match.
          </p>
          <output
            aria-label="Build SHA-256 fingerprint"
            style={{ display: 'block', overflowWrap: 'anywhere' }}
          >
            {fingerprint || 'Checking the build fingerprint…'}
          </output>
          <p>
            This replaces the published place version with the generated world. Manual changes made
            only in Studio are not included in this direct upload; use the Studio importer to merge
            them first.
          </p>
          <label className="roblox-toggle">
            <input
              type="checkbox"
              checked={tested}
              onChange={(event) => setTested(event.target.checked)}
            />
            I have opened this build in Studio, tested it with two players, and checked the
            destination.
          </label>
          <label className="roblox-field">
            Type Universe ID / Place ID to confirm
            <input
              value={targetConfirmation}
              onChange={(event) => setTargetConfirmation(event.target.value)}
              placeholder={expectedTarget}
              autoComplete="off"
            />
          </label>
          <div className="roblox-actions">
            <button
              disabled={
                busy ||
                !tested ||
                !fingerprint ||
                targetConfirmation !== expectedTarget ||
                saveState !== 'saved' ||
                receipt?.requiresDashboardReconciliation
              }
              onClick={(event) => upload(event.nativeEvent.isTrusted)}
            >
              Upload this version
            </button>
            {busy && <button onClick={cancel}>Cancel upload</button>}
          </div>
          {busy && (
            <p role="status">
              {progress < 100
                ? `Preparing upload: ${progress}%`
                : 'Approve the fresh phrase in your local bridge terminal, then wait for Roblox to finish publishing…'}
            </p>
          )}
        </>
      )}
      {receipt && (
        <p role="status">
          {fingerprint && receipt.sha256 !== fingerprint ? 'Previous build: ' : ''}
          {receipt.state === 'succeeded'
            ? `Uploaded place version ${receipt.versionNumber}. Check it in Creator Dashboard before changing public availability.`
            : `Publication: ${receipt.state}. ${receipt.error?.message ?? ''}`}
        </p>
      )}
      {!busy &&
        receipt &&
        ['receiving', 'awaiting-approval', 'publishing'].includes(receipt.state) && (
          <button onClick={cancelPrevious}>Cancel previous upload</button>
        )}
      {receipt?.requiresDashboardReconciliation && (
        <div className="roblox-card">
          <p>
            The upload outcome is unknown. It may already be saved at Roblox. Check the place’s
            version history in{' '}
            <a
              href="https://create.roblox.com/dashboard/creations"
              target="_blank"
              rel="noopener noreferrer"
            >
              Creator Dashboard
            </a>{' '}
            before retrying.
          </p>
          <label className="roblox-toggle">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I checked version history and reconciled this upload.
          </label>
          <button
            disabled={!reviewed || busy}
            onClick={(event) => reconcile(event.nativeEvent.isTrusted)}
          >
            Acknowledge reviewed outcome
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
