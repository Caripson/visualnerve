import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditAppSurface } from "./app-surface-audit.mjs";
import { appResponseHeaders } from "./app-policy.mjs";
import { EXISTING_APP_TARGET } from "./app-existing-resources.mjs";

export const APP_ACCOUNT = "094904000140";
export const APP_FUNCTION = `visualnerve-isolated-app-routes-${EXISTING_APP_TARGET.distributionId}`;
const distributionArn = `arn:aws:cloudfront::${APP_ACCOUNT}:distribution/${EXISTING_APP_TARGET.distributionId}`;
const functionArn = `arn:aws:cloudfront::${APP_ACCOUNT}:function/${APP_FUNCTION}`;
const bucketArn = `arn:aws:s3:::${EXISTING_APP_TARGET.bucketName}`;
const fail = (message) => {
  throw new Error(`App publication refused: ${message}`);
};
const same = (value, expected) =>
  JSON.stringify(value) === JSON.stringify(expected);
const values = (value) => (Array.isArray(value) ? value : [value]);
const onlyGetHead = (value, name) => {
  const methods = items(value, name);
  return (
    methods.length === 2 && methods.includes("GET") && methods.includes("HEAD")
  );
};
const items = (value, name) => {
  const result = value?.Items ?? [];
  if (!Array.isArray(result) || value?.Quantity !== result.length)
    fail(`${name} has inconsistent items.`);
  return result;
};

/** Validate identifiers before they are used in further read-only AWS requests. */
export function appHostingReferences(snapshot) {
  const distribution = snapshot?.Distribution;
  if (
    distribution?.Id !== EXISTING_APP_TARGET.distributionId ||
    distribution.ARN !== distributionArn ||
    distribution.Status !== "Deployed"
  )
    fail(
      "the exact app distribution must be fully deployed in the owner account.",
    );
  const config = distribution.DistributionConfig;
  if (
    config?.Enabled !== true ||
    !same(items(config.Aliases, "Aliases"), [EXISTING_APP_TARGET.domainName]) ||
    items(config.Origins, "Origins").length !== 1 ||
    items(config.OriginGroups, "OriginGroups").length ||
    items(config.CacheBehaviors, "CacheBehaviors").length
  )
    fail(
      "only the reviewed enabled isolated app origin and behavior are supported.",
    );
  const origin = config.Origins.Items[0];
  const behavior = config.DefaultCacheBehavior;
  if (
    origin.DomainName !==
      `${EXISTING_APP_TARGET.bucketName}.s3.us-east-1.amazonaws.com` ||
    origin.OriginPath ||
    origin.CustomOriginConfig ||
    origin.S3OriginConfig?.OriginAccessIdentity !== "" ||
    items(origin.CustomHeaders, "Origin custom headers").length ||
    behavior?.TargetOriginId !== origin.Id ||
    !/^E[A-Z0-9]{7,31}$/.test(origin.OriginAccessControlId ?? "") ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(
      behavior.ResponseHeadersPolicyId ?? "",
    )
  )
    fail(
      "the app must use its private regional S3 REST origin, OAC and response policy.",
    );
  return {
    originAccessControlId: origin.OriginAccessControlId,
    responseHeadersPolicyId: behavior.ResponseHeadersPolicyId,
  };
}

/** Pure, read-only release check against the actual audited package policy. */
export function verifyAppHosting(input, manifest) {
  const references = appHostingReferences(input.distribution);
  if (
    input.identity?.Account !== APP_ACCOUNT ||
    input.location?.LocationConstraint !== null ||
    input.websiteAbsent !== true ||
    manifest?.format !== "visual-nerve-app-surface" ||
    manifest.schemaVersion !== 1 ||
    manifest.vaultRequired !== true ||
    manifest.appOrigin !== "https://app.visualnerve.com" ||
    manifest.websiteOrigin !== "https://www.visualnerve.com"
  )
    fail(
      "the account, us-east-1 bucket, absent website endpoint and production package must match.",
    );
  const expectedHeaders = appResponseHeaders(manifest.bridgePorts);
  if (!same(manifest.responseHeaders, expectedHeaders))
    fail("the package response policy is not the approved app policy.");
  const config = input.distribution.Distribution.DistributionConfig;
  const behavior = config.DefaultCacheBehavior;
  const certificate = config.ViewerCertificate;
  const functions = items(
    behavior.FunctionAssociations,
    "FunctionAssociations",
  );
  if (
    config.DefaultRootObject !== "index.html" ||
    behavior.ViewerProtocolPolicy !== "redirect-to-https" ||
    !onlyGetHead(behavior.AllowedMethods, "AllowedMethods") ||
    !onlyGetHead(behavior.AllowedMethods?.CachedMethods, "CachedMethods") ||
    items(behavior.LambdaFunctionAssociations, "LambdaFunctionAssociations")
      .length ||
    functions.length !== 1 ||
    functions[0].EventType !== "viewer-request" ||
    functions[0].FunctionARN !== functionArn ||
    certificate?.CloudFrontDefaultCertificate !== false ||
    !new RegExp(
      `^arn:aws:acm:us-east-1:${APP_ACCOUNT}:certificate/[\\da-f-]+$`,
      "i",
    ).test(certificate.ACMCertificateArn ?? "") ||
    !["TLSv1.2_2021", "TLSv1.2_2025", "TLSv1.3_2025"].includes(
      certificate.MinimumProtocolVersion,
    )
  )
    fail(
      "HTTPS, TLS, GET/HEAD delivery and the dedicated routing function must remain approved.",
    );
  const errors = items(config.CustomErrorResponses, "CustomErrorResponses");
  if (
    errors.some((entry) => String(entry.ResponseCode) === "200") ||
    [403, 404].some((code) => {
      const matching = errors.filter((entry) => entry.ErrorCode === code);
      return (
        matching.length !== 1 ||
        String(matching[0].ResponseCode) !== "404" ||
        matching[0].ResponsePagePath !== "/error.html" ||
        matching[0].ErrorCachingMinTTL !== 0
      );
    })
  )
    fail("origin errors must use the reviewed real HTTP404 error page.");
  const oac = input.oac?.OriginAccessControl;
  if (
    oac?.Id !== references.originAccessControlId ||
    oac.OriginAccessControlConfig?.OriginAccessControlOriginType !== "s3" ||
    oac.OriginAccessControlConfig.SigningBehavior !== "always" ||
    oac.OriginAccessControlConfig.SigningProtocol !== "sigv4"
  )
    fail("the associated OAC must always sign S3 requests with SigV4.");
  const policy = input.headers?.ResponseHeadersPolicy;
  const headerConfig = policy?.ResponseHeadersPolicyConfig;
  const security = headerConfig?.SecurityHeadersConfig;
  const custom = items(
    headerConfig?.CustomHeadersConfig,
    "CustomHeadersConfig",
  );
  const customNames = [
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "X-Robots-Tag",
  ];
  if (
    policy?.Id !== references.responseHeadersPolicyId ||
    headerConfig.CorsConfig ||
    (headerConfig.RemoveHeadersConfig?.Quantity ?? 0) !== 0 ||
    security?.ContentSecurityPolicy?.ContentSecurityPolicy !==
      expectedHeaders["Content-Security-Policy"] ||
    security.ContentSecurityPolicy.Override !== true ||
    security.ContentTypeOptions?.Override !== true ||
    security.FrameOptions?.FrameOption !== "DENY" ||
    security.FrameOptions.Override !== true ||
    security.ReferrerPolicy?.ReferrerPolicy !== "no-referrer" ||
    security.ReferrerPolicy.Override !== true ||
    security.StrictTransportSecurity?.AccessControlMaxAgeSec !== 31536000 ||
    security.StrictTransportSecurity.Override !== true ||
    security.StrictTransportSecurity.IncludeSubdomains === true ||
    security.StrictTransportSecurity.Preload === true ||
    custom.length !== customNames.length ||
    customNames.some((name) => {
      const matching = custom.filter(
        (entry) => entry.Header.toLowerCase() === name.toLowerCase(),
      );
      return (
        matching.length !== 1 ||
        matching[0].Override !== true ||
        matching[0].Value !== expectedHeaders[name]
      );
    })
  )
    fail(
      "all nine deployed app response headers must match the package without CORS or header-removal exceptions.",
    );
  const blocks = input.publicAccess?.PublicAccessBlockConfiguration;
  if (
    [
      "BlockPublicAcls",
      "IgnorePublicAcls",
      "BlockPublicPolicy",
      "RestrictPublicBuckets",
    ].some((name) => blocks?.[name] !== true)
  )
    fail("all four S3 public-access blocks are required.");
  if (
    !same(input.ownership?.OwnershipControls?.Rules, [
      { ObjectOwnership: "BucketOwnerEnforced" },
    ])
  )
    fail("the app bucket must disable object ACLs using BucketOwnerEnforced.");
  let bucketPolicy;
  try {
    bucketPolicy = JSON.parse(input.bucketPolicy?.Policy);
  } catch {
    fail("the app bucket policy must be readable and valid JSON.");
  }
  const statements = bucketPolicy.Statement;
  if (!Array.isArray(statements) || !statements.length)
    fail("the app bucket policy has no reviewed grants.");
  const signedRead = (entry) =>
    entry.Effect === "Allow" &&
    entry.Principal?.Service === "cloudfront.amazonaws.com" &&
    same(values(entry.Action), ["s3:GetObject"]) &&
    same(values(entry.Resource), [`${bucketArn}/*`]) &&
    entry.Condition?.StringEquals?.["AWS:SourceArn"] === distributionArn;
  if (
    !statements.some(signedRead) ||
    statements.some((entry) => {
      if (entry.Effect !== "Allow") return false;
      if (signedRead(entry)) return false;
      // Preserve explicit same-account administrative grants, never public,
      // cross-account or differently scoped CloudFront grants.
      const principals = values(entry.Principal?.AWS);
      return (
        !principals.length ||
        principals.some(
          (principal) =>
            typeof principal !== "string" ||
            !new RegExp(
              `^arn:aws:iam::${APP_ACCOUNT}:(?:root|(?:role|user)/[\\w+=,.@/-]+)$`,
            ).test(principal),
        )
      );
    })
  )
    fail(
      "S3 reads must be scoped to the exact app distribution without public or foreign grants.",
    );
  if (
    !statements.some(
      (entry) =>
        entry.Effect === "Deny" &&
        entry.Principal === "*" &&
        values(entry.Action).includes("s3:*") &&
        values(entry.Resource).includes(bucketArn) &&
        values(entry.Resource).includes(`${bucketArn}/*`) &&
        entry.Condition?.Bool?.["aws:SecureTransport"] === "false",
    )
  )
    fail("the app bucket policy must deny insecure transport.");
  const summary = input.functionDescription?.FunctionSummary;
  const expectedSource = readFileSync(
    new URL("./viewer-request.js", import.meta.url),
    "utf8",
  ).replace("__CANONICAL_HOST__", EXISTING_APP_TARGET.domainName);
  if (
    summary?.Name !== APP_FUNCTION ||
    summary.FunctionConfig?.Runtime !== "cloudfront-js-2.0" ||
    summary.FunctionMetadata?.FunctionARN !== functionArn ||
    summary.FunctionMetadata.Stage !== "LIVE" ||
    input.functionSource !== expectedSource
  )
    fail(
      "the dedicated LIVE route function must exactly match the reviewed source.",
    );
  return {
    ...references,
    accountId: APP_ACCOUNT,
    bucket: EXISTING_APP_TARGET.bucketName,
    distributionId: EXISTING_APP_TARGET.distributionId,
    bridgePorts: manifest.bridgePorts,
  };
}

const read = (path) => {
  if (statSync(path).size > 1024 * 1024)
    fail("oversized hosting review input.");
  return readFileSync(path, "utf8");
};
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
if (isMain()) {
  const [mode, directory, packageDirectory] = process.argv.slice(2);
  if (mode === "--references" && directory && !packageDirectory) {
    const result = appHostingReferences(JSON.parse(read(directory)));
    console.log(
      `${result.originAccessControlId} ${result.responseHeadersPolicyId}`,
    );
  } else if (mode === "--audit" && directory && !packageDirectory) {
    auditAppSurface(directory);
    const manifest = JSON.parse(read(resolve(directory, "app-surface.json")));
    if (
      manifest.appOrigin !== "https://app.visualnerve.com" ||
      manifest.websiteOrigin !== "https://www.visualnerve.com"
    )
      fail("only the canonical production app package may be published.");
    console.log("Isolated app package audit passed.");
  } else if (mode === "--verify" && directory && packageDirectory) {
    const input = Object.fromEntries(
      [
        "identity",
        "distribution",
        "location",
        "oac",
        "headers",
        "publicAccess",
        "ownership",
        "bucketPolicy",
        "functionDescription",
      ].map((name) => [
        name,
        JSON.parse(read(resolve(directory, `${name}.json`))),
      ]),
    );
    input.websiteAbsent =
      read(resolve(directory, "website-absent.txt")).trim() ===
      "NoSuchWebsiteConfiguration";
    input.functionSource = read(resolve(directory, "function.js"));
    const manifest = JSON.parse(
      read(resolve(packageDirectory, "app-surface.json")),
    );
    console.log(
      `Read-only app hosting verification passed: ${JSON.stringify(verifyAppHosting(input, manifest))}`,
    );
  } else
    fail(
      "use --audit <public-app>, --references <distribution.json>, or --verify <review-directory> <public-app>.",
    );
}
