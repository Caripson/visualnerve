import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// TypeScript is a direct, installed frontend build dependency. Parse output; never import it.
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const ts = require("typescript");
const locales = ["en", "da", "nb", "sv", "fi", "de", "es", "fr"];
const catalogMarkers = [
  "app.settings",
  "settings.appLanguage",
  "presentation.play",
  "workspace.newDiagram",
];

export const EDITOR_BUNDLE_BUDGETS = Object.freeze({
  entryBytes: 400_000,
  mainThreadChunkBytes: 500_000,
  initialStaticBytes: 1_000_000,
});

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node)
    ? node.text
    : undefined;
}

/** Audit genuine built ESM boundaries. Worker-only files are excluded by graph, never by filename. */
export class BrowserBundleAudit {
  constructor(directory) {
    this.directory = realpathSync(resolve(directory));
  }

  modules = new Map();

  modulePath(from, specifier) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../"))
      throw new Error(
        `Unsupported built module import in ${from}: ${specifier}`,
      );
    if (/[?#\\\0]/.test(specifier))
      throw new Error(
        `Unsupported built module import in ${from}: ${specifier}`,
      );
    const file = relative(
      this.directory,
      resolve(this.directory, dirname(from), specifier),
    );
    if (file === ".." || file.startsWith("../") || isAbsolute(file))
      throw new Error(
        `Built module import escapes the editor directory: ${from} -> ${specifier}`,
      );
    if (!file.endsWith(".js"))
      throw new Error(
        `Unsupported built module extension: ${from} -> ${specifier}`,
      );
    return file.replaceAll("\\", "/");
  }

  readModule(file) {
    const existing = this.modules.get(file);
    if (existing) return existing;
    const path = resolve(this.directory, file);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new Error(`Missing built module: ${file}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path)
      throw new Error(
        `Built modules must be regular files inside the editor directory: ${file}`,
      );
    const bytes = readFileSync(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    if (source.parseDiagnostics.length)
      throw new Error(`Invalid built JavaScript: ${file}`);
    const module = {
      file,
      bytes: bytes.length,
      source,
      static: [],
      dynamic: [],
      catalogs: 0,
    };
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        if (!ts.isStringLiteralLike(node.moduleSpecifier))
          throw new Error(`Unsupported built module import in ${file}`);
        module.static.push(this.modulePath(file, node.moduleSpecifier.text));
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (
          node.arguments.length !== 1 ||
          !ts.isStringLiteralLike(node.arguments[0])
        )
          throw new Error(
            `Built dynamic import must have one literal local path: ${file}`,
          );
        module.dynamic.push(this.modulePath(file, node.arguments[0].text));
      }
      if (ts.isObjectLiteralExpression(node)) {
        const keys = new Set(
          node.properties
            .filter(ts.isPropertyAssignment)
            .map((property) => propertyName(property.name)),
        );
        if (catalogMarkers.every((key) => keys.has(key))) module.catalogs++;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    this.modules.set(file, module);
    return module;
  }

  reachable(includeDynamic) {
    const visited = new Set();
    const pending = ["app.js"];
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const module = this.readModule(file);
      pending.push(...module.static, ...(includeDynamic ? module.dynamic : []));
    }
    return visited;
  }

  catalogImports(module, catalogs, found) {
    const visit = (node) => {
      if (ts.isPropertyAssignment(node)) {
        const locale = propertyName(node.name);
        if (locales.includes(locale)) {
          const imports = new Set();
          const inspect = (child) => {
            if (
              ts.isCallExpression(child) &&
              child.expression.kind === ts.SyntaxKind.ImportKeyword
            ) {
              const file = this.modulePath(
                module.file,
                child.arguments[0].text,
              );
              if (catalogs.has(file)) imports.add(file);
            }
            ts.forEachChild(child, inspect);
          };
          inspect(node.initializer);
          if (imports.size) {
            if (imports.size !== 1)
              throw new Error(
                `Locale ${locale} dynamically imports multiple catalogues.`,
              );
            const file = [...imports][0];
            if (found.has(locale) && found.get(locale) !== file)
              throw new Error(
                `Locale ${locale} has inconsistent built catalogue paths.`,
              );
            found.set(locale, file);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.source);
  }

  run() {
    const all = this.reachable(true);
    const initial = this.reachable(false);
    const errors = [];
    const entry = this.modules.get("app.js");
    const initialBytes = [...initial].reduce(
      (sum, file) => sum + this.modules.get(file).bytes,
      0,
    );
    if (entry.bytes >= EDITOR_BUNDLE_BUDGETS.entryBytes)
      errors.push(
        `Entry app.js is ${entry.bytes} bytes; it must stay below ${EDITOR_BUNDLE_BUDGETS.entryBytes}.`,
      );
    if (initialBytes >= EDITOR_BUNDLE_BUDGETS.initialStaticBytes)
      errors.push(
        `Initial static import closure is ${initialBytes} bytes; it must stay below ${EDITOR_BUNDLE_BUDGETS.initialStaticBytes}.`,
      );
    for (const file of all) {
      const module = this.modules.get(file);
      if (module.bytes >= EDITOR_BUNDLE_BUDGETS.mainThreadChunkBytes)
        errors.push(
          `Main-thread chunk ${file} is ${module.bytes} bytes; it must stay below ${EDITOR_BUNDLE_BUDGETS.mainThreadChunkBytes}.`,
        );
    }
    const catalogs = new Set(
      [...all].filter((file) => this.modules.get(file).catalogs),
    );
    if (catalogs.size !== locales.length)
      errors.push(
        `Expected ${locales.length} separate language catalogue chunks; found ${catalogs.size}.`,
      );
    for (const file of catalogs) {
      if (this.modules.get(file).catalogs !== 1)
        errors.push(
          `Language catalogue chunk ${file} contains multiple embedded catalogues.`,
        );
      if (initial.has(file))
        errors.push(
          `Language catalogue ${file} is eagerly imported by the entry.`,
        );
      for (const importer of all)
        if (this.modules.get(importer).static.includes(file))
          errors.push(
            `Language catalogue ${file} has a static importer: ${importer}.`,
          );
    }
    const found = new Map();
    for (const file of all)
      this.catalogImports(this.modules.get(file), catalogs, found);
    for (const locale of locales)
      if (!found.has(locale))
        errors.push(
          `No literal dynamic catalogue import was found for locale ${locale}.`,
        );
    if (new Set(found.values()).size !== locales.length)
      errors.push(
        "Each of the eight locale IDs must dynamically load its own distinct catalogue chunk.",
      );
    if (errors.length)
      throw new Error(`Editor bundle audit failed:\n- ${errors.join("\n- ")}`);
    return {
      entry: { file: "app.js", bytes: entry.bytes },
      initial: { files: [...initial].sort(), bytes: initialBytes },
      mainThread: {
        files: [...all].sort(),
        maximumChunkBytes: Math.max(
          ...[...all].map((file) => this.modules.get(file).bytes),
        ),
      },
      catalogs: Object.fromEntries(
        locales.map((locale) => [
          locale,
          {
            file: found.get(locale),
            bytes: this.modules.get(found.get(locale)).bytes,
          },
        ]),
      ),
    };
  }
}

export function auditEditorBundle(directory) {
  return new BrowserBundleAudit(directory).run();
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      pathToFileURL(realpathSync(process.argv[1])).href ===
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const directory =
    process.argv[2] ||
    fileURLToPath(new URL("../hugo/static/editor/", import.meta.url));
  const report = auditEditorBundle(directory);
  console.log(
    `Editor bundle audit: entry ${report.entry.bytes} B; initial static imports ${report.initial.bytes} B; largest main-thread chunk ${report.mainThread.maximumChunkBytes} B; eight independent lazy language catalogues.`,
  );
}
