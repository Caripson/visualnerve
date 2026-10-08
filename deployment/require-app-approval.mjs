import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function requireAppApproval(environment) {
  const sha = environment.GITHUB_SHA;
  if (
    environment.GITHUB_REF !== "refs/heads/main" ||
    !/^[a-f0-9]{40}$/.test(sha ?? "")
  )
    throw new Error("Isolated app publication requires an exact main commit.");
  for (const key of [
    "APP_SURFACE_APPROVED_SHA",
    "APP_SURFACE_STAGING_VERIFIED_SHA",
  ])
    if (environment[key] !== sha)
      throw new Error(
        `${key} must identify this exact reviewed and app-tested commit.`,
      );
  const bucket = environment.APP_S3_BUCKET;
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket ?? "") ||
    bucket === "www.visualnerve.com" ||
    /REPLACE|TODO/i.test(bucket)
  )
    throw new Error(
      "Configure a separate reviewed app bucket; the www bucket is forbidden.",
    );
  if (
    !/^[A-Z0-9]{8,32}$/.test(environment.APP_CLOUDFRONT_DISTRIBUTION_ID ?? "")
  )
    throw new Error("Configure the actual reviewed isolated-app distribution.");
  return sha;
}
function isMain() {
  try {
    return (
      !!process.argv[1] &&
      pathToFileURL(realpathSync(process.argv[1])).href ===
        pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    return false;
  }
}
if (isMain())
  console.log(
    `Isolated app approval: ${requireAppApproval(process.env)}; no AWS operation performed.`,
  );
