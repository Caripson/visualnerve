import { presentationMessage } from './display-messages';
import { useI18n } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useEditor } from '../state/editor';
import {
  autoNumber,
  assignPresentationNumber,
  getPresentation,
  setPresentation,
} from './definition';
import { presentation, usePresentation } from './service';
import { VideoControls } from './VideoControls';
import { useVideoExport, videoExport, isVideoExporting } from './video-service';
import { presentationSteps } from './sequence';
import { StoryboardEditor } from './StoryboardEditor';
import { PlayerSubtitles } from './PlayerSubtitles';
import './presentation.css';
import { useCompactLayout } from '../hooks/useCompactLayout';

export { PresentationFeature } from './PresentationFeature';

/** Optional player UI; graph and privacy lifecycle belong to its always-mounted controller. */
export function PresentationPlayerView() {
  const { t } = useI18n();
  const graph = useEditor((state) => state.graph);
  const player = usePresentation();
  const video = useVideoExport();
  const exporting = isVideoExporting();
  const [ordering, setOrdering] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const compact = useCompactLayout();
  const minimized = player.minimized && player.total > 0 && !exporting;
  const dock = useRef<HTMLElement>(null);
  const [narrowDock, setNarrowDock] = useState(false);
  const [captionBottom, setCaptionBottom] = useState(140);
  useLayoutEffect(() => {
    const element = dock.current;
    const canvas = element?.parentElement;
    if (!element || !canvas || !minimized || !player.open) return;
    const position = () => {
      setNarrowDock(element.clientWidth < 600);
      const clearance =
        canvas.getBoundingClientRect().bottom - element.getBoundingClientRect().top + 12;
      setCaptionBottom(clearance);
      canvas.style.setProperty(
        '--presentation-controls-offset',
        `${clearance + (player.subtitles && player.narration.trim() ? 80 : 0)}px`,
      );
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(element);
    observer?.observe(canvas);
    window.addEventListener('resize', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      canvas.style.removeProperty('--presentation-controls-offset');
    };
  }, [minimized, player.open, player.diagramId, player.subtitles, player.narration]);
  useEffect(
    () => setPage((previous) => Math.min(previous, Math.max(0, Math.ceil(player.total / 25) - 1))),
    [player.total],
  );

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
    <>
      <section
        ref={dock}
        className="presentation-player"
        aria-label={t('presentation.playerRegion')}
        data-status={player.status}
        data-minimized={minimized}
        data-narrow={narrowDock}
      >
        <div className="presentation-heading">
          <ListOrdered size={16} />
          <strong>
            {compact
              ? t('presentation.walkthroughCompactTitle')
              : t('presentation.walkthroughTitle')}
          </strong>
          <span>
            {total
              ? t('presentation.stepCounter', {
                  current: (exporting ? Math.max(0, video.nodeIndex) : player.index) + 1,
                  total,
                })
              : source === 'storyboard'
                ? t('presentation.noScenes')
                : t('presentation.noNumberedNodes')}
          </span>
          {player.total > 0 && !exporting && (
            <button
              className="icon-button"
              aria-label={
                minimized ? t('presentation.expandPlayer') : t('presentation.minimizePlayer')
              }
              aria-expanded={!minimized}
              title={minimized ? t('presentation.expandPlayer') : t('presentation.minimizePlayer')}
              onClick={() => presentation.options({ minimized: !minimized })}
            >
              {minimized ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={t('presentation.closePlayer')}
            onClick={() => {
              videoExport.cancel();
              presentation.close();
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div
          className="presentation-order-actions presentation-secondary"
          aria-label={t('presentation.walkthroughSource')}
        >
          <button
            disabled={exporting}
            aria-pressed={source === 'nodes'}
            onClick={() => void run(() => presentation.open('nodes'))}
          >
            {t('presentation.numberedNodesSource')}
          </button>
          <button
            disabled={exporting}
            aria-pressed={source === 'storyboard'}
            onClick={() => void run(() => presentation.open('storyboard'))}
          >
            {t('presentation.storyboardSource')}
          </button>
        </div>
        <div className="presentation-current" title={current?.name}>
          <strong>
            {current?.name ??
              (source === 'storyboard'
                ? t('presentation.createStoryboardHint')
                : t('presentation.chooseOrderHint'))}
          </strong>
        </div>
        {!minimized && player.subtitles && current?.narration && (
          <div className="presentation-subtitle" aria-label={t('presentation.subtitlesRegion')}>
            {current.narration}
          </div>
        )}
        <fieldset className="presentation-control-fieldset" disabled={exporting}>
          <div className="presentation-controls">
            <button
              aria-label={t('presentation.rewindAction')}
              disabled={!player.total || player.index <= 0}
              onClick={() => void run(() => presentation.skip(-1))}
            >
              <SkipBack size={18} />
            </button>
            <button
              className="primary"
              aria-label={running ? t('presentation.pauseAction') : t('presentation.playAction')}
              disabled={!player.total}
              onClick={() => void run(() => (running ? presentation.pause() : presentation.play()))}
            >
              {running ? <Pause size={18} /> : <Play size={18} />}
              <span>
                {running
                  ? t('presentation.pause')
                  : player.status === 'ended'
                    ? t('presentation.replay')
                    : t('presentation.play')}
              </span>
            </button>
            <button
              aria-label={t('presentation.forwardAction')}
              disabled={!player.total || player.index + 1 >= player.total}
              onClick={() => void run(() => presentation.skip(1))}
            >
              <SkipForward size={18} />
            </button>
            <button
              aria-label={t('presentation.audioToggle')}
              title={t('presentation.audioToggleHint')}
              aria-pressed={player.audio}
              onClick={() => presentation.options({ audio: !player.audio })}
            >
              {player.audio ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              aria-label={t('presentation.subtitlesToggle')}
              title={t('presentation.subtitlesToggleHint')}
              aria-pressed={player.subtitles}
              onClick={() => presentation.options({ subtitles: !player.subtitles })}
            >
              <Captions size={18} />
            </button>
            <button
              className="presentation-secondary"
              aria-label={t('presentation.preloadAction')}
              title={t('presentation.preloadHint')}
              aria-pressed={player.preload}
              disabled={!player.total}
              onClick={() =>
                void run(() =>
                  player.preload
                    ? presentation.options({ preload: false })
                    : presentation.preload(),
                )
              }
            >
              <Download size={16} />
              <span>{t('presentation.preload')}</span>
            </button>
            <button
              className="presentation-secondary"
              aria-expanded={ordering}
              onClick={() => setOrdering(!ordering)}
            >
              {t('presentation.orderTab')}
            </button>
          </div>
        </fieldset>
        <VideoControls disabled={!player.total} />
        {(player.audio || player.preload) && (
          <small className="muted presentation-secondary">{t('presentation.localVoiceHint')}</small>
        )}
        {(player.message.startsWith('Preload ') ||
          (player.status === 'loading' && player.audio)) && (
          <div className="presentation-preparation">
            <span>
              {player.message.startsWith('Preload ')
                ? t('presentation.preloadPercent', { percent: Math.floor(player.progress * 100) })
                : t('presentation.voicePreparation')}
            </span>
            <progress
              aria-label={
                player.message.startsWith('Preload ')
                  ? t('presentation.preloadProgress')
                  : t('presentation.preparationProgress')
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
            {presentationMessage(error || player.message, t)}
          </p>
        )}
        {source === 'storyboard' && (ordering || !player.total) && (
          <StoryboardEditor disabled={exporting} />
        )}
        {!exporting && source === 'nodes' && (ordering || !player.total) && (
          <div className="presentation-order">
            <div className="presentation-order-actions">
              <button onClick={() => number()}>{t('presentation.numberAllAction')}</button>
              <button
                disabled={!useEditor.getState().selectedNodes.length}
                onClick={() => number(true)}
              >
                {t('presentation.numberSelectionAction')}
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
                {t('presentation.clear')}
              </button>
            </div>
            <div className="presentation-timing">
              <label>
                {t('presentation.secondsPerNode')}
                <input
                  aria-label={t('presentation.secondsPerNode')}
                  type="number"
                  min="2"
                  max="600"
                  key={`seconds:${definition.secondsPerNode}`}
                  defaultValue={definition.secondsPerNode}
                  onBlur={(event) =>
                    void changeTiming('secondsPerNode', Number(event.target.value))
                  }
                />
              </label>
              <label>
                {t('presentation.cameraMovementField')}
                <input
                  aria-label={t('presentation.cameraMovementAria')}
                  type="number"
                  min="0"
                  max="10000"
                  key={`transition:${definition.transitionMs}`}
                  defaultValue={definition.transitionMs}
                  onBlur={(event) => void changeTiming('transitionMs', Number(event.target.value))}
                />
              </label>
            </div>
            <small className="muted">{t('presentation.audioAdvanceHint')}</small>
            <ol start={page * 25 + 1}>
              {definition.nodeIds.slice(page * 25, page * 25 + 25).map((id, offset) => (
                <li key={id}>
                  <span>{byId.get(id)?.title}</span>
                  <button
                    aria-label={t('presentation.moveEarlier', { title: byId.get(id)?.title ?? '' })}
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
                    aria-label={t('presentation.moveLater', { title: byId.get(id)?.title ?? '' })}
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
                    aria-label={t('presentation.removeStep', { title: byId.get(id)?.title ?? '' })}
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
                  {t('presentation.previousPage')}
                </button>
                <span>
                  {t('presentation.orderPageCounter', {
                    current: page + 1,
                    total: Math.ceil(definition.nodeIds.length / 25),
                  })}
                </span>
                <button
                  disabled={(page + 1) * 25 >= definition.nodeIds.length}
                  onClick={() => setPage(page + 1)}
                >
                  {t('presentation.nextPage')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      {minimized && player.subtitles && current?.narration && (
        <PlayerSubtitles
          narration={current.narration}
          stepId={current.id}
          status={player.status}
          getPlaybackTime={presentation.getPlaybackTime}
          bottom={captionBottom}
        />
      )}
    </>
  );
}
