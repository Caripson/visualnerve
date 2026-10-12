import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve, relative, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "frontend/src/notation");
const require = createRequire(resolve(root, "frontend/package.json"));
const ts = require("typescript");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && !process.argv[outputIndex + 1])
  throw new Error("--output requires a path.");
const destination =
  outputIndex >= 0
    ? resolve(process.argv[outputIndex + 1])
    : resolve(root, "backend/internal/model/notation_catalog.json");
const temporary = await mkdtemp(
  resolve(tmpdir(), "visualnerve-notation-contract-"),
);
const compiled = new Map();

// Only trusted repository catalog modules are evaluated, in an isolated
// temporary ESM directory. No imported/user SVG, graph or external module runs.
async function compile(source) {
  const within = relative(sourceRoot, source);
  if (within.startsWith("..") || extname(source) !== ".ts")
    throw new Error(
      "Notation catalog imports must remain in the trusted notation source directory.",
    );
  if (compiled.has(source)) return compiled.get(source);
  const output = resolve(temporary, within.replace(/\.ts$/, ".mjs"));
  compiled.set(source, output);
  const input = await readFile(source, "utf8");
  let code = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const syntax = ts.createSourceFile(
    output,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const imports = syntax.statements.filter(
    (entry) =>
      (ts.isImportDeclaration(entry) || ts.isExportDeclaration(entry)) &&
      entry.moduleSpecifier &&
      ts.isStringLiteral(entry.moduleSpecifier),
  );
  const replacements = [];
  for (const declaration of imports) {
    const name = declaration.moduleSpecifier.text;
    if (!name.startsWith("."))
      throw new Error(`Unexpected notation catalog dependency: ${name}`);
    const dependency = resolve(
      dirname(source),
      name.replace(/\.(?:js|mjs|ts)$/, "") + ".ts",
    );
    const imported = await compile(dependency);
    let rewritten = relative(dirname(output), imported).replaceAll("\\", "/");
    if (!rewritten.startsWith(".")) rewritten = "./" + rewritten;
    replacements.push({
      start: declaration.moduleSpecifier.getStart(syntax),
      end: declaration.moduleSpecifier.end,
      value: JSON.stringify(rewritten),
    });
  }
  function rejectDynamicImports(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      throw new Error(
        "Dynamic imports are not part of the static notation catalog.",
      );
    ts.forEachChild(node, rejectDynamicImports);
  }
  rejectDynamicImports(syntax);
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    code =
      code.slice(0, replacement.start) +
      replacement.value +
      code.slice(replacement.end);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, code);
  return output;
}

try {
  const registry = await import(
    pathToFileURL(await compile(resolve(sourceRoot, "registry.ts"))).href
  );
  const catalog = {
    schemaVersion: 1,
    collections: registry.notationCollections,
    symbols: registry.notationSymbols,
    connectors: registry.notationEdgeSymbols,
    limits: registry.notationLimits,
    bpmnEventContexts: registry.bpmnEventContexts,
    umlAttachmentTargets: registry.umlAttachmentTargets,
    compartmentLimits: registry.notationCompartmentLimits,
  };
  for (const key of ["collections", "symbols", "connectors"])
    if (!Array.isArray(catalog[key]) || !catalog[key].length)
      throw new Error(`Missing static notation catalog ${key}`);
  if (
    catalog.collections.length !== 5 ||
    !catalog.limits ||
    !catalog.bpmnEventContexts ||
    !catalog.umlAttachmentTargets ||
    !catalog.compartmentLimits
  )
    throw new Error(
      "Notation catalog must expose the five reviewed collections and canonical limits.",
    );
  for (const key of ["collections", "symbols", "connectors"]) {
    const ids = catalog[key].map(
      (entry) => `${entry.collection ?? ""}:${entry.id}`,
    );
    if (new Set(ids).size !== ids.length)
      throw new Error(`Duplicate notation ${key} identities`);
  }
  for (const [collection, rules] of Object.entries(catalog.compartmentLimits))
    for (const [symbol, rule] of Object.entries(rules)) {
      if (
        !catalog.symbols.some(
          (entry) =>
            entry.collection === collection &&
            entry.id === symbol &&
            entry.compartments,
        )
      )
        throw new Error(
          `Fixed compartment rule does not identify a supported compartment symbol: ${collection}/${symbol}`,
        );
      const bounds =
        typeof rule === "number" ? [rule] : [rule.default, rule.detail];
      if (
        bounds.some(
          (value) =>
            !Number.isInteger(value) ||
            value < 1 ||
            value > catalog.limits.compartments,
        ) ||
        (typeof rule !== "number" && rule.detail < rule.default)
      )
        throw new Error(
          `Invalid fixed compartment bound: ${collection}/${symbol}`,
        );
    }
  const content = JSON.stringify(catalog, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await readFile(destination, "utf8")) !== content)
      throw new Error(
        "Embedded notation catalog is stale; run node scripts/notation-contract.mjs.",
      );
    console.log(
      "Embedded notation contract matches the trusted browser catalog.",
    );
  } else {
    await writeFile(destination, content);
    console.log(
      `Notation contract: ${catalog.collections.length} collections, ${catalog.symbols.length} symbols, ${catalog.connectors.length} connectors.`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
