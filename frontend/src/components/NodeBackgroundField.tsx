import { useEffect, useRef, useState } from 'react';
import type { GraphNode } from '../model/types';
import { useI18n } from '../i18n';
import './node-background.css';

const themeColor = () =>
  document.documentElement.dataset.theme === 'dark' ? '#242d27' : '#ffffff';
export function NodeBackgroundField({
  node,
  update,
  onFocusRequested,
}: {
  node: GraphNode;
  update: (patch: Partial<GraphNode>, coalesce?: boolean) => void;
  onFocusRequested?: () => void;
}) {
  const { t } = useI18n();
  const [automatic, setAutomatic] = useState(themeColor);
  const color = node.backgroundColor ?? automatic;
  const [draft, setDraft] = useState(color);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!onFocusRequested) return;
    let frame = requestAnimationFrame(() => {
      // Compact Properties sets its initial focus when the sheet opens.
      frame = requestAnimationFrame(() => {
        picker.current?.focus();
        onFocusRequested();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [onFocusRequested]);
  useEffect(() => setDraft(color), [node.id, color]);
  useEffect(() => {
    const observer = new MutationObserver(() => setAutomatic(themeColor()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  const valid = /^#[\da-f]{6}$/i.test(draft);
  return (
    <section className="node-background-field">
      <label htmlFor={`node-background-${node.id}`}>{t('editor.properties.nodeBackground')}</label>
      <div className="node-background-controls">
        <input
          ref={picker}
          id={`node-background-${node.id}`}
          type="color"
          aria-label={t('editor.properties.nodeBackground')}
          title={`${t('editor.properties.nodeBackground')} (G)`}
          aria-keyshortcuts="G"
          value={color}
          onChange={(event) => update({ backgroundColor: event.target.value })}
        />
        <input
          type="text"
          aria-label="Node background hex color"
          value={draft}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (valid && draft !== color) update({ backgroundColor: draft }, false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid) {
              event.preventDefault();
              update({ backgroundColor: draft }, false);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(color);
            }
          }}
        />
      </div>
      {!valid && <p role="status">Use a six-digit hex color, for example #31766c.</p>}
      <button
        className="full"
        disabled={!node.backgroundColor}
        onClick={() => update({ backgroundColor: undefined }, false)}
      >
        {t('editor.properties.themeBackground')}
      </button>
      <p className="muted">{t('editor.properties.nodeBackgroundHint')}</p>
    </section>
  );
}
