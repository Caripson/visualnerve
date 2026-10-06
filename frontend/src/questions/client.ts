import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { questionGraph } from './evidence';
import { answerDiagramQuestion } from './answer';
import { normalizeQuestion, questionLimits, type DiagramQuestionResult } from './types';

/** Send only bounded relationship evidence to the worker, never source rows. */
export async function askDiagram(graph: Graph, question: unknown): Promise<DiagramQuestionResult> {
  const normalized = normalizeQuestion(question);
  if (graph.nodes.length > questionLimits.nodes || graph.edges.length > questionLimits.edges)
    throw new StorageError(
      422,
      'Question analysis supports at most 50,000 objects and 200,000 relationships.',
    );
  const input = questionGraph(graph);
  if (typeof Worker === 'undefined') return answerDiagramQuestion(input, normalized);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new StorageError(504, 'Question analysis timed out. Reduce its scope.'));
    }, 15000);
    worker.onmessage = (event) => {
      finish();
      if (event.data.error)
        reject(
          new StorageError(
            Number.isInteger(event.data.status) &&
              event.data.status >= 400 &&
              event.data.status <= 599
              ? event.data.status
              : 500,
            event.data.error,
          ),
        );
      else resolve(event.data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Question analysis could not finish.'));
    };
    try {
      worker.postMessage({ graph: input, question: normalized });
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
