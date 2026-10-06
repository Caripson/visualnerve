import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { drawingLimits, getDrawingLayer } from '../src/drawing/types';
import { blankGraph, type DrawingLayer, type DrawingStroke, type Graph } from '../src/model/types';
import { validateDrawingLayer, validateGraph } from '../src/model/validation';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';

function stroke(
  points: [number, number][] = [
    [-15, 20],
    [10, 40],
  ],
): DrawingStroke {
  return { id: crypto.randomUUID(), color: '#e85d3f', width: 3, points };
}
function layer(): DrawingLayer {
  return { version: 1, visible: true, strokes: [stroke()] };
}
function source(): Graph {
  const dataset = parseCsv('Region,Amount\nNorth,10\nNorth,20\nSouth,30', 'Sales.csv');
  return csvGraph(dataset, defaultAnalysis(dataset));
}
afterEach(() => {
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
});

describe('drawing model and editor commands', () => {
  it('records drawing changes independently of graph objects and raw CSV data, with undo and redo', () => {
    const graph = source();
    const first = stroke();
    const second = stroke([[100, 200]]);
    const editor = useEditor.getState();
    editor.setGraph(graph);
    editor.addDrawingStroke(first);
    const drawn = useEditor.getState().graph!;
    expect(drawn.dataset).toBe(graph.dataset);
    expect(drawn.nodes).toBe(graph.nodes);
    expect(drawn.edges).toBe(graph.edges);
    expect(drawn.diagram.settings.drawing).toEqual({ version: 1, visible: true, strokes: [first] });
    first.points[0][0] = 999;
    expect(drawn.diagram.settings.drawing!.strokes[0].points[0][0]).toBe(-15);
    editor.addDrawingStroke(second);
    const both = useEditor.getState().graph!.diagram.settings.drawing;
    editor.toggleDrawingVisibility();
    const hidden = useEditor.getState().graph!.diagram.settings.drawing;
    expect(hidden!.visible).toBe(false);
    editor.eraseDrawingStrokes([first.id]);
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual({
      ...hidden,
      strokes: [second],
    });
    editor.undo();
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual(hidden);
    editor.undo();
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual(both);
    editor.redo();
    editor.redo();
    editor.clearDrawing();
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual({
      ...hidden,
      strokes: [],
    });
    editor.undo();
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual({
      ...hidden,
      strokes: [second],
    });
    expect(useEditor.getState().graph!.dataset).toBe(graph.dataset);
    expect(
      useEditor
        .getState()
        .history.every(
          (delta) => delta.nodes.length === 0 && delta.edges.length === 0 && !!delta.diagram,
        ),
    ).toBe(true);
    const historyLength = useEditor.getState().history.length;
    editor.eraseDrawingStrokes([crypto.randomUUID()]);
    expect(useEditor.getState().history).toHaveLength(historyLength);
    editor.addDrawingStroke(stroke());
    expect(useEditor.getState().graph!.diagram.settings.drawing!.visible).toBe(true);
  });

  it('keeps tool and brush state transient and returns to diagram editing when opening another graph', () => {
    const editor = useEditor.getState();
    editor.setGraph(blankGraph('First'));
    expect(useEditor.getState()).toMatchObject({
      drawingTool: 'none',
      drawingColor: '#e85d3f',
      drawingWidth: 3,
    });
    editor.setDrawingTool('pen');
    editor.setDrawingTool('eraser');
    expect(useEditor.getState().drawingTool).toBe('eraser');
    expect(useEditor.getState().history).toHaveLength(0);
    expect(useEditor.getState().graph!.diagram.settings.drawing).toBeUndefined();
    editor.setGraph(blankGraph('Second'));
    expect(useEditor.getState().drawingTool).toBe('none');
    expect(useEditor.getState().graph!.diagram.settings.drawing).toBeUndefined();
  });

  it('rejects an invalid stroke before changing graph or history', () => {
    const graph = blankGraph('Atomic drawing');
    const editor = useEditor.getState();
    editor.setGraph(graph);
    expect(() => editor.addDrawingStroke({ ...stroke(), points: [[Infinity, 0]] })).toThrow();
    expect(useEditor.getState().graph).toBe(graph);
    expect(useEditor.getState().history).toHaveLength(0);
    editor.addDrawingStroke(stroke());
    const drawn = useEditor.getState().graph!;
    expect(() => editor.addDrawingStroke(drawn.diagram.settings.drawing!.strokes[0])).toThrow();
    expect(useEditor.getState().graph).toBe(drawn);
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it('accepts boundary coordinates, one-point dots, hex transparency and the documented total limit', () => {
    const drawing = layer();
    drawing.strokes[0] = { ...stroke([[-1e8, 1e8]]), color: '#AbC8', width: 32 };
    expect(() => validateDrawingLayer(drawing)).not.toThrow();
    drawing.strokes = Array.from(
      { length: drawingLimits.points / drawingLimits.pointsPerStroke },
      () => stroke(Array.from({ length: drawingLimits.pointsPerStroke }, () => [1, 2])),
    );
    expect(() => validateDrawingLayer(drawing)).not.toThrow();
    expect(getDrawingLayer(drawing)).toBe(drawing);
    expect(getDrawingLayer({ userNote: 'legacy' })).toBeUndefined();
  });

  it.each([
    ['missing visibility', (drawing: DrawingLayer) => Reflect.deleteProperty(drawing, 'visible')],
    ['missing strokes', (drawing: DrawingLayer) => Reflect.deleteProperty(drawing, 'strokes')],
    ['unsupported version', (drawing: DrawingLayer) => Object.assign(drawing, { version: 2 })],
    ['invalid visibility', (drawing: DrawingLayer) => Object.assign(drawing, { visible: 'yes' })],
    [
      'non-UUID stroke',
      (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { id: 'stroke' }),
    ],
    ['duplicate strokes', (drawing: DrawingLayer) => drawing.strokes.push(drawing.strokes[0])],
    [
      'non-hex color',
      (drawing: DrawingLayer) =>
        Object.assign(drawing.strokes[0], { color: 'url(https://example.com)' }),
    ],
    ['small width', (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { width: 0.9 })],
    ['large width', (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { width: 32.1 })],
    [
      'non-finite width',
      (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { width: NaN }),
    ],
    ['empty stroke', (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { points: [] })],
    [
      'non-finite coordinates',
      (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { points: [[NaN, 0]] }),
    ],
    [
      'large coordinates',
      (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { points: [[0, 1e8 + 1]] }),
    ],
    [
      'wrong tuple shape',
      (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { points: [[1, 2, 3]] }),
    ],
    [
      'string coordinates',
      (drawing: DrawingLayer) => Object.assign(drawing.strokes[0], { points: [['1', 2]] }),
    ],
    [
      'too many strokes',
      (drawing: DrawingLayer) =>
        Object.assign(drawing, {
          strokes: Array.from({ length: drawingLimits.strokes + 1 }, () => stroke()),
        }),
    ],
    [
      'too many points per stroke',
      (drawing: DrawingLayer) =>
        Object.assign(drawing.strokes[0], {
          points: Array.from({ length: drawingLimits.pointsPerStroke + 1 }, () => [1, 2]),
        }),
    ],
    [
      'too many total points',
      (drawing: DrawingLayer) =>
        Object.assign(drawing, {
          strokes: Array.from({ length: 11 }, () =>
            stroke(Array.from({ length: drawingLimits.pointsPerStroke }, () => [1, 2])),
          ),
        }),
    ],
  ] as const)('rejects %s through graph validation', (_, mutate) => {
    const graph = blankGraph('Drawing validation');
    graph.diagram.settings.drawing = layer();
    mutate(graph.diagram.settings.drawing);
    expect(() => validateGraph(graph)).toThrow();
    try {
      validateGraph(graph);
    } catch (error) {
      expect(error).toMatchObject({ status: 422 });
    }
  });
});

describe('drawing storage and CSV integration', () => {
  let db: WorkspaceDatabase;
  let repo: Repository;
  let workspace: Workspace | undefined;
  beforeEach(async () => {
    db = new WorkspaceDatabase(`drawing-${crypto.randomUUID()}`);
    repo = new Repository(db);
    useEditor.getState().setGraph(null);
    useEditor.setState({ status: 'saved', message: '' });
    await db.initialize();
  });
  afterEach(async () => {
    workspace?.stop();
    workspace = undefined;
    await db.delete();
  });

  it('roundtrips an independent drawing through reopen, JSON exports, copied imports and backups', async () => {
    const graph = blankGraph('Pen drawing');
    graph.diagram.settings.drawing = layer();
    graph.diagram.settings.drawing.visible = false;
    const original = await repo.importGraph(graph);
    db.close();
    await db.open();
    expect((await repo.getGraph(original.diagram.id)).diagram.settings.drawing).toEqual(
      graph.diagram.settings.drawing,
    );
    const exported = await repo.request<Graph>('/export', 'POST', {
      diagramId: original.diagram.id,
      format: 'json',
    });
    expect(exported.diagram.settings.drawing).toEqual(graph.diagram.settings.drawing);
    const copied = await repo.importGraph(exported);
    expect(copied.diagram.id).not.toBe(original.diagram.id);
    expect(copied.diagram.settings.drawing).toEqual(graph.diagram.settings.drawing);
    const restored = await repo.restore(await db.backup(), 'replace');
    expect(restored).toHaveLength(2);
    expect(
      restored.every(
        (saved) =>
          JSON.stringify(saved.diagram.settings.drawing) ===
          JSON.stringify(graph.diagram.settings.drawing),
      ),
    ).toBe(true);
  });

  it('keeps old diagrams and legacy freeform drawing settings intact', async () => {
    const old = await repo.importGraph(blankGraph('Old diagram'));
    expect(old.diagram.settings.drawing).toBeUndefined();
    const legacy = blankGraph('Custom settings');
    const custom = { version: 1, userNotes: ['Preserve me'], mode: 'annotation' };
    legacy.diagram.settings.drawing = custom as unknown as DrawingLayer;
    const saved = await repo.importGraph(legacy);
    const backup = await db.backup();
    delete backup.datasets;
    backup.schemaVersion = 4;
    const restored = await repo.restore(backup);
    expect(
      restored.find((graph) => graph.diagram.name === old.diagram.name)!.diagram.settings.drawing,
    ).toBeUndefined();
    const copied = restored.find((graph) => graph.diagram.name === saved.diagram.name)!;
    expect(copied.diagram.settings.drawing).toEqual(custom);
    useEditor.getState().setGraph(copied);
    useEditor.getState().addDrawingStroke(stroke());
    expect(
      getDrawingLayer(useEditor.getState().graph!.diagram.settings.drawing)?.strokes,
    ).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual(custom);
  });

  it('preserves world-coordinate strokes through CSV filter, focus, paging and regroup', async () => {
    const graph = source();
    graph.diagram.settings.drawing = layer();
    const original = await repo.importGraph(graph);
    const analysis = original.diagram.settings.csvAnalysis!;
    let latest = original;
    for (const config of [
      {
        ...analysis,
        filters: [{ id: 'north', columnId: 'c0', operation: 'equals' as const, value: 'North' }],
      },
      { ...analysis, focusPath: [{ columnId: 'c0', value: 'North' }] },
      { ...analysis, offset: 1, limit: 1 },
      { ...analysis, levels: ['c1'] },
      analysis,
    ]) {
      const projected = csvGraph(latest.dataset!, config, latest);
      expect(projected.diagram.settings.drawing).toBe(latest.diagram.settings.drawing);
      const { dataset: _dataset, ...drawing } = projected;
      latest = await repo.saveGraph(drawing, latest.diagram.version);
      expect(latest.diagram.settings.drawing).toEqual(original.diagram.settings.drawing);
      expect(latest.dataset).toBe(original.dataset);
    }
    expect(latest.dataset!.rows).toEqual(original.dataset!.rows);
  });

  it('autosaves drawing commands and undo without copying, loading or writing raw CSV data', async () => {
    const original = await repo.importGraph(source());
    workspace = new Workspace(repo);
    await workspace.acceptStorage();
    await workspace.open(original.diagram.id);
    const dataset = useEditor.getState().graph!.dataset;
    const rawRead = vi.spyOn(db.datasets, 'where');
    const rawWrite = vi.spyOn(db.datasets, 'put');
    const rawBulkWrite = vi.spyOn(db.datasets, 'bulkPut');
    const editor = useEditor.getState();
    const added = stroke();
    editor.addDrawingStroke(added);
    await workspace.settled();
    const drawn = await repo.getGraph(original.diagram.id);
    expect(drawn.diagram.settings.drawing!.strokes).toEqual([added]);
    editor.toggleDrawingVisibility();
    await workspace.settled();
    expect((await repo.getGraph(original.diagram.id)).diagram.settings.drawing!.visible).toBe(
      false,
    );
    editor.undo();
    await workspace.settled();
    expect((await repo.getGraph(original.diagram.id)).diagram.settings.drawing!.visible).toBe(true);
    editor.undo();
    await workspace.settled();
    expect((await repo.getGraph(original.diagram.id)).diagram.settings.drawing).toBeUndefined();
    editor.redo();
    await workspace.settled();
    expect((await repo.getGraph(original.diagram.id)).diagram.settings.drawing!.strokes).toEqual([
      added,
    ]);
    expect(useEditor.getState().graph!.dataset).toBe(dataset);
    expect(rawRead).not.toHaveBeenCalled();
    expect(rawWrite).not.toHaveBeenCalled();
    expect(rawBulkWrite).not.toHaveBeenCalled();
  });

  it('rolls back malformed drawing imports and conflicting edits without changing saved strokes', async () => {
    const graph = blankGraph('Safe drawing');
    graph.diagram.settings.drawing = layer();
    const original = await repo.importGraph(graph);
    const malformed = structuredClone(original);
    malformed.diagram.settings.drawing!.strokes[0].points[0][0] = Infinity;
    await expect(repo.saveGraph(malformed, original.diagram.version)).rejects.toMatchObject({
      status: 422,
    });
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
    const changed = structuredClone(original);
    changed.diagram.settings.drawing!.visible = false;
    const latest = await repo.saveGraph(changed, original.diagram.version);
    await expect(repo.saveGraph(original, original.diagram.version)).rejects.toMatchObject({
      status: 409,
    });
    expect(await repo.getGraph(original.diagram.id)).toEqual(latest);
  });
});
