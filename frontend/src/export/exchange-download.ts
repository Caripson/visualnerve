import type { Graph } from '../model/types';
import type { ExchangeFormat, ExchangeJobStatus } from './exchange-types';
import { assertExportActive, checkExportActive, type ExportGuard } from './guard';
import { exchangeExportController } from './exchange-jobs';
import { download, safeName } from './semantic';

export async function exportExchangeSnapshot(
  snapshot: Graph,
  format: ExchangeFormat,
  scope: 'complete' | 'selected',
  selection: string[],
  guard: ExportGuard,
  onProgress?: (status: ExchangeJobStatus) => void,
) {
  await checkExportActive(guard);
  const job = exchangeExportController.startSnapshot(
    snapshot,
    format,
    {
      scope,
      ...(scope === 'selected' ? { nodeIds: selection } : {}),
    },
    { guard, dispose: () => undefined },
  );
  try {
    const result = await exchangeExportController.wait(job.jobId, onProgress);
    await checkExportActive(guard);
    assertExportActive(guard);
    const buffer = result.bytes.slice().buffer as ArrayBuffer;
    download(
      `${safeName(snapshot.diagram.name)}.${format}`,
      new Blob([buffer], { type: result.mimeType }),
    );
  } finally {
    await exchangeExportController.cancel(job.jobId).catch(() => undefined);
  }
}
