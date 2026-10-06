import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = resolve(root, 'frontend/node_modules');
const output = resolve(root, 'frontend/public/speech');
const files = [
  ['onnxruntime-web', '1.18.0', 'dist/ort-wasm.wasm'],
  ['onnxruntime-web', '1.18.0', 'dist/ort-wasm-simd.wasm'],
  ['@diffusionstudio/piper-wasm', '1.0.0', 'build/piper_phonemize.wasm'],
  ['@diffusionstudio/piper-wasm', '1.0.0', 'build/piper_phonemize.data'],
];
mkdirSync(output, { recursive: true });
for (const [name, version, path] of files) {
  const packageDir = resolve(modules, name);
  const info = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
  if (info.version !== version) throw new Error(`Speech runtime version mismatch: ${name}`);
  copyFileSync(resolve(packageDir, path), resolve(output, path.split('/').at(-1)));
}
console.log('Copied four pinned local neural speech runtime files. Voice models are downloaded only on user request.');
