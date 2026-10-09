export class AppUpdateBlockedError extends Error {
  constructor(readonly kind: 'finishTask' | 'waitForRun') {
    super(kind);
  }
}
