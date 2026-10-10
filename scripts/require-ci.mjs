import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { verifyCollaborationCI } from "./collaboration-ci.mjs";

function latest(runs, predicate) {
  if (!Array.isArray(runs))
    throw new Error("GitHub returned an invalid workflow history.");
  return runs
    .filter(predicate)
    .sort(
      (a, b) =>
        (Date.parse(b.updated_at || b.created_at) || 0) -
          (Date.parse(a.updated_at || a.created_at) || 0) ||
        b.run_number - a.run_number ||
        b.id - a.id,
    )[0];
}

export function authorizeDeployment({
  sha,
  mainSha,
  ref,
  mode,
  ciRuns,
  stagingRuns = [],
  approvedSha = "",
  actor = "",
  triggeringActor = actor,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("A full deployed commit SHA is required.");
  if (ref !== "refs/heads/main") throw new Error("Only main may deploy.");
  if (mainSha !== sha)
    throw new Error(
      "Main has moved; deploy and review its current exact revision instead of rerunning stale code.",
    );
  if (!["staging", "production"].includes(mode))
    throw new Error("Unknown deployment mode.");
  const ci = latest(
    ciRuns,
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "push",
  );
  if (!ci || ci.status !== "completed" || ci.conclusion !== "success") {
    throw new Error(
      `The latest CI push run for ${sha} must complete successfully before deployment.`,
    );
  }
  const evidence = { sha, ciRunId: ci.id, ciUrl: ci.html_url };
  if (mode === "staging") return evidence;
  if (approvedSha !== sha) {
    throw new Error(
      "Production is not approved: the owner must review staging and set PRODUCTION_APPROVED_SHA to this exact commit in GitHub Variables.",
    );
  }
  if (
    actor.toLowerCase() !== "caripson" ||
    triggeringActor.toLowerCase() !== "caripson"
  ) {
    throw new Error(
      "Only Caripson may initiate or rerun an approved production deployment.",
    );
  }
  const staged = latest(
    stagingRuns,
    (run) => run.head_branch === "main" && run.event === "workflow_dispatch",
  );
  if (
    !staged ||
    staged.head_sha !== sha ||
    staged.status !== "completed" ||
    staged.conclusion !== "success"
  ) {
    throw new Error(
      "The latest manual Deploy S3 staging run must complete successfully for this exact commit before production.",
    );
  }
  return { ...evidence, stagingRunId: staged.id, stagingUrl: staged.html_url };
}

export async function verifyDeployment(env, mode, fetcher = fetch) {
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !token) {
    throw new Error(
      "Repository identity and an Actions read token are required for the gate.",
    );
  }
  const api = env.GITHUB_API_URL || "https://api.github.com";
  async function runs(workflow, query) {
    const url = new URL(
      `${api}/repos/${repository}/actions/workflows/${workflow}/runs`,
    );
    url.search = new URLSearchParams({
      branch: "main",
      per_page: "100",
      ...query,
    });
    const response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot verify ${workflow} history (HTTP ${response.status}); deployment remains blocked.`,
      );
    return (await response.json()).workflow_runs;
  }
  async function currentMain() {
    const response = await fetcher(
      new URL(`${api}/repos/${repository}/git/ref/heads/main`),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Cannot verify current main (HTTP ${response.status}); deployment remains blocked.`,
      );
    return (await response.json()).object?.sha;
  }
  const [ciRuns, stagingRuns, mainSha] = await Promise.all([
    runs("ci.yml", { event: "push", head_sha: env.GITHUB_SHA }),
    mode === "production"
      ? runs("deploy.yml", { event: "workflow_dispatch" })
      : Promise.resolve([]),
    currentMain(),
  ]);
  const evidence = authorizeDeployment({
    sha: env.GITHUB_SHA,
    mainSha,
    ref: env.GITHUB_REF,
    mode,
    ciRuns,
    stagingRuns,
    approvedSha: env.PRODUCTION_APPROVED_SHA,
    actor: env.GITHUB_ACTOR,
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR,
  });
  const collaborationChecks = await verifyCollaborationCI({
    sha: env.GITHUB_SHA,
    runs: (workflow, query = {}) => runs(workflow, query),
    read: async (path) => {
      const response = await fetcher(
        new URL(`${api}/repos/${repository}/${path}`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
          },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw new Error(
          `Cannot verify immutable CI source (HTTP ${response.status}); deployment remains blocked.`,
        );
      return response.json();
    },
  });
  return {
    ...evidence,
    ...(collaborationChecks.length ? { collaborationChecks } : {}),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const evidence = await verifyDeployment(process.env, process.argv[2]);
    console.log(`Deployment gate passed: ${JSON.stringify(evidence)}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
