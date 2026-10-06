import { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Captions,
  Download,
  X,
  ListOrdered,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useEditor } from '../state/editor';
import { getSpatialView } from '../spatial/types';
import {
  autoNumber,
  assignPresentationNumber,
  getPresentation,
  setPresentation,
} from './definition';
import { presentation, usePresentation } from './service';
import { VideoControls } from './VideoControls';
import { useVideoExport, videoExport, isVideoExporting } from './video-service';
import { getStoryboard } from './storyboard';
import { presentationSteps } from './sequence';
import { StoryboardEditor } from './StoryboardEditor';
import './presentation.css';

/** Kept outside App: watches graph revisions and renders a compact canvas overlay. */
export function PresentationFeature() {
  const graph = useEditor((state) => state.graph);
  const player = usePresentation();
  const video = useVideoExport();
  const exporting = isVideoExporting();
  const [ordering, setOrdering] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  useEffect(
    () => setPage((previous) => Math.min(previous, Math.max(0, Math.ceil(player.total / 25) - 1))),
    [player.total],
  );
  useEffect(() => {
    const fingerprint = () => {
      const state = useEditor.getState();
      const graph = state.graph;
      return graph
        ? JSON.stringify([
            graph.diagram.id,
            getPresentation(graph),
            getStoryboard(graph),
            graph.edges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId, edge.label]),
            getSpatialView(graph).mode,
            graph.nodes.map((node) => [
              node.id,
              node.title,
              node.description,
              node.x,
              node.y,
              node.width,
              node.height,
              node.parentId,
              node.collapsed,
              node.metadata.spatial,
            ]),
          ])
        : '';
    };
    let previous = fingerprint();
    let previousGraph = useEditor.getState().graph;
    const unsubscribe = useEditor.subscribe((state) => {
      if (!state.privacyAcknowledged) {
        presentation.close();
        return;
      }
      if (state.graph === previousGraph) return;
      previousGraph = state.graph;
      const next = fingerprint();
      if (next !== previous) {
        previous = next;
        presentation.changed();
      }
    });
    const interrupt = () => presentation.pause('Camera taken over. Press Play to continue.', true);
    const hidden = () => {
      if (document.hidden) presentation.pause('Playback paused while this tab is hidden.');
    };
    window.addEventListener('visualnerve:presentation-interrupted', interrupt);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe();
      window.removeEventListener('visualnerve:presentation-interrupted', interrupt);
      document.removeEventListener('visibilitychange', hidden);
      presentation.close();
      videoExport.cancel();
    };
  }, []);
  if (!graph || !player.open || graph.diagram.id !== player.diagramId) return null;
  const definition = getPresentation(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const source = exporting ? video.source : player.source;
  const steps = presentationSteps(graph, source);
  const current = steps[exporting ? video.nodeIndex : player.index];
  const total = exporting ? video.total : player.total;
  const running = ['loading', 'moving', 'playing'].includes(player.status);
  const run = async (action: () => unknown) => {
    try {
      setError('');
      await action();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const number = (selected = false) => {
    void run(() => {
      useEditor
        .getState()
        .command('Number walkthrough nodes', (current) =>
          autoNumber(current, selected ? useEditor.getState().selectedNodes : undefined),
        );
      setPage(0);
    });
  };
  const changeTiming = (key: 'secondsPerNode' | 'transitionMs', value: number) =>
    run(() =>
      useEditor
        .getState()
        .command('Walkthrough timing', (current) =>
          setPresentation(current, { ...getPresentation(current), [key]: value }),
        ),
    );
  return (
    <section
      className="presentation-player"
      aria-label="Diagram player"
      data-status={player.status}
    >
      <div className="presentation-heading">
        <ListOrdered size={16} />
        <strong>Diagram walkthrough</strong>
        <span>
          {total
            ? `${(exporting ? Math.max(0, video.nodeIndex) : player.index) + 1} / ${total}`
            : source === 'storyboard'
              ? 'No scenes'
              : 'No numbered nodes'}
        </span>
        <button
          className="icon-button"
          aria-label="Close diagram player"
          onClick={() => {
            videoExport.cancel();
            presentation.close();
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="presentation-order-actions" aria-label="Walkthrough source">
        <button
          disabled={exporting}
          aria-pressed={source === 'nodes'}
          onClick={() => void run(() => presentation.open('nodes'))}
        >
          Numbered nodes
        </button>
        <button
          disabled={exporting}
          aria-pressed={source === 'storyboard'}
          onClick={() => void run(() => presentation.open('storyboard'))}
        >
          Storyboard scenes
        </button>
      </div>
      <div className="presentation-current">
        <strong>
          {current?.name ??
            (source === 'storyboard'
              ? 'Create a storyboard scene'
              : 'Choose the walkthrough order')}
        </strong>
      </div>
      {player.subtitles && current?.narration && (
        <div className="presentation-subtitle" aria-label="Walkthrough subtitles">
          {current.narration}
        </div>
      )}
      <fieldset className="presentation-control-fieldset" disabled={exporting}>
        <div className="presentation-controls">
          <button
            aria-label="Rewind presentation"
            disabled={!player.total || player.index <= 0}
            onClick={() => void run(() => presentation.skip(-1))}
          >
            <SkipBack size={18} />
          </button>
          <button
            className="primary"
            aria-label={running ? 'Pause presentation' : 'Play presentation'}
            disabled={!player.total}
            onClick={() => void run(() => (running ? presentation.pause() : presentation.play()))}
          >
            {running ? <Pause size={18} /> : <Play size={18} />}
            <span>{running ? 'Pause' : player.status === 'ended' ? 'Replay' : 'Play'}</span>
          </button>
          <button
            aria-label="Forward presentation"
            disabled={!player.total || player.index + 1 >= player.total}
            onClick={() => void run(() => presentation.skip(1))}
          >
            <SkipForward size={18} />
          </button>
          <button
            aria-label="Presentation audio"
            title="Read step narration aloud"
            aria-pressed={player.audio}
            onClick={() => presentation.options({ audio: !player.audio })}
          >
            {player.audio ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            aria-label="Presentation subtitles"
            title="Show step narration"
            aria-pressed={player.subtitles}
            onClick={() => presentation.options({ subtitles: !player.subtitles })}
          >
            <Captions size={18} />
          </button>
          <button
            aria-label="Preload presentation"
            title="Prepare the selected voice and next three descriptions"
            aria-pressed={player.preload}
            disabled={!player.total}
            onClick={() =>
              void run(() =>
                player.preload ? presentation.options({ preload: false }) : presentation.preload(),
              )
            }
          >
            <Download size={16} />
            <span>Preload</span>
          </button>
          <button aria-expanded={ordering} onClick={() => setOrdering(!ordering)}>
            Order
          </button>
        </div>
      </fieldset>
      <VideoControls disabled={!player.total} />
      {(player.audio || player.preload) && (
        <small className="muted">
          Local neural voice · choose English or Swedish in Settings. First use downloads 60–109
          MiB.
        </small>
      )}
      {(player.message.startsWith('Preload ') || (player.status === 'loading' && player.audio)) && (
        <div className="presentation-preparation">
          <span>
            {player.message.startsWith('Preload ')
              ? `Preload ${Math.floor(player.progress * 100)}%`
              : 'Voice preparation'}
          </span>
          <progress
            aria-label={
              player.message.startsWith('Preload ')
                ? 'Preload progress'
                : 'Presentation preparation'
            }
            max="1"
            value={
              player.message.startsWith('Preload ') || player.progress > 0
                ? player.progress
                : undefined
            }
          />
        </div>
      )}
      {(error || player.message) && (
        <p
          className="presentation-message"
          role={error || player.status === 'error' ? 'alert' : 'status'}
        >
          {error || player.message}
        </p>
      )}
      {source === 'storyboard' && (ordering || !player.total) && (
        <StoryboardEditor disabled={exporting} />
      )}
      {!exporting && source === 'nodes' && (ordering || !player.total) && (
        <div className="presentation-order">
          <div className="presentation-order-actions">
            <button onClick={() => number()}>Number all nodes</button>
            <button
              disabled={!useEditor.getState().selectedNodes.length}
              onClick={() => number(true)}
            >
              Number selection
            </button>
            <button
              disabled={!player.total}
              onClick={() =>
                useEditor
                  .getState()
                  .command('Clear walkthrough', (current) =>
                    setPresentation(current, { ...getPresentation(current), nodeIds: [] }),
                  )
              }
            >
              Clear
            </button>
          </div>
          <div className="presentation-timing">
            <label>
              Seconds per node
              <input
                aria-label="Seconds per node"
                type="number"
                min="2"
                max="600"
                key={`seconds:${definition.secondsPerNode}`}
                defaultValue={definition.secondsPerNode}
                onBlur={(event) => void changeTiming('secondsPerNode', Number(event.target.value))}
              />
            </label>
            <label>
              Camera movement (ms)
              <input
                aria-label="Camera movement milliseconds"
                type="number"
                min="0"
                max="10000"
                key={`transition:${definition.transitionMs}`}
                defaultValue={definition.transitionMs}
                onBlur={(event) => void changeTiming('transitionMs', Number(event.target.value))}
              />
            </label>
          </div>
          <small className="muted">
            Audio finishes before advancing. Hidden or collapsed nodes must be made visible to play.
          </small>
          <ol start={page * 25 + 1}>
            {definition.nodeIds.slice(page * 25, page * 25 + 25).map((id, offset) => (
              <li key={id}>
                <span>{byId.get(id)?.title}</span>
                <button
                  aria-label={`Move ${byId.get(id)?.title} earlier`}
                  disabled={page * 25 + offset === 0}
                  onClick={() =>
                    useEditor
                      .getState()
                      .command('Reorder walkthrough', (current) =>
                        assignPresentationNumber(current, id, page * 25 + offset),
                      )
                  }
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  aria-label={`Move ${byId.get(id)?.title} later`}
                  disabled={page * 25 + offset + 1 >= player.total}
                  onClick={() =>
                    useEditor
                      .getState()
                      .command('Reorder walkthrough', (current) =>
                        assignPresentationNumber(current, id, page * 25 + offset + 2),
                      )
                  }
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  aria-label={`Remove ${byId.get(id)?.title} from presentation`}
                  onClick={() =>
                    useEditor
                      .getState()
                      .command('Remove walkthrough node', (current) =>
                        assignPresentationNumber(current, id, null),
                      )
                  }
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ol>
          {definition.nodeIds.length > 25 && (
            <div className="presentation-order-actions">
              <button disabled={!page} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page + 1} / {Math.ceil(definition.nodeIds.length / 25)}
              </span>
              <button
                disabled={(page + 1) * 25 >= definition.nodeIds.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
