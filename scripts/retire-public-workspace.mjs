import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Remove the published legacy shell without ever touching browser storage. */
export class PublicWorkspaceRetirement {
  constructor(directory) {
    this.directory = resolve(directory);
  }
  retire() {
    const legacy = resolve(this.directory, "app");
    if (existsSync(legacy)) {
      if (lstatSync(legacy).isSymbolicLink())
        throw new Error("Legacy workspace output must not be a symlink.");
      rmSync(legacy, { recursive: true });
    }
    return this.audit();
  }
  audit() {
    if (existsSync(resolve(this.directory, "app")))
      throw new Error(
        "Production must not publish the retired /app workspace.",
      );
    return true;
  }
}

let main = false;
try {
  main =
    !!process.argv[1] &&
    realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url));
} catch {
  // Importing the class does not mutate an output directory.
}
if (main) {
  if (
    process.argv.length < 3 ||
    process.argv.length > 4 ||
    (process.argv[3] && process.argv[3] !== "--audit")
  )
    throw new Error(
      "Usage: node scripts/retire-public-workspace.mjs PUBLIC_DIRECTORY [--audit]",
    );
  const retirement = new PublicWorkspaceRetirement(process.argv[2]);
  if (process.argv[3] === "--audit") retirement.audit();
  else retirement.retire();
}
