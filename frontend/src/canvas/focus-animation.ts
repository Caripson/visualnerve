import type { Viewport } from '@xyflow/react';

type ViewportAccess = {
  getViewport(): Viewport;
  setViewport(viewport: Viewport, options: { duration: number }): Promise<unknown>;
};
type FocusRun = {
  finish(completed: boolean): void;
  fail(error: unknown): void;
};

/** User input takes over the diagram surface, not fixed tools or native fields. */
export function isCanvasNavigationGesture(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('.react-flow__renderer') &&
    !target.closest(
      'button,a,input,textarea,select,[contenteditable="true"],[role="dialog"],' +
        '.react-flow__panel,.react-flow__controls,.react-flow__minimap,' +
        '.react-flow__node-toolbar,.drawing-surface',
    )
  );
}

/** Owns only automatic node focus; manual/presentation cameras remain independent. */
export class CanvasFocusAnimation {
  private generation = 0;
  private pending: FocusRun | undefined;

  constructor(private readonly viewport: ViewportAccess) {}

  start(animate: () => Promise<boolean>): {
    completion: Promise<boolean>;
    isCurrent(): boolean;
  } {
    this.cancel();
    const generation = this.generation;
    let run!: FocusRun;
    const completion = new Promise<boolean>((resolve, reject) => {
      run = { finish: resolve, fail: reject };
    });
    this.pending = run;
    try {
      // Begin synchronously so cancellation can interrupt the exact D3 transition.
      void animate().then(
        (completed) => {
          if (this.pending !== run) return;
          this.pending = undefined;
          run.finish(completed);
        },
        (error: unknown) => {
          if (this.pending !== run) return;
          this.pending = undefined;
          run.fail(error);
        },
      );
    } catch (error) {
      if (this.pending === run) this.pending = undefined;
      run.fail(error);
    }
    return { completion, isCurrent: () => generation === this.generation };
  }

  cancel(): void {
    this.generation++;
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    // The public zero-duration setter interrupts XYFlow's D3 transition at its
    // current transform. An interrupted transition may never resolve its promise;
    // settle our own completion and exclude any later camera publication.
    void this.viewport.setViewport(this.viewport.getViewport(), { duration: 0 }).catch(() => {});
    pending.finish(false);
  }
}
