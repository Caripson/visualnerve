import { expect, it } from 'vitest';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { renderedScene } from '../src/export/rendered';
import { newEdge } from '../src/model/types';

it('exports an explicitly selected historical CSV group with an outside-view warning, its measures and links without changing current-data complete scope', () => {
  const dataset = parseCsv('Region,Amount\nNorth,12\nSouth,34', 'regions.csv');
  const graph = csvGraph(dataset, {
    ...defaultAnalysis(dataset),
    metrics: [{ id: 'sum', operation: 'sum', columnId: 'c1' }],
  });
  const north = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
  const south = graph.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'South')!;
  south.metadata = { ...south.metadata, csv: { ...getCsvNode(south)!, visible: false } };
  const manual = newEdge(graph.diagram.id, north.id, south.id, {
    label: 'Annotated dependency',
    direction: 'both',
    style: 'dotted',
  });
  graph.edges.push(manual);
  const original = JSON.stringify(graph);
  const onlyHistorical = renderedScene(graph, 'selected', [south.id]);
  expect(onlyHistorical.nodes.map((node) => node.id)).toEqual([south.id]);
  expect(onlyHistorical.nodes[0].className).toBe('analysis-outside-data-view');
  expect(getCsvNode(onlyHistorical.nodes[0].data.node)?.measures[0].value).toBe(34);
  expect(onlyHistorical.bounds.width).toBe(south.width);
  const pair = renderedScene(graph, 'selected', [north.id, south.id]);
  expect(pair.edges.find((edge) => edge.id === manual.id)).toMatchObject({
    label: manual.label,
    style: { strokeDasharray: '2 4' },
  });
  expect(renderedScene(graph, 'complete', []).nodes.some((node) => node.id === south.id)).toBe(
    false,
  );
  expect(JSON.stringify(graph)).toBe(original);
});
