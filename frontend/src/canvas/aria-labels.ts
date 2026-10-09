import type { AriaLabelConfig } from '@xyflow/react';
import type { MessageId, Translate } from '../i18n';
const directionMessages: Record<string, MessageId> = {
  left: 'editor.canvas.accessibility.left',
  right: 'editor.canvas.accessibility.right',
  up: 'editor.canvas.accessibility.up',
  down: 'editor.canvas.accessibility.down',
};
/** Supported ReactFlow configuration, without language-dependent CSS or model labels. */
export function canvasAriaLabels(t: Translate): Partial<AriaLabelConfig> {
  return {
    'node.a11yDescription.default': t('editor.canvas.accessibility.nodeSelection'),
    'node.a11yDescription.keyboardDisabled': t('editor.canvas.accessibility.nodeMovement'),
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
      t('editor.canvas.accessibility.nodeMoved', {
        direction: Object.hasOwn(directionMessages, direction)
          ? t(directionMessages[direction])
          : direction,
        x,
        y,
      }),
    'edge.a11yDescription.default': t('editor.canvas.accessibility.edgeSelection'),
    'controls.ariaLabel': t('editor.canvas.accessibility.controls'),
    'controls.zoomIn.ariaLabel': t('editor.canvas.accessibility.zoomIn'),
    'controls.zoomOut.ariaLabel': t('editor.canvas.accessibility.zoomOut'),
    'controls.fitView.ariaLabel': t('editor.canvas.accessibility.fitView'),
    'controls.interactive.ariaLabel': t('editor.canvas.accessibility.interactive'),
    'minimap.ariaLabel': t('editor.canvas.accessibility.minimap'),
    'handle.ariaLabel': t('editor.canvas.accessibility.handle'),
  };
}
