import { loadProjectArchive } from './archive';
import { decodeProjectArchive } from './input';
import type { ProjectArchiveInput } from './types';

const context = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      bytes?: Uint8Array;
      name?: string;
      input?: ProjectArchiveInput;
      byteLimit?: number;
    }>,
  ) => void;
  postMessage: (value: unknown) => void;
};
context.onmessage = ({ data }) => {
  try {
    const bytes = data.bytes ?? decodeProjectArchive(data.input!, data.byteLimit);
    const name = data.name ?? data.input?.name?.trim() ?? 'Imported project';
    let lastStage: string | undefined;
    let lastProgress = 0;
    const result = loadProjectArchive(bytes, name, {
      byteLimit: data.byteLimit,
      onProgress: (progress) => {
        const now = performance.now();
        if (
          progress.stage !== lastStage ||
          progress.completed === progress.total ||
          now - lastProgress >= 40
        ) {
          lastStage = progress.stage;
          lastProgress = now;
          context.postMessage({ progress });
        }
      },
    });
    context.postMessage({ result });
  } catch (error) {
    context.postMessage({
      error: error instanceof Error ? error.message : 'Project archive could not be loaded.',
    });
  }
};
