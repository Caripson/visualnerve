import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyticsService } from '../service';
import type {
  AnalyticsExtension,
  AnalyticsResultContent,
  AnalysisJobRequest,
  AnalysisJobValue,
} from '../types';
import { errorMessage, isCancelled } from './display';
import type { AnalyticsWorkspaceProps } from './types';

/** One disposable worker owns each screen's jobs, including sensitive snapshots. */
export class WorkspaceAnalysisSession {
  private readonly jobs = new Set<AbortController>();
  private readonly lifetime = new AbortController();
  private disposed = false;

  async run(
    request: AnalysisJobRequest,
    progress: (completed: number, total: number) => void,
  ): Promise<AnalysisJobValue> {
    if (this.disposed) throw new DOMException('Workspace locked.', 'AbortError');
    const controller = new AbortController();
    this.jobs.add(controller);
    try {
      const result = await analyticsService.run(request, { signal: controller.signal, progress });
      if (this.disposed || controller.signal.aborted)
        throw new DOMException('Analysis cancelled.', 'AbortError');
      return result;
    } finally {
      this.jobs.delete(controller);
    }
  }

  cancel(): void {
    for (const controller of this.jobs) controller.abort();
    this.jobs.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.cancel();
  }

  get signal(): AbortSignal {
    return this.lifetime.signal;
  }
}

export function useAnalysis(props: AnalyticsWorkspaceProps) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current = useRef(props);
  current.current = props;
  const session = useRef<WorkspaceAnalysisSession | null>(null);
  const serial = useRef(0);
  const originating = useMemo(
    () => new WorkspaceAnalysisSession(),
    [props.diagramId, props.securityEpoch, props.disabled],
  );

  useEffect(() => {
    const active = originating;
    session.current = active;
    return () => {
      serial.current++;
      active.cancel();
      if (session.current === active) session.current = null;
      // React's development effect replay immediately reattaches the same screen.
      // The publication fence closes synchronously; only final disposal waits a microtask.
      queueMicrotask(() => {
        if (session.current !== active) active.dispose();
      });
    };
  }, [originating]);

  const run = useCallback(
    async (request: AnalysisJobRequest) => {
      if (session.current !== originating || originating.signal.aborted || current.current.disabled)
        throw new DOMException('Workspace access is unavailable.', 'AbortError');
      const active = originating;
      const revision = ++serial.current;
      setBusy(true);
      setProgress(0);
      setError('');
      try {
        const value = await active.run(request, (completed, total) => {
          if (revision === serial.current) setProgress(total ? completed / total : 0);
        });
        if (active !== session.current || current.current.disabled)
          throw new DOMException('Workspace access changed.', 'AbortError');
        return value;
      } catch (error) {
        if (!isCancelled(error)) setError(errorMessage(error));
        throw error;
      } finally {
        if (revision === serial.current) setBusy(false);
      }
    },
    [originating],
  );

  const save = async (next: AnalyticsExtension) => {
    if (session.current !== originating || originating.signal.aborted || current.current.disabled)
      throw new DOMException('Workspace access changed.', 'AbortError');
    const original = props.analytics;
    const version = props.version;
    if (current.current.analytics !== original || current.current.version !== version)
      throw new Error('The document changed. Review the latest configuration and try again.');
    setSaving(true);
    try {
      await current.current.onChange(next, version);
      if (session.current === originating && !originating.signal.aborted)
        setNotice('Saved in your encrypted workspace.');
    } finally {
      if (session.current === originating) setSaving(false);
    }
  };

  return {
    run,
    save,
    busy: busy || saving,
    analyzing: busy,
    saving,
    progress,
    error,
    notice,
    setError,
    setNotice,
    cancel: () => {
      serial.current++;
      session.current?.cancel();
      setBusy(false);
      setNotice('Analysis cancelled. Nothing was saved.');
    },
    signal: originating.signal,
    archive: async (
      content: AnalyticsResultContent,
      parameters: Record<string, unknown>,
      model = props.analytics,
    ) => {
      if (session.current !== originating || originating.signal.aborted || current.current.disabled)
        throw new DOMException('Workspace access changed.', 'AbortError');
      const original = props.analytics;
      const version = props.version;
      if (current.current.analytics !== original || current.current.version !== version)
        throw new Error('The document changed. Review the latest configuration and try again.');
      const result = await run({
        kind: 'archive',
        model,
        content,
        parameters,
        modelVersion: version,
      });
      if (current.current.analytics !== original || current.current.version !== version)
        throw new Error('The document changed. Review the latest configuration and try again.');
      if (!('schemaVersion' in result) || result.schemaVersion !== 1)
        throw new Error('Unexpected archive preparation result.');
      return result;
    },
  };
}
