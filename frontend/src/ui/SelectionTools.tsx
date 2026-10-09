import { paletteLabel, statusLabel as displayStatus } from './editor-labels';
import { useI18n } from '../i18n';
import {
  Copy,
  Pencil,
  Trash2,
  Palette,
  GitBranch,
  ListTodo,
  CircleCheck,
  RotateCcw,
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useEditor } from '../state/editor';
import { colorPalette } from './colors';
import { IconPicker, iconKey, withIcon } from './icons';
import { nodeStatuses } from './status';

export function SelectionTools() {
  const { t } = useI18n();
  const graph = useEditor((state) => state.graph);
  const nodes = useEditor((state) => state.selectedNodes);
  const edges = useEditor((state) => state.selectedEdges);
  const tools = useRef<HTMLDivElement>(null);
  const visible = !!graph && (nodes.length > 0 || edges.length > 0);
  useLayoutEffect(() => {
    if (!visible) return;
    const toolbar = tools.current?.closest<HTMLElement>('.context-toolbar');
    const canvas = tools.current?.closest<HTMLElement>('.canvas-shell');
    if (!toolbar || !canvas) return;
    const measure = () => {
      canvas.style.setProperty('--selection-toolbar-height', `${toolbar.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => {
      observer.disconnect();
      canvas.style.removeProperty('--selection-toolbar-height');
    };
  }, [visible]);
  if (!graph || (!nodes.length && !edges.length)) return null;
  const selected = new Set(nodes);
  const objects = graph.nodes.filter((node) => selected.has(node.id));
  const first = objects[0];
  const statuses = [...new Set(objects.map((node) => node.status ?? ''))];
  const allDone = objects.length > 0 && statuses.length === 1 && statuses[0] === 'done';
  let mixedValue = '__mixed_status__';
  while (statuses.includes(mixedValue)) mixedValue += '_';
  const canBranch =
    graph.diagram.type === 'mindmap' &&
    first &&
    graph.nodes.some((node) => node.parentId === first.id);
  const color = (value: string) =>
    useEditor.getState().command('Color selection', (g) => ({
      ...g,
      nodes: g.nodes.map((node) => (selected.has(node.id) ? { ...node, color: value } : node)),
    }));
  const status = (value: string) =>
    useEditor.getState().command('Set object status', (g) => ({
      ...g,
      nodes: g.nodes.map((node) => (selected.has(node.id) ? { ...node, status: value } : node)),
    }));
  return (
    <div
      ref={tools}
      className="selection-tools"
      aria-label={t('editor.selection.selectionActions')}
    >
      <button
        aria-label={t('editor.selection.editSelectedItem')}
        title={t('editor.selection.editItem')}
        onClick={() => {
          useEditor.setState({ mobilePanel: 'details' });
          requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('.properties input')?.focus();
          });
        }}
      >
        <Pencil size={17} />
        <span>{t('editor.selection.edit')}</span>
      </button>
      {first && (
        <>
          <details className="quick-picker status-picker">
            <summary
              aria-label={t('editor.selection.chooseStatus')}
              title={t('editor.properties.status')}
            >
              <ListTodo size={17} />
              <span>{t('editor.properties.status')}</span>
            </summary>
            <div className="picker-panel status-picker-panel">
              <label>
                {objects.length === 1
                  ? t('editor.selection.status.one')
                  : t('editor.selection.status.other', { count: objects.length })}
                <select
                  aria-label={t('editor.selection.selectionStatus')}
                  value={statuses.length > 1 ? mixedValue : statuses[0]}
                  onChange={(e) => {
                    status(e.target.value);
                    const picker = e.currentTarget.closest('details');
                    picker?.removeAttribute('open');
                    picker?.querySelector('summary')?.focus();
                  }}
                >
                  {statuses.length > 1 && (
                    <option value={mixedValue} disabled>
                      {t('editor.selection.mixedStatuses')}
                    </option>
                  )}
                  <option value="">{t('editor.properties.none')}</option>
                  {nodeStatuses.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {displayStatus(t, choice.value)}
                    </option>
                  ))}
                  {statuses
                    .filter(
                      (value) => value && !nodeStatuses.some((choice) => choice.value === value),
                    )
                    .map((value) => (
                      <option key={value} value={value}>
                        {displayStatus(t, value)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </details>
          <button
            className={`completion-action ${allDone ? 'is-done' : ''}`}
            aria-label={
              allDone
                ? t('editor.selection.reopenSelectedObjects')
                : t('editor.selection.markSelectedObjectsDone')
            }
            title={
              allDone ? t('editor.selection.reopenAsInProgress') : t('editor.selection.markAsDone')
            }
            onClick={() => status(allDone ? 'in-progress' : 'done')}
          >
            {allDone ? <RotateCcw size={17} /> : <CircleCheck size={17} />}
            <span>{allDone ? t('editor.selection.reopen') : t('editor.selection.done')}</span>
          </button>
          <details className="quick-picker color-picker">
            <summary
              aria-label={t('editor.selection.chooseColor')}
              title={t('editor.properties.color')}
            >
              <Palette size={17} />
              <span>{t('editor.properties.color')}</span>
            </summary>
            <div className="picker-panel" role="group" aria-label={t('editor.selection.colors')}>
              <div className="color-grid">
                {colorPalette.map((choice) => (
                  <button
                    key={choice.value}
                    aria-label={t('editor.selection.color', {
                      colorLabel: paletteLabel(t, choice.value),
                    })}
                    title={paletteLabel(t, choice.value)}
                    style={{ background: choice.value }}
                    onClick={(e) => {
                      color(choice.value);
                      e.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  />
                ))}
              </div>
              <label className="custom-color">
                {t('editor.selection.customColor')}{' '}
                <input
                  aria-label={t('editor.selection.customSelectionColor')}
                  type="color"
                  value={first.color || '#23664d'}
                  onChange={(e) => color(e.target.value)}
                />
              </label>
            </div>
          </details>
          <IconPicker
            value={iconKey(first.metadata)}
            onChange={(icon) =>
              useEditor.getState().command('Icon selection', (g) => ({
                ...g,
                nodes: g.nodes.map((node) =>
                  selected.has(node.id)
                    ? { ...node, metadata: withIcon(node.metadata, icon) }
                    : node,
                ),
              }))
            }
          />
          <button
            aria-label={t('editor.selection.duplicateSelection')}
            title={t('editor.selection.duplicateCtrlCmdD')}
            onClick={() => {
              const clip = useEditor.getState().copy();
              if (clip) useEditor.getState().paste(clip);
            }}
          >
            <Copy size={17} />
          </button>
        </>
      )}
      <button
        className="danger"
        aria-label={t('editor.properties.deleteSelection')}
        title={t('editor.selection.deleteSelectionDeleteBackspace')}
        onClick={() => useEditor.getState().remove()}
      >
        <Trash2 size={17} />
        <span>{t('editor.selection.delete')}</span>
      </button>
      {canBranch && (
        <button
          className="danger delete-branch"
          aria-label={t('editor.selection.deleteBranch')}
          title={t('editor.selection.deleteTopicAndAllSubtopicsShiftDelete')}
          onClick={() => useEditor.getState().remove(true)}
        >
          <GitBranch size={17} />
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
