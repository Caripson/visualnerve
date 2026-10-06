declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface PiperModule {
    callMain(arguments_: string[]): number | undefined;
  }
  interface PiperOptions {
    thisProgram: string;
    wasmBinary: Uint8Array;
    getPreloadedPackage(name: string, size: number): ArrayBuffer;
    noInitialRun: boolean;
    noExitRuntime: boolean;
    print(value: string): void;
    printErr(value: string): void;
    locateFile(name: string): string;
  }
  export default function createPiperPhonemize(options: PiperOptions): Promise<PiperModule>;
}
