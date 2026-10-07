export interface EngineEvent {
  at: number;
  phase: number;
  sequence: number;
  kind: string;
  id: string;
  particle?: number;
  token?: number;
  value?: number;
}
const before = (a: EngineEvent, b: EngineEvent) =>
  a.at < b.at ||
  (a.at === b.at && (a.phase < b.phase || (a.phase === b.phase && a.sequence < b.sequence)));
export class EventQueue {
  private heap: EngineEvent[] = [];
  get size() {
    return this.heap.length;
  }
  peek() {
    return this.heap[0];
  }
  push(event: EngineEvent) {
    let i = this.heap.length;
    this.heap.push(event);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(event, this.heap[p])) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = event;
  }
  pop(): EngineEvent | undefined {
    const first = this.heap[0],
      last = this.heap.pop();
    if (!last || !this.heap.length) return first;
    let i = 0;
    while (true) {
      let c = i * 2 + 1;
      if (c >= this.heap.length) break;
      if (c + 1 < this.heap.length && before(this.heap[c + 1], this.heap[c])) c++;
      if (!before(this.heap[c], last)) break;
      this.heap[i] = this.heap[c];
      i = c;
    }
    this.heap[i] = last;
    return first;
  }
}
