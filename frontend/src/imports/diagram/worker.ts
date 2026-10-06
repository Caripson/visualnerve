import { parseDiagramBytes } from './parser';
import type { DiagramFileFormat } from './types';
const context = self as unknown as {
  onmessage: (
    event: MessageEvent<{ format: DiagramFileFormat; bytes: Uint8Array; name: string }>,
  ) => void;
  postMessage: (value: unknown) => void;
};
context.onmessage = ({ data }) => {
  try {
    context.postMessage({ result: parseDiagramBytes(data.format, data.bytes, data.name) });
  } catch (error) {
    context.postMessage({ error: (error as Error).message });
  }
};
