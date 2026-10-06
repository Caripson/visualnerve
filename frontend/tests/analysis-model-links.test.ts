import { beforeEach, expect, it } from 'vitest';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { newNode } from '../src/model/types';
import { reanalyzeDataModel, setAnalysisForDataset } from '../src/data/model';
import { useEditor } from '../src/state/editor';
import { exploreRelationships, relationshipGraph } from '../src/analysis/relationships';
import { projectGraph } from '../src/canvas/projection';
beforeEach(() => useEditor.getState().setGraph(null));
function fixture() {
  const first = parseCsv('Customer,Amount\nA,10', 'orders.csv');
  let graph = csvGraph(first, defaultAnalysis(first));
  const second = parseCsv('Customer,Contact\nA,Anna', 'customers.csv');
  second.diagramId = graph.diagram.id;
  graph.datasets = [second];
  graph = setAnalysisForDataset(graph, first.id, defaultAnalysis(first));
  graph = setAnalysisForDataset(graph, second.id, defaultAnalysis(second));
  graph.diagram.settings.csvRelationships = [
    {
      id: crypto.randomUUID(),
      sourceDatasetId: first.id,
      sourceColumnId: first.columns[0].id,
      targetDatasetId: second.id,
      targetColumnId: second.columns[0].id,
    },
  ];
  graph = reanalyzeDataModel(graph);
  const edge = graph.edges.find((edge) => edge.metadata.csvModelGenerated === true)!;
  useEditor.getState().setGraph(graph);
  return { graph, first, second, edge };
}
it('records explicit generated-relationship deletion so regrouping cannot recreate it and undo restores both the link and suppression', () => {
  const { edge } = fixture();
  useEditor.getState().select([], [edge.id]);
  useEditor.getState().remove();
  expect(useEditor.getState().graph!.diagram.settings.csvSuppressedRelationshipEdges).toContain(
    edge.externalId,
  );
  expect(
    reanalyzeDataModel(useEditor.getState().graph!).edges.some(
      (item) => item.externalId === edge.externalId,
    ),
  ).toBe(false);
  useEditor.getState().undo();
  expect(useEditor.getState().graph!.edges.find((item) => item.id === edge.id)).toEqual(edge);
  expect(
    useEditor.getState().graph!.diagram.settings.csvSuppressedRelationshipEdges,
  ).toBeUndefined();
  useEditor.getState().redo();
  expect(
    reanalyzeDataModel(useEditor.getState().graph!).edges.some((item) => item.id === edge.id),
  ).toBe(false);
});
it('converts a reconnected model edge to a manual link and preserves its endpoints, style and annotations through reanalysis and history', () => {
  const { graph, edge } = fixture();
  const note = newNode(graph.diagram.id, { title: 'Manual note' });
  useEditor
    .getState()
    .command('Add annotation', (current) => ({ ...current, nodes: [...current.nodes, note] }));
  useEditor.getState().updateEdge(edge.id, {
    targetNodeId: note.id,
    label: 'My custom explanation',
    style: 'dotted',
    direction: 'both',
  });
  const changed = useEditor.getState().graph!;
  expect(changed.edges.find((item) => item.id === edge.id)).toMatchObject({
    targetNodeId: note.id,
    label: 'My custom explanation',
    style: 'dotted',
    direction: 'both',
    edgeType: 'relationship',
    metadata: { csvModelGenerated: false },
  });
  expect(changed.diagram.settings.csvSuppressedRelationshipEdges).toContain(edge.externalId);
  const regenerated = reanalyzeDataModel(changed);
  expect(regenerated.edges.find((item) => item.id === edge.id)?.targetNodeId).toBe(note.id);
  expect(regenerated.edges.some((item) => item.externalId === edge.externalId)).toBe(false);
  useEditor.getState().undo();
  expect(useEditor.getState().graph!.edges.find((item) => item.id === edge.id)).toEqual(edge);
  useEditor.getState().redo();
  expect(useEditor.getState().graph!.edges.find((item) => item.id === edge.id)?.targetNodeId).toBe(
    note.id,
  );
});
it('excludes retained old model links by default, labels an explicitly explored old relation, and commits source-only changes', () => {
  const { graph, edge, second } = fixture();
  const hidden = { ...edge, metadata: { ...edge.metadata, csvModelVisible: false } };
  graph.edges = graph.edges.map((item) => (item.id === edge.id ? hidden : item));
  expect(projectGraph(graph, []).edges.some((item) => item.id === edge.id)).toBe(false);
  const options = {
    version: 1 as const,
    mode: 'path' as const,
    startId: edge.sourceNodeId,
    targetId: edge.targetNodeId,
    direction: 'all' as const,
    steps: 1 as const,
    directed: true,
    includeHidden: false,
  };
  expect(exploreRelationships(relationshipGraph(graph), options).found).toBe(false);
  const shown = exploreRelationships(relationshipGraph(graph), { ...options, includeHidden: true });
  expect(shown.outsideViewEdgeIds).toEqual([edge.id]);
  expect(
    projectGraph(
      graph,
      [],
      [],
      [],
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      shown,
    ).edges.find((item) => item.id === edge.id)?.label,
  ).toContain('outside current data view');
  const updated = { ...second, rows: [...second.rows, ['B', 'Bob']] };
  useEditor
    .getState()
    .command('Replace source', (current) => ({ ...current, datasets: [updated] }));
  expect(useEditor.getState().graph!.datasets?.[0]).toBe(updated);
  expect(useEditor.getState().history.at(-1)?.sources).toHaveLength(1);
  useEditor.getState().undo();
  expect(useEditor.getState().graph!.datasets?.[0]).toBe(second);
});
