import { parseSql } from './parser';
import { arrangeSql } from './layout';

const context = self as unknown as {
  onmessage: (event: MessageEvent<{ text: string; name: string }>) => void;
  postMessage: (value: unknown) => void;
};
context.onmessage = async ({ data }) => {
  try {
    context.postMessage({ result: await arrangeSql(parseSql(data.text, data.name)) });
  } catch (error) {
    context.postMessage({ error: (error as Error).message });
  }
};
