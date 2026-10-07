import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'frontend/package-lock.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'frontend/package.json'), 'utf8'));
const inventory = [];
const noticeDir = resolve(root, 'hugo/static/licenses');
rmSync(noticeDir, { recursive: true, force: true });
mkdirSync(noticeDir, { recursive: true });
function copyNotices(directory, name) {
  if (!existsSync(directory)) return [];
  const notices = readdirSync(directory).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)([-.].*)?$/i.test(file));
  return notices.map(file => { const target = `${name.replace(/[^a-z0-9.-]/gi, '_')}-${file}`; const destination = resolve(noticeDir, target); if (existsSync(destination)) chmodSync(destination, 0o644); copyFileSync(resolve(directory, file), destination); chmodSync(destination, 0o644); return `licenses/${target}`; });
}
// Publish the application's own license separately from the dependency inventory.
copyNotices(root, 'visualnerve');
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  const name = path.split('node_modules/').at(-1);
  let notices = copyNotices(resolve(root, 'frontend', path), name);
  // saxes 6.0.0 omits LICENSE from npm; the pinned upstream copy is kept offline.
  if (!notices.length && name === 'saxes' && entry.version === '6.0.0')
    notices = copyNotices(resolve(root, 'third_party/licenses/saxes'), name);
  if (!notices.length && name === '@mintplex-labs/piper-tts-web' && entry.version === '1.0.5')
    notices = copyNotices(resolve(root, 'third_party/licenses/piper-tts-web'), name);
  if (name === '@diffusionstudio/piper-wasm' && entry.version === '1.0.0')
    notices.push(...copyNotices(resolve(root, 'third_party/licenses/piper-phonemize'), 'piper-phonemize'), ...copyNotices(resolve(root, 'third_party/licenses/espeak-ng'), 'espeak-ng'));
  inventory.push({ ecosystem: 'npm', name, version: entry.version, license: name === '@diffusionstudio/piper-wasm' ? 'MIT wrapper / GPL-3.0-or-later eSpeak runtime' : entry.license, scope: path === `node_modules/${name}` && pkg.dependencies[name] ? 'direct runtime' : path === `node_modules/${name}` && pkg.devDependencies[name] ? 'direct development' : entry.dev ? 'transitive development' : 'transitive runtime', notices });
}
// The local speech adapter retains attribution for the MIT Piper Web reference
// implementation even though the upstream wrapper is no longer a dependency.
inventory.push({ ecosystem: 'source', name: 'Piper Web reference', version: '1.0.5 (adapted)', license: 'MIT', scope: 'upstream MIT material retained in speech adapter', notices: copyNotices(resolve(root, 'third_party/licenses/piper-tts-web'), 'piper-tts-web') });
// Klaro's published UMD includes these upstream components even though its npm
// consumer dependency list contains build tooling. Versions are from its v0.7.21 lock.
for (const [name, version] of [['preact', '10.19.6'], ['core-js', '3.36.0'], ['classnames', '2.5.1']])
  inventory.push({ ecosystem: 'source', name: 'Klaro bundled ' + name, version, license: 'MIT', scope: 'unmodified browser runtime bundled in Klaro 0.7.21', notices: copyNotices(resolve(root, 'third_party/licenses/klaro-bundle-' + name), 'klaro-bundle-' + name) });
const go = process.argv[2] || 'go';
const modulesRaw = execFileSync(go, ['list', '-m', '-json', 'all'], { cwd: resolve(root, 'backend'), encoding: 'utf8' });
const modules = JSON.parse(`[${modulesRaw.trim().replace(/}\s*{/g, '},{')}]`);
for (const mod of modules.filter(m => !m.Main)) {
  const license = mod.Path === 'github.com/coder/websocket' ? 'ISC' : 'See upstream notice';
  inventory.push({ ecosystem: 'Go', name: mod.Path, version: mod.Version, license, scope: mod.Indirect ? 'transitive runtime' : 'direct runtime', notices: mod.Dir ? copyNotices(mod.Dir, mod.Path) : [] });
}
inventory.sort((a, b) => `${a.ecosystem}/${a.name}`.localeCompare(`${b.ecosystem}/${b.name}`));
const json = JSON.stringify(inventory, null, 2) + '\n';
writeFileSync(resolve(root, 'docs/third-party-licenses.json'), json);
writeFileSync(resolve(noticeDir, 'inventory.json'), json);
const direct = inventory.filter(d => d.scope.startsWith('direct'));
writeFileSync(resolve(root, 'DEPENDENCIES.md'), `# Dependencies and licenses\n\nVisual Nerve's original code is MPL-2.0; see [LICENSE](LICENSE), [NOTICE](NOTICE) and [source-distribution requirements](docs/LICENSING.md). This inventory covers third-party components, whose terms remain independent.\n\nVersions are locked in frontend/package-lock.json and backend/go.mod/go.sum. The complete direct/transitive inventory, including development and platform-specific optional packages, is [docs/third-party-licenses.json](docs/third-party-licenses.json). Regenerate with \`node scripts/licenses.mjs /path/to/go\` after installing dependencies. Production builds copy available upstream license/notice files to \`public/licenses/\`. The optional Go communication bridge uses coder/websocket (ISC) and has no persistent storage.\n\n| Direct dependency | Version | License | Role |\n| --- | --- | --- | --- |\n${direct.map(d => `| ${d.name} | ${d.version} | ${d.license} | ${d.scope} |`).join('\n')}\n\nHugo (Apache-2.0), Go (BSD-3-Clause), Node.js (MIT with bundled third-party notices) and npm (Artistic-2.0) are build/install tools, not browser runtime services. ELK.js is a required layout dependency under EPL-2.0 (with its stated secondary-license conditions); we do not modify its source. The optional local neural voice engine bundles eSpeak-ng under GPL-3.0-or-later; its corresponding-source and build links are in [docs/SPEECH.md](docs/SPEECH.md) and the distributed license notices. Most application dependencies use MIT, BSD or Apache licenses. Lucide icons use ISC, with the upstream Feather notices retained.\n\nImplementation references: [React Flow PNG export](https://reactflow.dev/examples/misc/download-image), [React Flow components](https://reactflow.dev/api-reference), [ELK.js](https://github.com/kieler/elkjs), [Dexie](https://dexie.org/docs/), [jsPDF](https://github.com/parallax/jsPDF), [coder/websocket](https://github.com/coder/websocket). Editor code and assets run locally; optional public-page analytics is separately consent-gated. These implementation-reference links are documentation, not runtime requests.\n`);
console.log(`Recorded ${inventory.length} third-party packages and copied available license notices.`);
