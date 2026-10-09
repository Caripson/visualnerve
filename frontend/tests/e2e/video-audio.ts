import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

// This fixture tests the speech protocol and the shipped movie exporter, not
// neural voice quality. Nonstationary PCM is important: a stationary sine wave
// can hide an encoder accidentally repeating the start of every audio chunk.
const speechFixture = `
self.onmessage = ({data}) => {
  if(data.action === 'preload') { self.postMessage({id:data.id,ready:true}); return; }
  if(data.action !== 'prepare') return;
  const rate=22050, count=Math.round(rate*1.6), bytes=new ArrayBuffer(44+count*2), view=new DataView(bytes);
  const tag=(offset,text)=>[...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
  tag(0,'RIFF'); view.setUint32(4,bytes.byteLength-8,true); tag(8,'WAVE'); tag(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); tag(36,'data'); view.setUint32(40,count*2,true);
  const pitches=data.text.includes('FIRST') ? [250,410,630,870,1130] : [330,520,770,1020,1370];
  const levels=[0.08,0.24,0.13,0.30,0.18];
  for(let index=0;index<count;index++) {
    const t=index/rate, segment=Math.floor(t/0.28), relative=t-segment*0.28;
    const fade=Math.min(1,relative/0.01,(0.28-relative)/0.01);
    const value=segment<5 ? levels[segment]*Math.max(0,fade)*Math.sin(2*Math.PI*(pitches[segment]*relative+18*relative*relative)) : 0;
    view.setInt16(44+index*2,Math.round(value*32767),true);
  }
  self.postMessage({id:data.id,ready:true,audio:new Blob([bytes],{type:'audio/wav'})});
};`;

type AudioObservation = {
  clips: Blob[];
  inputs: Array<{ timestamp: number; duration: number; rms: number }>;
  codecs: string[];
};

export async function installNarrationFixture(page: Page, forceOpus: boolean) {
  const assets = resolve('../hugo/static/editor/assets');
  const worker = readdirSync(assets).find(
    (name) =>
      /^worker-[\w-]+\.js$/.test(name) &&
      readFileSync(resolve(assets, name), 'utf8').includes(
        'The voice engine is already preparing audio',
      ),
  );
  expect(worker, 'The real built speech Worker artifact must exist').toBeDefined();
  const workerPath = `/editor/assets/${worker}`;
  await page.route(`**${workerPath}`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: speechFixture }),
  );
  await page.evaluate(
    ({ workerPath, forceOpus }) => {
      const observed: AudioObservation = { clips: [], inputs: [], codecs: [] };
      Object.defineProperty(window, '__videoAudioObserved', { value: observed });
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          if (new URL(String(args[0]), location.href).pathname === workerPath)
            this.addEventListener('message', ({ data }) => {
              if (data.audio instanceof Blob) observed.clips.push(data.audio);
            });
        }
      };
      // Observe the native boundary without modifying the input PCM or codec.
      const encode = AudioEncoder.prototype.encode;
      AudioEncoder.prototype.encode = function (data) {
        const values = new Float32Array(data.numberOfFrames);
        data.copyTo(values, { planeIndex: 0, format: 'f32-planar' });
        let energy = 0;
        for (const value of values) energy += value * value;
        observed.inputs.push({
          timestamp: data.timestamp / 1_000_000,
          duration: data.numberOfFrames / data.sampleRate,
          rms: Math.sqrt(energy / values.length),
        });
        return encode.call(this, data);
      };
      const configure = AudioEncoder.prototype.configure;
      AudioEncoder.prototype.configure = function (config) {
        observed.codecs.push(config.codec);
        return configure.call(this, config);
      };
      if (forceOpus) {
        const supported = AudioEncoder.isConfigSupported.bind(AudioEncoder);
        AudioEncoder.isConfigSupported = (config) =>
          config.codec.startsWith('mp4a')
            ? Promise.resolve({ supported: false, config })
            : supported(config);
      }
    },
    { workerPath, forceOpus },
  );
}

export async function decodedMovieAudio(page: Page, bytes: number[]) {
  return page.evaluate(async (bytes) => {
    const observed = (
      window as unknown as {
        __videoAudioObserved: AudioObservation;
      }
    ).__videoAudioObserved;
    const decode = new OfflineAudioContext(1, 1, 48000);
    const movie = await decode.decodeAudioData(new Uint8Array(bytes).buffer);
    const actual = movie.getChannelData(0);
    const sources = await Promise.all(
      observed.clips.map(async (clip) =>
        (await decode.decodeAudioData(await clip.arrayBuffer())).getChannelData(0),
      ),
    );
    const starts: number[] = [];
    let previousEnd = -Infinity;
    for (const input of observed.inputs) {
      if (input.rms < 0.004) continue;
      if (input.timestamp - previousEnd > 0.12) starts.push(input.timestamp);
      previousEnd = input.timestamp + input.duration;
    }
    function correlation(source: Float32Array, offset: number, begin: number, end: number) {
      let product = 0;
      let sourceEnergy = 0;
      let actualEnergy = 0;
      for (let frame = Math.round(begin * 48000); frame < Math.round(end * 48000); frame += 8) {
        const a = source[frame];
        const b = actual[frame + offset] ?? 0;
        product += a * b;
        sourceEnergy += a * a;
        actualEnergy += b * b;
      }
      return product / Math.sqrt(Math.max(Number.EPSILON, sourceEnergy * actualEnergy));
    }
    function rms(begin: number, end: number) {
      let energy = 0;
      let count = 0;
      for (
        let frame = Math.max(0, Math.round(begin * 48000));
        frame < Math.round(end * 48000);
        frame++
      ) {
        const value = actual[frame] ?? 0;
        energy += value * value;
        count++;
      }
      return { seconds: Math.max(0, end - begin), rms: Math.sqrt(energy / Math.max(1, count)) };
    }
    const clips = sources.map((source, index) => {
      const nominal = Math.round((starts[index] ?? 0) * 48000);
      let best = { offset: nominal, correlation: -1 };
      // Codec priming/decoder trimming may move the decoded signal by several
      // codec packets (especially AAC); allow at most 150 ms of fixed delay.
      // Find one alignment for the complete changing clip, then use that same
      // alignment for every segment; never realign individual chunks.
      for (let lag = -7200; lag <= 7200; lag += 16) {
        const offset = nominal + lag;
        const value = correlation(source, offset, 0.03, 1.37);
        if (value > best.correlation) best = { offset, correlation: value };
      }
      const coarse = best.offset;
      for (let offset = coarse - 16; offset <= coarse + 16; offset++) {
        const value = correlation(source, offset, 0.03, 1.37);
        if (value > best.correlation) best = { offset, correlation: value };
      }
      return {
        start: starts[index],
        duration: source.length / 48000,
        alignmentSeconds: (best.offset - nominal) / 48000,
        correlation: best.correlation,
        segments: Array.from({ length: 5 }, (_, segment) =>
          correlation(source, best.offset, segment * 0.28 + 0.04, segment * 0.28 + 0.24),
        ),
      };
    });
    return {
      channels: movie.numberOfChannels,
      sampleRate: movie.sampleRate,
      duration: movie.duration,
      codecs: observed.codecs,
      starts,
      clips,
      // Exclude codec ringing close to a tone boundary.
      silence: [
        rms(0, (starts[0] ?? 0) - 0.04),
        rms((starts[0] ?? 0) + 1.5, (starts[1] ?? 0) - 0.04),
        rms((starts[1] ?? 0) + 1.5, movie.duration - 0.04),
      ],
    };
  }, bytes);
}
