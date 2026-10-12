import type { IBMSymbol } from '../flowchart/ibm-symbols';

/** Immediate local face while the full native card texture is being captured. */
export function paintIbmFace(
  context: CanvasRenderingContext2D,
  symbol: IBMSymbol,
  text: string,
  options: { background?: string; color?: string; status?: string },
  back = false,
) {
  const { width, height } = context.canvas;
  const line = (points: readonly (readonly [number, number])[], close = false) => {
    context.beginPath();
    points.forEach(([x, y], index) => {
      const px = (back ? 1 - x : x) * (width - 4) + 2;
      const py = y * (height - 4) + 2;
      if (index) context.lineTo(px, py);
      else context.moveTo(px, py);
    });
    if (close) context.closePath();
  };
  context.fillStyle = options.background ?? '#ffffff';
  context.strokeStyle = options.color ?? '#31766c';
  context.lineWidth = 2;
  line(symbol.outline, true);
  context.fill();
  context.stroke();
  for (const detail of symbol.details) {
    line(detail);
    context.stroke();
  }
  const box = symbol.contentBox;
  const left = (back ? 1 - box.x - box.width : box.x) * width,
    top = box.y * height;
  const boxWidth = box.width * width,
    boxHeight = box.height * height;
  const font = Math.min(40, Math.max(12, boxHeight / 4));
  context.font = `600 ${font}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = options.color ?? '#182c25';
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let value = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = value ? `${value} ${word}` : word;
      if (value && context.measureText(next).width > boxWidth) {
        lines.push(value);
        value = word;
      } else value = next;
    }
    lines.push(value);
  }
  const count = Math.max(1, Math.floor(boxHeight / (font * 1.25)));
  const visible = lines.slice(0, count);
  visible.forEach((value, index) =>
    context.fillText(
      value,
      left + boxWidth / 2,
      top + boxHeight / 2 + (index - (visible.length - 1) / 2) * font * 1.25,
      boxWidth,
    ),
  );
}
