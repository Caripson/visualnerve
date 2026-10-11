import type { AnalyticsSeries, Observation } from './types';
import { contiguous } from './series';

/** An observation cannot be known before its observation time. */
export function publicationTime(observation: Observation): string {
  return observation.knownAt && observation.knownAt > observation.time
    ? observation.knownAt
    : observation.time;
}

/** Maximum dependency release over a complete trailing window, in linear time.
 * A null window includes the entire contiguous valid history (recursive indicators).
 * Missing/incomplete values and calendar gaps reset the window; no values are filled.
 */
export function publicationReadiness(
  rows: Observation[],
  series: AnalyticsSeries,
  window: number | null,
  minimum = window ?? 1,
): (string | undefined)[] {
  const ready: (string | undefined)[] = [];
  const queue: { index: number; time: string }[] = [];
  let head = 0,
    count = 0,
    historyRelease = '';
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (
      row.value === null ||
      row.quality !== 'valid' ||
      (window !== 1 && index > 0 && !contiguous(rows[index - 1], row, series))
    ) {
      queue.length = 0;
      head = 0;
      count = 0;
      historyRelease = '';
    }
    if (row.value === null || row.quality !== 'valid') {
      ready.push(undefined);
      continue;
    }
    count++;
    const release = publicationTime(row);
    if (window === null) {
      if (release > historyRelease) historyRelease = release;
      ready.push(count >= minimum ? historyRelease : undefined);
      continue;
    }
    while (queue.length > head && queue.at(-1)!.time <= release) queue.pop();
    queue.push({ index, time: release });
    while (head < queue.length && queue[head].index <= index - window) head++;
    ready.push(count >= minimum ? queue[head].time : undefined);
    if (head > 1024 && head * 2 > queue.length) {
      queue.splice(0, head);
      head = 0;
    }
  }
  return ready;
}
