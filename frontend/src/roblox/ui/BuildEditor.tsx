import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { robloxBuildService } from '../build-service';
import { validateGameDefinition } from '../validate';
import type { GameDefinition, RobloxBuild } from '../types';
import { download, safeName } from '../../export/semantic';
import type { ExportGuard } from '../../export/guard';
import { waitForExport } from '../../export/guard';
import { workspace } from '../../storage/workspace';
import { useEditor } from '../../state/editor';

export function BuildEditor({
  game,
  navigate,
  publishing,
}: {
  game: GameDefinition;
  navigate: (tab: 'world' | 'rules' | 'progress' | 'prefabs') => void;
  publishing?: (build: RobloxBuild) => ReactNode;
}) {
  const validation = useMemo(() => validateGameDefinition(game, { playable: true }), [game]);
  const [build, setBuild] = useState<{ source: string; result: RobloxBuild }>();
  const [artifact, setArtifact] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [progress, setProgress] = useState(0);
  const mounted = useRef(true);
  const active = useRef<AbortController | undefined>(undefined);
  const source = JSON.stringify(game);
  const diagramId = useEditor.getState().graph?.diagram.id;
  const result = build?.source === source ? build.result : undefined;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    active.current?.abort();
    setBuild(undefined);
    setArtifact('');
    setTested(false);
  }, [source]);
  const perform = async (action: (guard: ExportGuard, signal: AbortSignal) => Promise<void>) => {
    // Capture the originating workspace before the first asynchronous boundary.
    const captured = workspace.repo.db.captureOperation();
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setBusy(true);
    setError('');
    const operation = await captured.catch((failure) => {
      if (mounted.current && active.current === controller) {
        setError((failure as Error).message);
        setBusy(false);
      }
      return undefined;
    });
    if (!operation) return;
    const signal = AbortSignal.any([controller.signal, operation.signal]);
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (
        !mounted.current ||
        useEditor.getState().graph?.diagram.id !== diagramId ||
        JSON.stringify(useEditor.getState().graph?.diagram.game) !== source
      )
        throw new DOMException(
          'The game or workspace changed. Build this version again.',
          'AbortError',
        );
    };
    const guard: ExportGuard = {
      signal,
      assertCurrent,
      check: async () => {
        assertCurrent();
        await operation.check();
        assertCurrent();
      },
    };
    try {
      await guard.check();
      await action(guard, signal);
      await guard.check();
    } catch (failure) {
      if (mounted.current)
        setError(
          (failure as Error).name === 'AbortError' || signal.aborted
            ? 'The action was cancelled. Build again when you are ready.'
            : (failure as Error).message,
        );
    } finally {
      operation.dispose();
      if (active.current === controller) {
        active.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const compile = () =>
    void perform(async (guard, signal) => {
      const next = await robloxBuildService.build(game, {
        guard,
        signal,
        progress: (value) => {
          if (mounted.current && !signal.aborted) setProgress(value);
        },
      });
      await guard.check();
      guard.assertCurrent();
      setBuild({ source, result: next });
      setArtifact(next.artifacts[0]?.name ?? '');
      setTested(false);
    });
  const deliver = (name: string, content: string, mimeType: string) =>
    void perform(async (guard) => {
      await guard.check();
      guard.assertCurrent();
      download(name, content, mimeType);
    });
  const zip = () => {
    if (!result) return;
    void perform(async (guard) => {
      const { zip, strToU8 } = await import('fflate');
      await guard.check();
      const files = Object.fromEntries(
        result.artifacts.map((file) => [file.name, strToU8(file.content)]),
      );
      const bytes = await waitForExport(
        new Promise<Uint8Array>((resolve, reject) => {
          const cancel = zip(files, { level: 6 }, (failure, value) => {
            guard.signal.removeEventListener('abort', cancel);
            if (failure) reject(failure);
            else resolve(value);
          });
          guard.signal.addEventListener('abort', cancel, { once: true });
          if (guard.signal.aborted) cancel();
        }),
        guard,
      );
      await guard.check();
      guard.assertCurrent();
      download(
        `${safeName(game.name)}-roblox.zip`,
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }),
      );
    });
  };
  const inspected = result?.artifacts.find((file) => file.name === artifact);
  return (
    <section aria-label="Check and build your Roblox game">
      <h3>From your plan to a playable game</h3>
      <p className="roblox-hint">
        Check your game, download it, then play it in Roblox Studio. Studio is where you test
        jumping, moving platforms, and multiplayer.
      </p>
      <div className="roblox-card">
        <h4>1. Check the plan</h4>
        <p role="status">
          {validation.valid
            ? 'Your game is ready to build.'
            : `${validation.diagnostics.filter((item) => item.severity === 'error').length} things need fixing before you build.`}
        </p>
        {validation.diagnostics.length > 0 && (
          <ul className="roblox-diagnostics">
            {validation.diagnostics.map((item, index) => (
              <li key={`${item.path}-${index}`} data-severity={item.severity}>
                <strong>{item.severity === 'error' ? 'Fix' : 'Tip'}:</strong> {item.message}
                <small>{item.path}</small>
                <button
                  onClick={() =>
                    navigate(
                      item.path.includes('rules')
                        ? 'rules'
                        : item.path.includes('prefab') || item.path.includes('instances')
                          ? 'prefabs'
                          : item.path.includes('entities') || item.path.includes('settings')
                            ? 'world'
                            : 'progress',
                    )
                  }
                >
                  Go to{' '}
                  {item.path.includes('rules')
                    ? 'rules'
                    : item.path.includes('prefab') || item.path.includes('instances')
                      ? 'prefabs'
                      : item.path.includes('entities') || item.path.includes('settings')
                        ? 'world'
                        : 'progress'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="primary" disabled={!validation.valid || busy} onClick={compile}>
          {busy ? 'Working on Roblox files…' : 'Build Roblox files'}
        </button>
        {busy && (
          <>
            <progress value={progress} max={100} aria-label="Roblox file build progress" />
            <button onClick={() => active.current?.abort()}>Cancel action</button>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      {result && (
        <>
          <div className="roblox-card">
            <h4>2. Review and download</h4>
            <p>
              {result.game.entities.length} world objects · {result.game.rules.length} server rules.
              The files below were generated from your current game plan.
            </p>
            <div className="roblox-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  deliver(`${safeName(game.name)}.rbxlx`, result.placeXml, 'application/xml')
                }
              >
                Download Studio place (.rbxlx)
              </button>
              <button disabled={busy} onClick={zip}>
                {busy ? 'Packing files…' : 'Download all files (.zip)'}
              </button>
            </div>
            <details>
              <summary>Inspect generated files</summary>
              <label className="roblox-field">
                <span>File to inspect</span>
                <select
                  aria-label="File to inspect"
                  value={artifact}
                  onChange={(event) => setArtifact(event.target.value)}
                >
                  {result.artifacts.map((file) => (
                    <option key={file.name} value={file.name}>
                      {file.name}
                    </option>
                  ))}
                </select>
              </label>
              {inspected && (
                <>
                  <p>{new TextEncoder().encode(inspected.content).length.toLocaleString()} bytes</p>
                  <pre className="roblox-source" tabIndex={0}>
                    {inspected.content.length > 200000
                      ? `${inspected.content.slice(0, 200000)}\n… Download this file to inspect the rest.`
                      : inspected.content}
                  </pre>
                  <button
                    disabled={busy}
                    onClick={() => deliver(inspected.name, inspected.content, inspected.mimeType)}
                  >
                    Download {inspected.name}
                  </button>
                </>
              )}
            </details>
          </div>
          <div className="roblox-card">
            <h4>3. Test in Roblox Studio</h4>
            <ol>
              <li>
                Open Roblox Studio. Choose <strong>File → Open from File</strong> and pick your
                .rbxlx download.
              </li>
              <li>
                Press <strong>Play</strong>. Try the start point, every checkpoint, and each rule.
              </li>
              <li>
                Use Studio’s multiplayer test with at least two players. Check that rewards and
                quests go to the right player.
              </li>
              <li>
                Stop the test. If something needs changing, come back here, edit it, and build
                again.
              </li>
            </ol>
            <label className="roblox-toggle">
              <input
                type="checkbox"
                checked={tested}
                onChange={(event) => setTested(event.target.checked)}
              />
              <span>I have tested this version in Studio</span>
            </label>
          </div>
          <div className="roblox-card">
            <h4>4. Send it to your Roblox test game</h4>
            <p>
              In Studio, use <strong>File → Publish As</strong> and choose your separate test game.
              Check the game and place names before confirming. Publishing a version and making it
              public are separate choices.
            </p>
            {!tested && (
              <p className="roblox-hint">
                Test this version before publishing it. Your check above is a reminder; it is not
                proof of a completed Studio test.
              </p>
            )}
            <details>
              <summary>Updating an existing Studio project safely</summary>
              <p>
                The download contains a generated world and scripts. Keep a backup of work you
                create in Studio. Use the included sync plugin to review generated-object changes
                before applying them. The plugin manages the builder’s generated folder; inspect its
                review before you sync.
              </p>
              {result.artifacts
                .filter((file) => file.name.includes('plugin'))
                .map((file) => (
                  <button
                    key={file.name}
                    disabled={busy}
                    onClick={() => deliver(file.name, file.content, file.mimeType)}
                  >
                    Download Studio sync plugin
                  </button>
                ))}
            </details>
            {publishing?.(result)}
            <a href="/help/roblox-game-builder/">Read the step-by-step Roblox guide</a>
          </div>
        </>
      )}
      {!result && (
        <p className="roblox-hint">
          After you change your plan, build a fresh version before downloading or publishing.
        </p>
      )}
    </section>
  );
}
