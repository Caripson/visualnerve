/** Constant-time retention, chronological snapshots, no shifting large arrays per event. */
export class BoundedRing<T> {
  private items: T[] = [];
  private offset = 0;
  constructor(readonly limit: number) {}
  get length() {
    return this.items.length;
  }
  push(value: T): boolean {
    if (!this.limit) return true;
    if (this.items.length < this.limit) {
      this.items.push(value);
      return false;
    }
    this.items[this.offset] = value;
    this.offset = (this.offset + 1) % this.limit;
    return true;
  }
  values(): T[] {
    return this.offset
      ? [...this.items.slice(this.offset), ...this.items.slice(0, this.offset)]
      : [...this.items];
  }
}
