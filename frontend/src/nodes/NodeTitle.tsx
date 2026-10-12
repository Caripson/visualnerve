import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { useEditor } from '../state/editor';
import './node-title.css';

/** Titles use the same draft/commit lifecycle as mind-map editing and the save queue. */
export function NodeTitle({
  id,
  title,
  exporting = false,
  readonly = false,
  mindmap = false,
}: {
  id: string;
  title: string;
  exporting?: boolean;
  readonly?: boolean;
  mindmap?: boolean;
}) {
  const { t } = useI18n();
  const editing = useEditor((state) => state.editingNode === id);
  const draft = useEditor((state) => (state.editingNode === id ? state.editingTitle : ''));
  const input = useRef<HTMLTextAreaElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const tap = useRef<{ x: number; y: number; time: number } | undefined>(undefined);
  const releaseTouch = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => releaseTouch.current?.(), []);
  useEffect(() => {
    if (!editing || exporting || readonly) return;
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, exporting, readonly]);
  const begin = () => {
    if (!readonly && !exporting) useEditor.getState().beginEditing(id);
  };
  const finish = (save: boolean) => {
    if (useEditor.getState().editingNode !== id) return;
    useEditor.getState().finishEditing(save);
  };
  return (
    <div
      className={`node-title${editing && !exporting && !readonly ? ' is-title-editing' : ''}`}
      title={
        exporting
          ? undefined
          : readonly
            ? title
            : t('editor.mindmap.doubleClickOrF2ToEdit', { topicTitle: title })
      }
      onDoubleClick={(event) => {
        if (!readonly && !exporting) {
          event.stopPropagation();
          begin();
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch' && !event.isPrimary) {
          start.current = undefined;
          tap.current = undefined;
          return;
        }
        if (event.pointerType === 'touch' && event.isPrimary) {
          start.current = { x: event.clientX, y: event.clientY };
          releaseTouch.current?.();
          // A second finger may land outside this title. It must remain a canvas gesture.
          const additionalTouch = (other: PointerEvent) => {
            if (other.pointerType === 'touch' && !other.isPrimary) {
              start.current = undefined;
              tap.current = undefined;
            }
          };
          const pointerId = event.pointerId,
            element = event.currentTarget;
          const released = (other: PointerEvent) => {
            if (other.pointerId !== pointerId) return;
            releaseTouch.current?.();
            releaseTouch.current = undefined;
            if (other.type === 'pointercancel' || !element.contains(other.target as Node)) {
              start.current = undefined;
              tap.current = undefined;
            }
          };
          document.addEventListener('pointerdown', additionalTouch, true);
          document.addEventListener('pointerup', released, true);
          document.addEventListener('pointercancel', released, true);
          releaseTouch.current = () => {
            document.removeEventListener('pointerdown', additionalTouch, true);
            document.removeEventListener('pointerup', released, true);
            document.removeEventListener('pointercancel', released, true);
          };
        }
      }}
      onPointerUp={(event) => {
        releaseTouch.current?.();
        releaseTouch.current = undefined;
        const down = start.current;
        start.current = undefined;
        if (
          event.pointerType !== 'touch' ||
          !event.isPrimary ||
          !down ||
          editing ||
          readonly ||
          exporting
        )
          return;
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
          tap.current = undefined;
          return;
        }
        const previous = tap.current,
          time = event.timeStamp;
        tap.current = { x: event.clientX, y: event.clientY, time };
        if (
          previous &&
          time - previous.time < 350 &&
          Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 12
        ) {
          tap.current = undefined;
          event.preventDefault();
          event.stopPropagation();
          begin();
        }
      }}
      onPointerCancel={() => {
        releaseTouch.current?.();
        releaseTouch.current = undefined;
        start.current = undefined;
        tap.current = undefined;
      }}
    >
      {editing && !exporting && !readonly ? (
        <textarea
          ref={input}
          className="node-title-input nodrag nopan nowheel"
          aria-label={t('editor.properties.nodeTitle')}
          rows={3}
          maxLength={300}
          value={draft}
          spellCheck={false}
          onChange={(event) => useEditor.setState({ editingTitle: event.target.value })}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              finish(true);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              finish(false);
            }
            if (event.key === 'Tab' && mindmap) {
              event.preventDefault();
              finish(true);
              useEditor.getState().select([id]);
              const child = useEditor.getState().child();
              if (child) useEditor.getState().beginEditing(child);
            }
          }}
        />
      ) : (
        title
      )}
    </div>
  );
}
