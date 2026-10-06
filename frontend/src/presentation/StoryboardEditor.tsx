import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Plus, Save, Trash2, Eye } from 'lucide-react';
import { useEditor } from '../state/editor';
import { getOverviewConfig } from '../overview/types';
import { capturePresentationView } from './camera';
import { getPresentation } from './definition';
import { presentation } from './service';
import {
  addStoryboardScene,
  getStoryboard,
  moveStoryboardScene,
  removeStoryboardScene,
  setStoryboard,
  updateStoryboardScene,
  STORYBOARD_NARRATION_LIMIT,
  STORYBOARD_SCENE_LIMIT,
  type StoryboardScene,
} from './storyboard';
import './storyboard.css';
import {
  assertStoryboardCameraAvailable,
  STORYBOARD_OVERVIEW_VIEW_MESSAGE,
} from './view-compatibility';

/** All edits use normal graph commands; narration/camera belong to a scene, never a node. */
export function StoryboardEditor({ disabled = false }: { disabled?: boolean }) {
  const graph = useEditor((state) => state.graph),
    selectedNodes = useEditor((state) => state.selectedNodes),
    selectedEdges = useEditor((state) => state.selectedEdges);
  const definition = useMemo(
    () => (graph ? getStoryboard(graph) : { version: 1 as const, scenes: [] }),
    [graph],
  );
  const [selected, setSelected] = useState(''),
    [page, setPage] = useState(0),
    [draft, setDraft] = useState<StoryboardScene | null>(null),
    [error, setError] = useState(''),
    [nodeSearch, setNodeSearch] = useState(''),
    [edgeSearch, setEdgeSearch] = useState('');
  const scene = definition.scenes.find((value) => value.id === selected) ?? definition.scenes[0];
  const fingerprint = scene ? JSON.stringify(scene) : '';
  useEffect(() => {
    setDraft(scene ? structuredClone(scene) : null);
    setSelected(scene?.id ?? '');
  }, [fingerprint]);
  useEffect(
    () =>
      setPage((value) =>
        Math.min(value, Math.max(0, Math.ceil(definition.scenes.length / 25) - 1)),
      ),
    [definition.scenes.length],
  );
  if (!graph) return null;
  const overview = getOverviewConfig(graph).enabled;
  const run = async (action: () => unknown) => {
    try {
      setError('');
      await action();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const change = <K extends keyof StoryboardScene>(key: K, value: StoryboardScene[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const create = () =>
    run(() => {
      const current = useEditor.getState();
      if (!current.graph) return;
      let id = '';
      current.command('Add storyboard scene', (graph) => {
        const result = addStoryboardScene(graph, current.selectedNodes, current.selectedEdges);
        id = getStoryboard(result).scenes.at(-1)!.id;
        return result;
      });
      setSelected(id);
      setPage(Math.floor(definition.scenes.length / 25));
    });
  const fromNumbered = () =>
    run(() =>
      useEditor.getState().command('Add numbered storyboard scenes', (current) => {
        const storyboard = getStoryboard(current),
          legacy = getPresentation(current),
          nodes = new Map(current.nodes.map((node) => [node.id, node]));
        if (storyboard.scenes.length + legacy.nodeIds.length > STORYBOARD_SCENE_LIMIT)
          throw new Error('Storyboard supports at most 1,000 scenes. Select a smaller sequence.');
        const scenes = legacy.nodeIds.map(
          (id): StoryboardScene => ({
            id: crypto.randomUUID(),
            name: (nodes.get(id)?.title || 'Scene').slice(0, 200),
            nodeIds: [id],
            edgeIds: [],
            narration: nodes.get(id)?.description ?? '',
            seconds: legacy.secondsPerNode,
            transitionMs: legacy.transitionMs,
          }),
        );
        return setStoryboard(current, { ...storyboard, scenes: [...storyboard.scenes, ...scenes] });
      }),
    );
  const useSelection = () => {
    if (!draft) return;
    const edges = graph.edges.filter((edge) => selectedEdges.includes(edge.id));
    const ids = [
      ...new Set([
        ...selectedNodes,
        ...edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
      ]),
    ];
    if (!ids.length) {
      setError('Select one or more diagram objects first.');
      return;
    }
    setDraft({ ...draft, nodeIds: ids, edgeIds: [...selectedEdges] });
  };
  const save = () =>
    run(() => {
      if (!draft) return;
      const { id, ...patch } = draft;
      useEditor
        .getState()
        .command('Edit storyboard scene', (graph) => updateStoryboardScene(graph, id, patch));
    });
  const queryNodes = nodeSearch.toLocaleLowerCase(),
    queryEdges = edgeSearch.toLocaleLowerCase();
  const nodeResults = graph.nodes.filter(
    (node) => !queryNodes || `${node.title} ${node.id}`.toLocaleLowerCase().includes(queryNodes),
  );
  const byId = new Map(graph.nodes.map((node) => [node.id, node.title]));
  const edgeResults = graph.edges.filter(
    (edge) =>
      !queryEdges ||
      `${edge.label ?? ''} ${byId.get(edge.sourceNodeId)} ${byId.get(edge.targetNodeId)}`
        .toLocaleLowerCase()
        .includes(queryEdges),
  );
  const toggle = (field: 'nodeIds' | 'edgeIds', id: string) => {
    if (!draft) return;
    const ids = draft[field];
    change(field, ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  };
  return (
    <div className="storyboard-editor" aria-label="Storyboard editor">
      <fieldset disabled={disabled}>
        <div className="storyboard-actions">
          <button
            onClick={() => void create()}
            disabled={!selectedNodes.length && !selectedEdges.length}
          >
            <Plus size={15} /> New scene from selection
          </button>
          <button
            onClick={() => void fromNumbered()}
            disabled={!getPresentation(graph).nodeIds.length}
          >
            Add numbered nodes as scenes
          </button>
        </div>
        <small className="muted">
          Scenes group nodes and links without moving them. Each scene has its own narration,
          duration and optional saved camera. Changes support Undo.
        </small>
        {definition.scenes.length > 0 && (
          <>
            <ol start={page * 25 + 1} className="storyboard-scenes">
              {definition.scenes.slice(page * 25, page * 25 + 25).map((value, offset) => (
                <li key={value.id}>
                  <button
                    className={scene?.id === value.id ? 'active' : ''}
                    aria-pressed={scene?.id === value.id}
                    onClick={() => setSelected(value.id)}
                  >
                    {value.name}
                  </button>
                  <button
                    aria-label={`Move scene ${value.name} earlier`}
                    disabled={page * 25 + offset === 0}
                    onClick={() =>
                      void run(() =>
                        useEditor
                          .getState()
                          .command('Reorder storyboard', (graph) =>
                            moveStoryboardScene(graph, value.id, -1),
                          ),
                      )
                    }
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label={`Move scene ${value.name} later`}
                    disabled={page * 25 + offset + 1 === definition.scenes.length}
                    onClick={() =>
                      void run(() =>
                        useEditor
                          .getState()
                          .command('Reorder storyboard', (graph) =>
                            moveStoryboardScene(graph, value.id, 1),
                          ),
                      )
                    }
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label={`Delete scene ${value.name}`}
                    onClick={() =>
                      void run(() =>
                        useEditor
                          .getState()
                          .command('Remove storyboard scene', (graph) =>
                            removeStoryboardScene(graph, value.id),
                          ),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ol>
            {definition.scenes.length > 25 && (
              <div className="storyboard-actions">
                <button disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous scenes
                </button>
                <span>
                  {page + 1} / {Math.ceil(definition.scenes.length / 25)}
                </span>
                <button
                  disabled={(page + 1) * 25 >= definition.scenes.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next scenes
                </button>
              </div>
            )}
          </>
        )}
        {draft && (
          <div className="storyboard-draft">
            <label>
              Scene name
              <input
                aria-label="Scene name"
                value={draft.name}
                maxLength={200}
                onChange={(event) => change('name', event.target.value)}
              />
            </label>
            <label>
              Scene narration
              <textarea
                aria-label="Scene narration"
                rows={4}
                value={draft.narration}
                maxLength={STORYBOARD_NARRATION_LIMIT}
                onChange={(event) => change('narration', event.target.value)}
              />
            </label>
            <small className="muted">
              Read aloud and shown as subtitles. Node descriptions remain separate.{' '}
              {draft.narration.length.toLocaleString()} / 12,000 characters.
            </small>
            <div className="storyboard-timing">
              <label>
                Seconds
                <input
                  aria-label="Scene seconds"
                  type="number"
                  min={2}
                  max={600}
                  value={draft.seconds}
                  onChange={(event) => change('seconds', Number(event.target.value))}
                />
              </label>
              <label>
                Transition (ms)
                <input
                  aria-label="Scene transition milliseconds"
                  type="number"
                  min={0}
                  max={10000}
                  value={draft.transitionMs}
                  onChange={(event) => change('transitionMs', Number(event.target.value))}
                />
              </label>
            </div>
            <div className="storyboard-actions">
              <button onClick={useSelection}>Use current selection</button>
              <span>
                {draft.nodeIds.length} nodes · {draft.edgeIds.length} links
              </span>
            </div>
            <details>
              <summary>Choose scene objects</summary>
              <label>
                Find nodes
                <input
                  aria-label="Find scene nodes"
                  value={nodeSearch}
                  onChange={(event) => setNodeSearch(event.target.value)}
                />
              </label>
              <div className="storyboard-object-list">
                {nodeResults.slice(0, 150).map((node) => (
                  <label key={node.id}>
                    <input
                      type="checkbox"
                      checked={draft.nodeIds.includes(node.id)}
                      onChange={() => toggle('nodeIds', node.id)}
                    />
                    <span>{node.title}</span>
                  </label>
                ))}
              </div>
              {nodeResults.length > 150 && (
                <small>
                  Showing 150 of {nodeResults.length.toLocaleString()} nodes. Search to narrow the
                  list.
                </small>
              )}
              <label>
                Find links
                <input
                  aria-label="Find scene links"
                  value={edgeSearch}
                  onChange={(event) => setEdgeSearch(event.target.value)}
                />
              </label>
              <div className="storyboard-object-list">
                {edgeResults.slice(0, 150).map((edge) => (
                  <label key={edge.id}>
                    <input
                      type="checkbox"
                      checked={draft.edgeIds.includes(edge.id)}
                      onChange={() => toggle('edgeIds', edge.id)}
                    />
                    <span>
                      {edge.label ||
                        `${byId.get(edge.sourceNodeId)} → ${byId.get(edge.targetNodeId)}`}
                    </span>
                  </label>
                ))}
              </div>
              {edgeResults.length > 150 && (
                <small>
                  Showing 150 of {edgeResults.length.toLocaleString()} links. Search to narrow the
                  list.
                </small>
              )}
            </details>
            <div className="storyboard-actions">
              <button
                disabled={overview}
                title={overview ? STORYBOARD_OVERVIEW_VIEW_MESSAGE : undefined}
                onClick={() =>
                  void run(async () => {
                    const current = useEditor.getState().graph;
                    if (!current) return;
                    assertStoryboardCameraAvailable(current);
                    change('view', await capturePresentationView());
                  })
                }
              >
                <Camera size={15} /> Capture current view
              </button>
              <button disabled={!draft.view} onClick={() => change('view', undefined)}>
                Auto-fit objects
              </button>
              <span>
                {draft.view
                  ? `Saved ${draft.view.mode.toUpperCase()} view`
                  : 'Fits objects in the current 2D or 3D view'}
              </span>
            </div>
            {overview && (
              <small className="muted" role="note">
                {STORYBOARD_OVERVIEW_VIEW_MESSAGE}
              </small>
            )}
            <div className="storyboard-actions">
              <button className="primary" onClick={() => void save()}>
                <Save size={15} /> Save scene
              </button>
              <button
                onClick={() =>
                  void run(() => {
                    presentation.open('storyboard');
                    return presentation.seek(
                      definition.scenes.findIndex((value) => value.id === draft.id),
                    );
                  })
                }
              >
                <Eye size={15} /> Preview saved scene
              </button>
            </div>
            <small className="muted">
              Preview uses the saved scene. A captured view plays in its matching 2D or 3D mode; use
              Auto-fit to play the scene in either mode.
            </small>
          </div>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
