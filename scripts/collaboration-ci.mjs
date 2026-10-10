import { createHash } from "node:crypto";

const workflows = ["collaboration-checks.yml", "collaboration-crypto.yml"];
const shaPattern = /^[a-f0-9]{40}$/;
const fail = (message) => {
  throw new Error(`${message}; deployment remains blocked.`);
};
const mainRun = (run) =>
  run.head_branch === "main" &&
  ["push", "workflow_dispatch"].includes(run.event);
function latest(runs, predicate = () => true) {
  if (!Array.isArray(runs)) fail("Invalid collaboration workflow history");
  for (const run of runs) {
    if (
      !run ||
      !Number.isSafeInteger(run.id) ||
      run.id < 1 ||
      !Number.isSafeInteger(run.run_number) ||
      run.run_number < 1 ||
      !shaPattern.test(run.head_sha || "") ||
      typeof run.head_branch !== "string" ||
      typeof run.event !== "string" ||
      typeof run.status !== "string" ||
      (run.conclusion !== null && typeof run.conclusion !== "string") ||
      typeof run.html_url !== "string"
    )
      fail("Invalid collaboration workflow run");
  }
  return runs
    .filter((run) => mainRun(run) && predicate(run))
    .sort(
      (a, b) =>
        (Date.parse(b.updated_at || b.created_at) || 0) -
          (Date.parse(a.updated_at || a.created_at) || 0) ||
        b.run_number - a.run_number ||
        b.id - a.id,
    )[0];
}
const passed = (run) =>
  run?.status === "completed" && run.conclusion === "success";

function featureRequiresWorkflow(workflow, tree) {
  const paths = [...tree.values()]
    .filter((entry) => entry.type !== "tree")
    .map((entry) => entry.path);
  if (workflow === "collaboration-checks.yml")
    return paths.some(
      (path) =>
        path === "collaboration-worker/package.json" ||
        path.startsWith("collaboration-worker/src/"),
    );
  return paths.some(
    (path) =>
      path === "collaboration-crypto/Cargo.toml" ||
      path.startsWith("collaboration-crypto/src/") ||
      path.startsWith("frontend/src/collaboration/"),
  );
}

/** Read the supported, reviewable push paths syntax at the immutable target SHA. */
export function workflowPushPaths(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^  push:\s*$/.test(line));
  if (start < 0) return undefined; // No automatic push run: require explicit exact-SHA verification.
  let paths;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S|^  \S/.test(line)) break;
    if (/^    paths-ignore:/.test(line))
      fail("Unsupported CI paths-ignore filter");
    if (/^    paths:/.test(line)) {
      if (line.trim() !== "paths:") fail("Unsupported inline CI path filter");
      if (paths) fail("Duplicate CI path filters");
      paths = [];
      for (i++; i < lines.length; i++) {
        const entry = lines[i];
        if (!entry.trim() || /^\s*#/.test(entry)) continue;
        if (!/^      - /.test(entry)) {
          i--;
          break;
        }
        const match = entry.match(/^      - "([A-Za-z0-9_./*?-]+)"\s*$/);
        if (!match) fail("Unsupported CI path-filter syntax");
        paths.push(match[1]);
      }
    }
  }
  if (paths && !paths.length) fail("Empty CI path filter");
  return paths;
}
function matches(path, glob) {
  let expression = "";
  for (let i = 0; i < glob.length; i++) {
    const character = glob[i];
    if (character === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        expression += "(?:.*/)?";
        i += 2;
      } else {
        expression += ".*";
        i++;
      }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`).test(path);
}

/** Immutable blob identities prove that an absent path-filtered run is irrelevant. */
class WorkflowSourceProof {
  constructor(read) {
    this.read = read;
    this.trees = new Map();
    this.blobs = new Map();
  }
  async tree(sha) {
    if (!shaPattern.test(sha || "")) fail("Invalid workflow source commit");
    if (!this.trees.has(sha)) {
      this.trees.set(
        sha,
        (async () => {
          const commit = await this.read(`git/commits/${sha}`);
          if (commit.sha !== sha || !shaPattern.test(commit.tree?.sha || ""))
            fail("GitHub returned an invalid immutable commit");
          const tree = await this.read(
            `git/trees/${commit.tree.sha}?recursive=1`,
          );
          if (
            tree.truncated !== false ||
            !Array.isArray(tree.tree) ||
            tree.tree.length > 100_000
          )
            fail("GitHub returned an incomplete source tree");
          const result = new Map();
          for (const entry of tree.tree) {
            if (
              typeof entry.path !== "string" ||
              !entry.path ||
              entry.path.length > 4096 ||
              entry.path.startsWith("/") ||
              /[\0\\]/.test(entry.path) ||
              entry.path
                .split("/")
                .some((part) => part === "." || part === "..") ||
              !shaPattern.test(entry.sha || "") ||
              !/^[0-7]{6}$/.test(entry.mode || "") ||
              !["blob", "tree", "commit"].includes(entry.type) ||
              result.has(entry.path)
            )
              fail("GitHub returned an invalid source-tree entry");
            result.set(entry.path, entry);
          }
          return result;
        })(),
      );
    }
    return this.trees.get(sha);
  }
  async source(blob) {
    if (blob.type !== "blob" || blob.mode !== "100644")
      fail("The CI workflow must be a regular tracked file");
    if (!this.blobs.has(blob.sha)) {
      this.blobs.set(
        blob.sha,
        (async () => {
          const value = await this.read(`git/blobs/${blob.sha}`);
          if (
            value.sha !== blob.sha ||
            value.encoding !== "base64" ||
            typeof value.content !== "string" ||
            value.content.length > 128 * 1024
          )
            fail("Invalid CI workflow source");
          const bytes = Buffer.from(value.content, "base64");
          if (bytes.byteLength > 64 * 1024)
            fail("CI workflow source exceeds its bound");
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        })(),
      );
    }
    return this.blobs.get(blob.sha);
  }
  fingerprint(tree, paths, definition) {
    const entries = [...tree.values()]
      .filter(
        (entry) =>
          entry.type !== "tree" &&
          (entry.path === definition ||
            paths.some((path) => matches(entry.path, path))),
      )
      .map(({ path, sha, mode, type }) => [path, sha, mode, type])
      .sort((a, b) => a[0].localeCompare(b[0], "en"));
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  }
}

export async function verifyCollaborationCI({ sha, read, runs }) {
  const proof = new WorkflowSourceProof(read);
  const current = await proof.tree(sha);
  const evidence = [];
  for (const workflow of workflows) {
    const definition = `.github/workflows/${workflow}`;
    const blob = current.get(definition);
    if (!blob) {
      if (featureRequiresWorkflow(workflow, current))
        fail(
          `Required ${workflow} definition is missing while its feature exists`,
        );
      continue; // Backward-compatible revisions where the corresponding feature is absent.
    }
    if (blob.type !== "blob" || blob.mode !== "100644")
      fail("The CI workflow must be a regular tracked file");
    // A separate exact-SHA query cannot lose this revision's failed or pending run
    // among many unrelated workflow dispatches or pull-request histories.
    const exact = latest(
      await runs(workflow, { head_sha: sha }),
      (run) => run.head_sha === sha,
    );
    if (exact) {
      if (!passed(exact))
        fail(
          `The latest ${workflow} run for ${sha} must complete successfully`,
        );
      evidence.push({
        workflow,
        runId: exact.id,
        runUrl: exact.html_url,
        validationSha: sha,
        unchangedInputs: false,
      });
      continue;
    }
    const baseline = latest(await runs(workflow));
    if (!passed(baseline))
      fail(`Successful exact-SHA ${workflow} verification is required`);
    const paths = workflowPushPaths(await proof.source(blob));
    if (!paths)
      fail(
        `Exact-SHA ${workflow} verification is required for an unfiltered workflow`,
      );
    const previous = await proof.tree(baseline.head_sha);
    if (
      proof.fingerprint(current, paths, definition) !==
      proof.fingerprint(previous, paths, definition)
    )
      fail(
        `Relevant sources changed since ${workflow} passed; a successful run for ${sha} is required`,
      );
    evidence.push({
      workflow,
      runId: baseline.id,
      runUrl: baseline.html_url,
      validationSha: baseline.head_sha,
      unchangedInputs: true,
    });
  }
  return evidence;
}
