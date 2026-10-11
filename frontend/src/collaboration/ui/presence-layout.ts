export interface ControlBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function boundsOverlap(a: ControlBounds, b: ControlBounds, gap = 0) {
  return (
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap
  );
}

/** Reserve the lowest available canvas slot, keeping a gap around other controls. */
export function reservePresenceBounds(
  canvas: ControlBounds,
  width: number,
  height: number,
  controls: readonly ControlBounds[],
): ControlBounds | undefined {
  const inset = 12;
  const gap = 8;
  const available = {
    left: canvas.left + inset,
    right: canvas.right - inset,
    top: canvas.top + inset,
    bottom: canvas.bottom - inset,
  };
  if (width > available.right - available.left || height > available.bottom - available.top)
    return undefined;
  const candidatesX = new Set([available.left, available.right - width]);
  const candidatesY = new Set([available.bottom - height]);
  for (const control of controls) {
    candidatesX.add(control.right + gap);
    candidatesX.add(control.left - width - gap);
    candidatesY.add(control.top - height - gap);
  }
  for (const top of [...candidatesY].sort((a, b) => b - a)) {
    for (const left of [...candidatesX].sort((a, b) => a - b)) {
      const slot = { left, top, right: left + width, bottom: top + height };
      if (
        slot.left < available.left ||
        slot.right > available.right ||
        slot.top < available.top ||
        slot.bottom > available.bottom
      )
        continue;
      if (controls.every((control) => !boundsOverlap(slot, control, gap))) return slot;
    }
  }
  return undefined;
}
