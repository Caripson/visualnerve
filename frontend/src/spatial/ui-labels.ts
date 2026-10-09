import type { Translate } from '../i18n';
import type { SpatialNavigationAxis, SpatialNavigationMode } from './navigation';

export const orientationKeys = {
  front: { label: 'spatial.front', aria: 'spatial.frontView' },
  back: { label: 'spatial.back', aria: 'spatial.backView' },
  left: { label: 'spatial.left', aria: 'spatial.leftView' },
  right: { label: 'spatial.right', aria: 'spatial.rightView' },
  top: { label: 'spatial.top', aria: 'spatial.topView' },
} as const;

export const controlModeKeys = {
  move: {
    label: 'spatial.moveMode',
    aria: 'spatial.moveView',
    handles: 'spatial.moveHandlesAria',
    free: 'spatial.moveFreely',
    axis: 'spatial.moveAlongAxis',
  },
  rotate: {
    label: 'spatial.rotateMode',
    aria: 'spatial.rotateView',
    handles: 'spatial.rotateHandlesAria',
    free: 'spatial.rotateFreely',
    axis: 'spatial.rotateAroundAxis',
  },
  scale: {
    label: 'spatial.scaleMode',
    aria: 'spatial.scaleView',
    handles: 'spatial.scaleHandlesAria',
    free: 'spatial.scaleFreely',
    axis: 'spatial.scaleAlongAxis',
  },
} as const;

export function controlLabel(
  t: Translate,
  mode: SpatialNavigationMode,
  axis: SpatialNavigationAxis,
) {
  return axis === 'free'
    ? t(controlModeKeys[mode].free)
    : t(controlModeKeys[mode].axis, { axis: axis.toUpperCase() });
}
