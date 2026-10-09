import { readdirSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const helpGuides = ['getting-started', 'editing', 'layouts', '3d', 'csv', 'connected-data', 'sql', 'code', 'diagram-import', 'understanding', 'presentations', 'simulation', 'sharing', 'settings', 'api-mcp', 'troubleshooting'];
const helpScreenshots = ['new-diagram', 'editor', 'mobile-editor', 'layouts', 'spatial', 'csv-import', 'csv-evidence', 'connected-data', 'data-quality', 'source-refresh', 'sql-query', 'sql-schema', 'code-cobol', 'code-project', 'code-project-zip', 'project-file-limit', 'diagram-import', 'overview', 'history', 'player', 'player-compact', 'storyboard', 'simulation', 'process-setup', 'process-subprocess-setup', 'process-hierarchy', 'process-drilldown', 'node-quick-add', 'simulation-traffic', 'simulation-assumptions', 'simulation-compare', 'export', 'export-svg', 'lovable', 'settings', 'app-language', 'backup', 'mcp-settings', 'vault-setup', 'vault-unlock', 'vault-password-change', 'vault-session-settings', 'vault-content-key-rotation', 'presentation-voice'];
const productPages = ['app', 'features', 'use-cases', 'process-simulator', 'mcp', 'developers', 'security'];
export function auditStatic(directory) {
  const files = [];
  function visit(prefix = '') {
    for (const name of readdirSync(resolve(directory, prefix))) {
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(resolve(directory, path));
      if (stat.isSymbolicLink()) throw new Error(`Static bundle must not contain symlinks: ${path}`);
      if (stat.isDirectory()) { visit(path); continue; }
      const allowed = ['index.html', 'error.html', 'sw.js', 'appearance.js', 'sitemap.xml', 'openapi.yaml', 'help/index.html', 'privacy/index.html', 'license/index.html', 'api/docs/index.html', 'api/docs/docs.css', 'api/docs/docs.js'].includes(path)
        || ['help/help.css', 'help/help.js', 'help/index.json'].includes(path)
        || helpGuides.some(guide => path === `help/${guide}/index.html`)
        || helpScreenshots.some(name => path === `help/images/${name}.webp` || path === `help/images/${name}-dark.webp`)
        || path === 'robots.txt'
        || productPages.some(name => path === `${name}/index.html`)
        || ['site/site.css', 'site/syntax.css', 'site/captures.css', 'site/site.js', 'site/mark.svg', 'site/consent.css', 'site/consent.js', 'site/vendor/klaro.js', 'site/vendor/klaro.css', 'site/vendor/klaro-LICENSE', 'site/vendor/preact-LICENSE', 'site/vendor/core-js-LICENSE', 'site/vendor/classnames-LICENSE'].includes(path)
        || ['phone', 'tablet', 'desktop', 'laptop', 'social'].some(name => path === `site/images/${name}.webp`)
        || ['phone', 'tablet', 'desktop', 'laptop'].some(name => path === `site/images/${name}-dark.webp` || path === `site/devices/${name}.svg`)
        || /^editor\/(?:app\.(?:js|css)|assets\/[\w.-]+\.(?:js|css|svg|png|woff2?))$/.test(path)
        || /^editor\/speech\/(?:ort-wasm(?:-simd)?\.wasm|piper_phonemize\.(?:wasm|data))$/.test(path)
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
  for (const required of ['index.html', 'app/index.html', 'error.html', 'editor/app.js', 'appearance.js', 'privacy/index.html', 'sw.js']) if (!files.includes(required)) throw new Error(`Static bundle is missing ${required}`);
  return files;
}
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      pathToFileURL(realpathSync(process.argv[1])).href ===
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    // Imports from stdin/eval do not necessarily have an existing entry-point file.
    return false;
  }
}
if (isMainModule()) {
  console.log(`Static bundle audit: ${auditStatic(resolve(process.argv[2] || 'public')).length} application files, no user data files.`);
}
