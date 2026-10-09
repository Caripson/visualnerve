/**
 * A composable route summary. Fork joins must not concatenate every repeated
 * path: a small topology can otherwise produce millions of retained edge IDs.
 * Short routes retain their exact historical labels. Long labels keep a bounded
 * prefix, ordered dual digest and edge count. Work attribution is deduplicated
 * independently, so summarizing a route never drops its business metrics.
 */
export class ParticleRoute {
  static readonly labelLimit = 2000;
  static readonly prefixLimit = 200;
  private prefix = '';
  private characters = 0;
  private count = 0;
  private hash31 = 0;
  private power31 = 1;
  private hash131 = 0;
  private power131 = 1;
  private readonly workIds = new Set<string>();

  get edgeCount() {
    return this.count;
  }
  get retainedCharacters() {
    return this.prefix.length;
  }
  get workNodeIds(): ReadonlySet<string> {
    return this.workIds;
  }
  appendEdge(id: string, workNodeId?: string) {
    if (this.count) this.appendText(' → ');
    this.appendText(id);
    this.count++;
    if (workNodeId !== undefined) this.workIds.add(workNodeId);
  }
  append(other: ParticleRoute) {
    if (!other.count) return;
    if (this.count) this.appendText(' → ');
    if (this.prefix.length < ParticleRoute.labelLimit)
      this.prefix += other.prefix.slice(0, ParticleRoute.labelLimit - this.prefix.length);
    this.characters = Math.min(ParticleRoute.labelLimit + 1, this.characters + other.characters);
    this.hash31 = (Math.imul(this.hash31, other.power31) + other.hash31) >>> 0;
    this.power31 = Math.imul(this.power31, other.power31) >>> 0;
    this.hash131 = (Math.imul(this.hash131, other.power131) + other.hash131) >>> 0;
    this.power131 = Math.imul(this.power131, other.power131) >>> 0;
    this.count += other.count;
    for (const id of other.workIds) this.workIds.add(id);
  }
  label() {
    if (this.characters <= ParticleRoute.labelLimit) return this.prefix;
    const hex = (value: number) => value.toString(16).padStart(8, '0');
    return `${this.prefix.slice(0, ParticleRoute.prefixLimit)} … [route:${hex(this.hash31)}-${hex(this.hash131)}; edges=${this.count}]`;
  }
  private appendText(text: string) {
    if (this.prefix.length < ParticleRoute.labelLimit)
      this.prefix += text.slice(0, ParticleRoute.labelLimit - this.prefix.length);
    this.characters = Math.min(ParticleRoute.labelLimit + 1, this.characters + text.length);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      this.hash31 = (Math.imul(this.hash31, 31) + code) >>> 0;
      this.power31 = Math.imul(this.power31, 31) >>> 0;
      this.hash131 = (Math.imul(this.hash131, 131) + code) >>> 0;
      this.power131 = Math.imul(this.power131, 131) >>> 0;
    }
  }
}
