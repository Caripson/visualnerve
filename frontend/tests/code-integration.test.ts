import { afterEach, describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { getCodeAnalysis, getCodeObject, getCodeRelation } from '../src/code/schema';
import { reconnectedAnalysisEdge } from '../src/model/relationships';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { buildLovablePrompt } from '../src/export/lovable';
import { markdown } from '../src/export/semantic';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

function fixture(): Graph {
  const graph = blankGraph('Code outline', 'dependency');
  graph.diagram.metadata.codeAnalysis = {
    version: 1,
    languages: ['python'],
    mode: 'symbols',
    fileCount: 1,
    symbolCount: 2,
    dependencyCount: 1,
    unresolvedCount: 0,
    warnings: ['Static outline; dynamic calls may be unresolved.'],
  };
  graph.nodes = ['load', 'save'].map((name, i) =>
    newNode(graph.diagram.id, {
      title: name,
      nodeType: 'process',
      metadata: {
        codeObject: {
          version: 1,
          language: 'python',
          path: 'app.py',
          kind: 'function',
          name,
          line: i + 1,
        },
        private: 'EXCLUDED-PRIVATE-SOURCE',
      },
    }),
  );
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      edgeType: 'code-calls',
      metadata: {
        codeRelation: {
          version: 1,
          kind: 'calls',
          confidence: 'heuristic',
          evidence: { path: 'app.py', line: 2 },
        },
        private: 'EXCLUDED-PRIVATE-EDGE',
      },
    }),
  ];
  return graph;
}
const databases: WorkspaceDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

describe('code metadata across normal diagram workflows', () => {
  it('survives storage, native JSON, clipboard remapping and workspace backups', async () => {
    const graph = fixture();
    validateGraph(graph);
    const db = new WorkspaceDatabase(`code-integration-${crypto.randomUUID()}`);
    databases.push(db);
    const repo = new Repository(db);
    await db.initialize();
    await repo.importGraph(graph);
    const saved = await repo.getGraph(graph.diagram.id);
    expect(saved?.nodes.map(getCodeObject)).toEqual(graph.nodes.map(getCodeObject));
    expect(saved?.edges.map(getCodeRelation)).toEqual(graph.edges.map(getCodeRelation));
    const backup = await db.backup();
    expect(backup.nodes.find((node) => node.id === graph.nodes[0].id)?.metadata.codeObject).toEqual(
      graph.nodes[0].metadata.codeObject,
    );
    const pasted = pasteSelection(
      copySelection(
        graph,
        graph.nodes.map((node) => node.id),
      ),
      graph,
    );
    expect(pasted.edges[0].sourceNodeId).toBe(pasted.nodes[0].id);
    expect(pasted.edges[0].targetNodeId).toBe(pasted.nodes[1].id);
    expect(getCodeObject(pasted.nodes[0])?.path).toBe('app.py');
    expect(getCodeRelation(pasted.edges[0])?.evidence?.line).toBe(2);
    const json = await repo.request<Graph>('/export', 'POST', {
      diagramId: graph.diagram.id,
      format: 'json',
    });
    expect(getCodeAnalysis(json)?.languages).toEqual(['python']);
    expect(json.edges.map(getCodeRelation)).toEqual(graph.edges.map(getCodeRelation));
  });

  it('exports bounded recognized structure, confidence and boundaries without arbitrary metadata', () => {
    const graph = fixture();
    const full = buildLovablePrompt(graph, 'Build this service', { scope: 'diagram' });
    const selected = buildLovablePrompt(graph, '', {
      scope: 'selected',
      selectedIds: [graph.nodes[0].id],
    });
    for (const text of [full.text, selected.text, markdown(graph)]) {
      expect(text).toContain('app.py');
      expect(text).toContain('heuristic');
      expect(text).not.toContain('EXCLUDED-PRIVATE');
    }
    expect(selected.boundaryCount).toBe(1);
    expect(full.text).toContain('not an executed program');
    expect(full.text).toContain('Static outline; dynamic calls may be unresolved.');
    expect(markdown(graph)).toContain('Static outline; dynamic calls may be unresolved.');
  });

  it('keeps evidence on label edits and removes stale evidence on reconnects', () => {
    const graph = fixture(),
      previous = graph.edges[0];
    const labelled = reconnectedAnalysisEdge(previous, { ...previous, label: 'Possible call' });
    expect(getCodeRelation(labelled)?.evidence?.line).toBe(2);
    const moved = reconnectedAnalysisEdge(previous, {
      ...previous,
      targetNodeId: graph.nodes[0].id,
    });
    expect(getCodeRelation(moved)).toBeUndefined();
    expect(moved.edgeType).toBe('relationship');
    expect(moved.metadata.private).toBe('EXCLUDED-PRIVATE-EDGE');
  });

  it.each([
    (g: Graph) => {
      (g.nodes[0].metadata.codeObject as Record<string, unknown>).language = 'invented';
    },
    (g: Graph) => {
      (g.nodes[0].metadata.codeObject as Record<string, unknown>).line = 0;
    },
    (g: Graph) => {
      (g.nodes[0].metadata.codeObject as Record<string, unknown>).rawSource = 'not allowed';
    },
    (g: Graph) => {
      (g.edges[0].metadata.codeRelation as Record<string, unknown>).confidence = 'certain';
    },
    (g: Graph) => {
      (
        (g.edges[0].metadata.codeRelation as Record<string, unknown>).evidence as Record<
          string,
          unknown
        >
      ).line = -1;
    },
    (g: Graph) => {
      (g.diagram.metadata.codeAnalysis as Record<string, unknown>).languages = ['python', 'python'];
    },
    (g: Graph) => {
      (g.nodes[0].metadata.codeObject as Record<string, unknown>).kind = ['function'];
    },
    (g: Graph) => {
      (g.edges[0].metadata.codeRelation as Record<string, unknown>).kind = ['calls'];
    },
    (g: Graph) => {
      (g.edges[0].metadata.codeRelation as Record<string, unknown>).confidence = ['heuristic'];
    },
    (g: Graph) => {
      (g.diagram.metadata.codeAnalysis as Record<string, unknown>).mode = ['symbols'];
    },
  ])('rejects malformed reserved contracts before persistence', (mutate) => {
    const graph = fixture();
    mutate(graph);
    expect(() => validateGraph(graph)).toThrow(/Invalid code/);
  });
});
