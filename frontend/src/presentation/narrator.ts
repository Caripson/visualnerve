/** A gesture-unlocked, local WAV player with sample-accurate pause/resume. */
export class Narrator {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private buffer?: AudioBuffer;
  private offset = 0;
  private started = 0;
  async unlock() {
    this.context ??= new AudioContext();
    const context = this.context;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        context.resume(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error('Audio needs a browser gesture. Click Play in the diagram player.')),
            1500,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    if (context.state !== 'running')
      throw new Error('Audio needs a browser gesture. Click Play in the diagram player.');
  }
  async play(blob: Blob, signal: AbortSignal): Promise<number> {
    const context = this.context;
    if (!context || context.state !== 'running')
      throw new Error('Audio needs a browser gesture. Click Play in the diagram player.');
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    this.stop();
    this.buffer = buffer;
    this.resume();
    return buffer.duration;
  }
  resume() {
    if (!this.buffer || !this.context) return;
    if (this.context.state !== 'running') throw new Error('Click Play to resume browser audio.');
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    this.started = this.context.currentTime;
    source.start(0, Math.min(this.offset, this.buffer.duration));
    this.source = source;
    source.onended = () => {
      if (this.source === source) {
        this.source = undefined;
        this.offset = this.buffer?.duration ?? 0;
      }
    };
  }
  remaining() {
    if (!this.source || !this.buffer || !this.context) return 0;
    return Math.max(
      0,
      this.buffer.duration - this.offset - (this.context.currentTime - this.started),
    );
  }
  pause() {
    if (!this.source || !this.context) return;
    this.offset += this.context.currentTime - this.started;
    this.source.stop();
    this.source.disconnect();
    this.source = undefined;
  }
  stop() {
    this.pause();
    this.buffer = undefined;
    this.offset = 0;
  }
  dispose() {
    this.stop();
    void this.context?.close();
    this.context = undefined;
  }
}
