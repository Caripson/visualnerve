import type { ElkNode } from 'elkjs/lib/elk-api';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';

export const LAYOUT_TIMEOUT_MS = 30000;

/** Layout remains off the UI thread; the browser never downloads ELK's Node fallback. */
export async function layoutWithElk(graph: ElkNode): Promise<ElkNode> {
  if (typeof Worker === 'undefined')
    throw new Error(
      'Automatic layout needs Web Workers. Use a current browser or arrange manually.',
    );
  const { default: ELK } = await import('elkjs/lib/elk-api.js');
  const worker = new Worker(workerUrl);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectWorker: (error: Error) => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    rejectWorker = reject;
  });
  const failure = () =>
    rejectWorker(new Error('Automatic layout could not load its local worker.'));
  worker.addEventListener('error', failure);
  worker.addEventListener('messageerror', failure);
  try {
    // This editor uses layered layout only; don't register unused algorithms.
    const elk = new ELK({ algorithms: ['layered'], workerFactory: () => worker });
    timer = setTimeout(
      () => rejectWorker(new Error('Automatic layout timed out. Arrange the diagram manually.')),
      LAYOUT_TIMEOUT_MS,
    );
    return await Promise.race([elk.layout(graph), failed]);
  } finally {
    clearTimeout(timer);
    worker.removeEventListener('error', failure);
    worker.removeEventListener('messageerror', failure);
    worker.terminate();
  }
}
