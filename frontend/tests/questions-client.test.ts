import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { StorageError } from '../src/model/errors';
import { askDiagram } from '../src/questions/client';
import { answerDiagramQuestion } from '../src/questions/answer';
import type { QuestionGraph } from '../src/questions/evidence';

afterEach(() => vi.unstubAllGlobals());

describe('Question worker boundary', () => {
  it('preserves validation errors from the worker and terminates it', async () => {
    const terminate = vi.fn();
    class AnalysisWorker {
      onmessage?: (event: { data: unknown }) => void;
      terminate = terminate;
      postMessage(input: { graph: QuestionGraph; question: unknown }) {
        try {
          this.onmessage?.({
            data: { result: answerDiagramQuestion(input.graph, input.question) },
          });
        } catch (error) {
          this.onmessage?.({
            data: { error: (error as Error).message, status: (error as StorageError).status },
          });
        }
      }
    }
    vi.stubGlobal('Worker', AnalysisWorker);
    const graph = blankGraph('Worker validation');
    graph.nodes.push(newNode(graph.diagram.id));
    await expect(
      askDiagram(graph, {
        startId: graph.nodes[0].id,
        kind: 'path',
        targetId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('rejects malformed input before starting a worker', async () => {
    const construct = vi.fn();
    vi.stubGlobal('Worker', construct);
    await expect(
      askDiagram(blankGraph('Invalid question'), { kind: 'execute' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(construct).not.toHaveBeenCalled();
  });

  it('sends only bounded relationship evidence, not custom metadata or source content', async () => {
    let sent: unknown;
    class AnalysisWorker {
      onmessage?: (event: { data: unknown }) => void;
      terminate() {}
      postMessage(input: { graph: QuestionGraph; question: unknown }) {
        sent = input;
        this.onmessage?.({ data: { result: answerDiagramQuestion(input.graph, input.question) } });
      }
    }
    vi.stubGlobal('Worker', AnalysisWorker);
    const graph = blankGraph('Bounded question');
    graph.nodes.push(
      newNode(graph.diagram.id, {
        metadata: { privateRows: ['PRIVATE_SOURCE_ROW'], rawScript: 'PRIVATE_SCRIPT' },
      }),
    );
    await askDiagram(graph, { startId: graph.nodes[0].id, kind: 'downstream' });
    expect(JSON.stringify(sent)).not.toContain('PRIVATE_SOURCE_ROW');
    expect(JSON.stringify(sent)).not.toContain('PRIVATE_SCRIPT');
    expect(sent).toMatchObject({
      graph: { nodes: [{ id: graph.nodes[0].id }] },
      question: { maxDepth: 16, limit: 25 },
    });
  });
});
