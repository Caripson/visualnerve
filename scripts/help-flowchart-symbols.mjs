import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function sourceModule(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
  );
}
const catalog = await sourceModule(
  readFileSync(resolve(root, "frontend/src/flowchart/ibm-symbols.ts"), "utf8"),
);
const template = readFileSync(
  resolve(root, "frontend/src/flowchart/template.ts"),
  "utf8",
);
const sizeSource = template.slice(
  template.indexOf("export function ibmSymbolSize"),
  template.indexOf("/** An editable stencil"),
);
const { ibmSymbolSize } = await sourceModule(sizeSource);
const symbols = Object.fromEntries(
  catalog.ibmSymbols.map((symbol) => [
    symbol.id,
    {
      label: symbol.label,
      category: symbol.category,
      outlinePath: symbol.outlinePath,
      detailPaths: symbol.detailPaths,
      ...ibmSymbolSize(symbol.id),
    },
  ]),
);
const destination = resolve(root, "hugo/data/flowchart_symbols.json");
const content = `${JSON.stringify(symbols, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== content)
    throw new Error(
      "Help symbol geometry is stale; run node scripts/help-flowchart-symbols.mjs.",
    );
} else {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}
console.log(
  `Help symbol geometry: ${Object.keys(symbols).length} catalog entries ${process.argv.includes("--check") ? "verified" : "generated"}.`,
);
