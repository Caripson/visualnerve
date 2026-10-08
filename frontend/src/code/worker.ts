import { parseCode } from './analyzer';
import { arrangeCode } from './layout';
import type { CodeInput } from './types';
const context = self as unknown as {
  onmessage: (
    event: MessageEvent<{ input: CodeInput; byteLimit?: number; fileLimit?: number }>,
  ) => void;
  postMessage: (value: unknown) => void;
};
context.onmessage = async ({ data }) => {
  try {
    context.postMessage({
      result: await arrangeCode(parseCode(data.input, data.byteLimit, data.fileLimit)),
    });
  } catch (error) {
    context.postMessage({ error: (error as Error).message });
  }
};
