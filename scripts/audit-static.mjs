import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function auditStatic(directory) {
  const files = [];
  function visit(prefix = '') {
    for (const name of readdirSync(resolve(directory, prefix))) {
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(resolve(directory, path));
      if (stat.isSymbolicLink()) throw new Error(`Static bundle must not contain symlinks: ${path}`);
      if (stat.isDirectory()) { visit(path); continue; }
      const allowed = ['index.html', 'error.html', 'sw.js', 'sitemap.xml', 'openapi.yaml', 'help/index.html', 'privacy/index.html', 'license/index.html', 'api/docs/index.html'].includes(path)
        || /^editor\/(?:app\.(?:js|css)|assets\/[\w.-]+\.(?:js|css|svg|png|woff2?))$/.test(path)
        || /^swagger\/swagger-ui(?:-bundle\.js|\.css)$/.test(path)
        || /^licenses\/[\w.-]+$/.test(path);
      if (!allowed || /\.(?:sqlite3?|db|backup)$/i.test(path)) throw new Error(`Unexpected file in static bundle: ${path}`);
      if (path.endsWith('.json')) {
        const content = JSON.parse(readFileSync(resolve(directory, path), 'utf8'));
        if (content.format === 'visual-nerve' || content.format === 'visual-nerve-workspace') throw new Error(`User export found in static bundle: ${path}`);
      }
      files.push(path);
    }
  }
  visit();
  for (const required of ['index.html', 'error.html', 'editor/app.js', 'privacy/index.html', 'sw.js']) if (!files.includes(required)) throw new Error(`Static bundle is missing ${required}`);
  return files;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(`Static bundle audit: ${auditStatic(resolve(process.argv[2] || 'public')).length} application files, no user data files.`);
}
