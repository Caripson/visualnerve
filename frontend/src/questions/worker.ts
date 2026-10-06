import { answerDiagramQuestion } from './answer';
import { StorageError } from '../model/errors';
import type { QuestionGraph } from './evidence';
self.onmessage = (event: MessageEvent<{ graph: QuestionGraph; question: unknown }>) => {
  try {
    self.postMessage({ result: answerDiagramQuestion(event.data.graph, event.data.question) });
  } catch (error) {
    self.postMessage({
      error: (error as Error).message,
      status: error instanceof StorageError ? error.status : 500,
    });
  }
};
