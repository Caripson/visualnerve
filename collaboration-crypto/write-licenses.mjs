/** Retain exact upstream notices for dependencies resolved for the WASM build. */
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Do not use localeCompare: retained output must be identical across host locales.
const ordinalCompare = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

export async function retainLicenses(
  metadata,
  {
    directory = fileURLToPath(new URL("./licenses/", import.meta.url)),
    readDirectory = readdir,
  } = {},
) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
  const inventory = [];
  for (const dependency of metadata.packages) {
    if (!resolved.has(dependency.id) || !dependency.source) continue;
    const source = dirname(dependency.manifest_path);
    const files = (await readDirectory(source))
      .filter((name) =>
        /^(LICENSE|LICENCE|COPYING|NOTICE)([-.].*)?$/i.test(name),
      )
      .sort(ordinalCompare);
    const notices = [];
    for (const file of files) {
      const name = `${dependency.name}-${dependency.version}-${file}`;
      const destination = join(directory, name);
      await copyFile(join(source, file), destination);
      notices.push(name);
    }
    inventory.push({
      ecosystem: "Cargo",
      name: dependency.name,
      version: dependency.version,
      license: dependency.license,
      scope: "locked WASM runtime/build dependency",
      repository: dependency.repository,
      notices,
    });
  }
  inventory.sort(
    (a, b) =>
      ordinalCompare(a.name, b.name) || ordinalCompare(a.version, b.version),
  );
  await writeFile(
    join(directory, "inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  return inventory;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const metadata = JSON.parse(await readFile(process.argv[2], "utf8"));
  const inventory = await retainLicenses(metadata);
  console.log(
    `Retained notices for ${inventory.length} pinned Cargo dependencies.`,
  );
}
