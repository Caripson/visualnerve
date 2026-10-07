/** Short pages keep the complete description readable without covering the diagram. */
export function subtitlePages(
  text: string,
  measure: (text: string) => number,
  width: number,
  linesPerPage = 3,
) {
  if (!Number.isSafeInteger(linesPerPage) || linesPerPage < 1)
    throw new RangeError('Subtitle pages require a positive integer line count.');
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      // Long URLs/identifiers also wrap; never silently lose description text.
      const characters = Array.from(word);
      let offset = 0;
      while (offset < characters.length) {
        let low = 1;
        let high = characters.length - offset;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (measure(characters.slice(offset, offset + middle).join('')) <= width) low = middle;
          else high = middle - 1;
        }
        const piece = characters.slice(offset, offset + low).join('');
        if (line && measure(`${line} ${piece}`) > width) {
          lines.push(line);
          line = '';
        }
        line = line ? `${line} ${piece}` : piece;
        offset += low;
        if (offset < characters.length) {
          lines.push(line);
          line = '';
        }
      }
    }
    if (line) lines.push(line);
  }
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += linesPerPage)
    pages.push(lines.slice(index, index + linesPerPage));
  return pages;
}
export function drawVideoCaption(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  number: string,
  lines: string[],
) {
  context.save();
  context.font = '600 22px system-ui, sans-serif';
  context.fillStyle = '#10251ee8';
  context.fillRect(0, 0, width, 54);
  context.fillStyle = '#ffffff';
  context.textBaseline = 'middle';
  context.fillText(`${number} · ${title}`, 24, 27, width - 48);
  if (lines.length) {
    const boxHeight = 24 + lines.length * 30;
    context.fillStyle = '#10251eee';
    context.fillRect(24, height - boxHeight - 18, width - 48, boxHeight);
    context.font = '22px system-ui, sans-serif';
    context.fillStyle = '#ffffff';
    lines.forEach((line, index) =>
      context.fillText(line, 40, height - boxHeight - 6 + index * 30 + 15),
    );
  }
  context.restore();
}
