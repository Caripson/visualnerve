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
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  const name = path.split('node_modules/').at(-1);
  let notices = copyNotices(resolve(root, 'frontend', path), name);
  // saxes 6.0.0 omits LICENSE from npm; the pinned upstream copy is kept offline.
  if (!notices.length && name === 'saxes' && entry.version === '6.0.0')
    notices = copyNotices(resolve(root, 'third_party/licenses/saxes'), name);
  inventory.push({ ecosystem: 'npm', name, version: entry.version, license: entry.license, scope: path === `node_modules/${name}` && pkg.dependencies[name] ? 'direct runtime' : path === `node_modules/${name}` && pkg.devDependencies[name] ? 'direct development' : entry.dev ? 'transitive development' : 'transitive runtime', notices });
}
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
writeFileSync(resolve(root, 'DEPENDENCIES.md'), `# Dependencies and licenses\n\nVersions are locked in frontend/package-lock.json and backend/go.mod/go.sum. The complete direct/transitive inventory, including development and platform-specific optional packages, is [docs/third-party-licenses.json](docs/third-party-licenses.json). Regenerate with \`node scripts/licenses.mjs /path/to/go\` after installing dependencies. Production builds copy available upstream license/notice files to \`public/licenses/\`. The optional Go communication bridge uses coder/websocket (ISC) and has no persistent storage.\n\n| Direct dependency | Version | License | Role |\n| --- | --- | --- | --- |\n${direct.map(d => `| ${d.name} | ${d.version} | ${d.license} | ${d.scope} |`).join('\n')}\n\nHugo (Apache-2.0), Go (BSD-3-Clause), Node.js (MIT with bundled third-party notices) and npm (Artistic-2.0) are build/install tools, not browser runtime services. ELK.js is a required layout dependency under EPL-2.0 (with its stated secondary-license conditions); we do not modify its source. Most application dependencies use MIT, BSD or Apache licenses. Lucide icons use ISC, with the upstream Feather notices retained.\n\nImplementation references: [React Flow PNG export](https://reactflow.dev/examples/misc/download-image), [React Flow components](https://reactflow.dev/api-reference), [ELK.js](https://github.com/kieler/elkjs), [Dexie](https://dexie.org/docs/), [jsPDF](https://github.com/parallax/jsPDF), [coder/websocket](https://github.com/coder/websocket). All code and assets run locally; these links are documentation, not runtime requests.\n`);
console.log(`Recorded ${inventory.length} third-party packages and copied available license notices.`);
