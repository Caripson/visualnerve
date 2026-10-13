import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const imagePath = /^(?:site\/(?:images|devices)|help\/images)\/[\w.-]+\.(?:webp|svg)$/;
const fingerprintPath = /^(.*)-([a-f0-9]{16})(\.(?:webp|svg))$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function filesIn(directory, prefix = '') {
  const files = [];
  for (const name of readdirSync(resolve(directory, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(resolve(directory, path));
    if (stat.isSymbolicLink()) throw new Error(`Static assets must not contain symlinks: ${path}`);
    if (stat.isDirectory()) files.push(...filesIn(directory, path));
    else files.push(path);
  }
  return files;
}

// A hash-shaped filename is insufficient: its bytes and retained source must agree.
export function fingerprintSource(directory, path) {
  if (!imagePath.test(path)) return path;
  const match = path.match(fingerprintPath);
  if (!match) return path;
  const source = `${match[1]}${match[3]}`;
  const bytes = readFileSync(resolve(directory, path));
  if (digest(bytes) !== match[2] || !bytes.equals(readFileSync(resolve(directory, source))))
    throw new Error(`Invalid content fingerprint: ${path}`);
  return source;
}

export function fingerprintAssets(directory) {
  const files = filesIn(directory);
  const mapping = new Map();
  for (const path of files.filter((path) => imagePath.test(path))) {
    if (path.match(fingerprintPath)) {
      fingerprintSource(directory, path);
      continue;
    }
    const bytes = readFileSync(resolve(directory, path));
    const extension = path.slice(path.lastIndexOf('.'));
    const fingerprinted = `${path.slice(0, -extension.length)}-${digest(bytes)}${extension}`;
    writeFileSync(resolve(directory, fingerprinted), bytes);
    mapping.set(`/${path}`, `/${fingerprinted}`);
  }
  // Replace complete known paths, including srcset, theme attributes and absolute social URLs.
  const paths = [...mapping.keys()].sort((a, b) => b.length - a.length);
  for (const path of files.filter((path) => path.endsWith('.html'))) {
    const original = readFileSync(resolve(directory, path), 'utf8');
    let html = original;
    for (const source of paths) html = html.split(source).join(mapping.get(source));
    if (html !== original) writeFileSync(resolve(directory, path), html);
  }
  return mapping;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mapping = fingerprintAssets(resolve(process.argv[2] || 'public'));
  console.log(`Content-addressed public images: ${mapping.size}; legacy aliases retained.`);
}
