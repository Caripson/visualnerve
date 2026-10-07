import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'frontend/node_modules/klaro');
const output = resolve(root, 'hugo/static/site/vendor');
const info = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
if (info.version !== '0.7.21' || info.license !== 'BSD-3-Clause')
  throw new Error('The consent bundle must use pinned Klaro 0.7.21 (BSD-3-Clause).');
mkdirSync(output, { recursive: true });
for (const [from, to] of [
  ['dist/klaro-no-css.js', 'klaro.js'],
  ['dist/klaro.min.css', 'klaro.css'],
  ['LICENSE', 'klaro-LICENSE'],
]) copyFileSync(resolve(source, from), resolve(output, to));
for (const name of ['preact', 'core-js', 'classnames'])
  copyFileSync(
    resolve(root, 'third_party/licenses/klaro-bundle-' + name, 'LICENSE'),
    resolve(output, name + '-LICENSE'),
  );
console.log('Copied pinned Klaro and its retained license notices for local consent UI.');
