import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { blankGraph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

let db: WorkspaceDatabase;
let repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`csv-clipboard-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
  useEditor.getState().setGraph(null);
});
afterEach(async () => {
  useEditor.getState().setGraph(null);
  await db.delete();
});

function fixture() {
  const dataset = parseCsv('Region,Amount\nNorth,10\nNorth,20\nSouth,5', 'Revenue.csv');
  const analysis = defaultAnalysis(dataset);
  analysis.metrics.push({ id: 'sum', operation: 'sum', columnId: 'c1' });
  const graph = csvGraph(dataset, analysis);
  return { dataset, analysis, graph };
}

describe('CSV cards on the diagram clipboard', () => {
  it('pastes metric snapshots into an ordinary diagram, retains hierarchy and saves without copying source rows', async () => {
    const { graph } = fixture();
    const clip = copySelection(
      graph,
      graph.nodes.map((node) => node.id),
    );
    const target = blankGraph('Presentation', 'flowchart');
    useEditor.getState().setGraph(target);
    useEditor.getState().paste(clip);
    const pasted = useEditor.getState().graph!;
    expect(pasted.dataset).toBeUndefined();
    expect(pasted.diagram.settings.csvAnalysis).toBeUndefined();
    expect(clip).not.toHaveProperty('dataset');
    expect(pasted.nodes).toHaveLength(graph.nodes.length);
    for (const [index, node] of pasted.nodes.entries()) {
      expect(node.id).not.toBe(graph.nodes[index].id);
      expect(node.metadata.csv).toBeUndefined();
      expect(node.metadata.csvSnapshot).toEqual({
        ...getCsvNode(graph.nodes[index])!,
        visible: true,
      });
      expect(getCsvNode(node)?.measures).toEqual(getCsvNode(graph.nodes[index])?.measures);
      expect(node.metadata).not.toHaveProperty('rows');
    }
    expect(pasted.edges).toHaveLength(graph.edges.length);
    for (const edge of pasted.edges) {
      expect(edge.metadata.csvGenerated).toBe(false);
      expect(pasted.nodes.some((node) => node.id === edge.sourceNodeId)).toBe(true);
      expect(pasted.nodes.find((node) => node.id === edge.targetNodeId)?.parentId).toBe(
        edge.sourceNodeId,
      );
    }
    expect(() => validateGraph(pasted)).not.toThrow();
    const saved = await repo.saveGraph(pasted, 0);
    expect(await db.datasets.count()).toBe(0);
    db.close();
    await db.open();
    const reopened = await repo.getGraph(saved.diagram.id);
    expect(reopened.dataset).toBeUndefined();
    expect(reopened.nodes.map(getCsvNode)).toEqual(pasted.nodes.map(getCsvNode));
  });

  it('keeps same-source copies associated while preserving their metrics through regrouping and save', async () => {
    const { dataset, analysis, graph } = fixture();
    const north = graph.nodes.find((node) => node.title === 'North')!;
    const clip = copySelection(graph, [north.id]);
    useEditor.getState().setGraph(graph);
    useEditor.getState().paste(clip);
    const pasted = useEditor.getState().graph!;
    const copy = pasted.nodes.find((node) => node.id === useEditor.getState().selectedNodes[0])!;
    expect(copy.metadata.csvSnapshot).toBeUndefined();
    expect(copy.metadata.csv).toEqual(north.metadata.csv);
    expect(copy.externalId).toBeUndefined();
    const regrouped = csvGraph(dataset, { ...analysis, levels: [] }, pasted);
    expect(regrouped.nodes.find((node) => node.id === copy.id)).toEqual(copy);
    expect(() => validateGraph(regrouped)).not.toThrow();
    const saved = await repo.saveGraph(regrouped, 0);
    expect(getCsvNode(saved.nodes.find((node) => node.id === copy.id)!)).toEqual(getCsvNode(copy));
    expect(saved.dataset?.id).toBe(dataset.id);
  });

  it('makes copied historical cards visible without changing their source or hidden measures', () => {
    const { graph } = fixture();
    const north = graph.nodes.find((node) => node.title === 'North')!;
    north.metadata.csv = { ...getCsvNode(north)!, visible: false, hiddenMetricIds: ['sum'] };
    const clip = copySelection(graph, [north.id]);
    const associated = pasteSelection(clip, graph).nodes[0];
    expect(associated.metadata.csvSnapshot).toBeUndefined();
    expect(getCsvNode(associated)).toMatchObject({
      datasetId: graph.dataset!.id,
      visible: true,
      hiddenMetricIds: ['sum'],
    });
    const snapshot = pasteSelection(clip, blankGraph('Presentation')).nodes[0];
    expect(snapshot.metadata.csv).toBeUndefined();
    expect(getCsvNode(snapshot)).toMatchObject({ visible: true, hiddenMetricIds: ['sum'] });
    expect(getCsvNode(north)?.visible).toBe(false);
  });

  it('keeps foreign-source snapshots manual when pasted into a different CSV diagram and later regrouped', () => {
    const { graph } = fixture();
    const dataset = parseCsv('Category,Value\nOther,99', 'Other.csv');
    const analysis = defaultAnalysis(dataset);
    const target = csvGraph(dataset, analysis);
    const north = graph.nodes.find((node) => node.title === 'North')!;
    const pasted = pasteSelection(copySelection(graph, [north.id]), target);
    target.nodes.push(...pasted.nodes);
    const regrouped = csvGraph(dataset, { ...analysis, levels: [] }, target);
    const snapshot = regrouped.nodes.find((node) => node.id === pasted.nodes[0].id)!;
    expect(snapshot).toEqual(pasted.nodes[0]);
    expect(snapshot.metadata.csv).toBeUndefined();
    expect(getCsvNode(snapshot)?.measures).toEqual(getCsvNode(north)?.measures);
    expect(() => validateGraph(regrouped)).not.toThrow();
  });
});
