import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appResponseHeaders } from "./app-policy.mjs";

export const EXISTING_APP_TARGET = Object.freeze({
  domainName: "app.visualnerve.com",
  bucketName: "app.visualnerve.com",
  distributionId: "E10TKGRYWGM422",
  region: "us-east-1",
});
const fail = (message) => {
  throw new Error(`App resource review: ${message}`);
};
const items = (value, name) => {
  const list = value?.Items ?? [];
  if (!Array.isArray(list) || value?.Quantity !== list.length)
    fail(`${name} has inconsistent quantities.`);
  return list;
};
const routingName = `visualnerve-isolated-app-routes-${EXISTING_APP_TARGET.distributionId}`;

export function existingAppTarget(input) {
  if (!input || typeof input !== "object")
    fail("Provide the reviewed target inputs.");
  for (const [key, expected] of Object.entries(EXISTING_APP_TARGET))
    if (input[key] !== undefined && input[key] !== expected)
      fail(`The ${key} does not match the existing isolated app target.`);
  if (
    !/^\d{12}$/.test(input.accountId ?? "") ||
    input.accountId === "000000000000"
  )
    fail("Provide the actual twelve-digit owner account ID.");
  if (!/^E[A-Z0-9]{7,31}$/.test(input.originAccessControlId ?? ""))
    fail("Provide the reviewed prospective origin access control ID.");
  if (
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(
      input.responseHeadersPolicyId ?? "",
    )
  )
    fail("Provide the reviewed prospective response-header policy ID.");
  const functionArn = `arn:aws:cloudfront::${input.accountId}:function/${routingName}`;
  if (input.viewerRequestFunctionArn !== functionArn)
    fail(
      "Use the dedicated isolated-app route function ARN, never a shared website function.",
    );
  const headers = appResponseHeaders(
    input.bridgePorts,
    input.collaborationRelayOrigin,
  );
  return {
    ...EXISTING_APP_TARGET,
    accountId: input.accountId,
    originAccessControlId: input.originAccessControlId,
    responseHeadersPolicyId: input.responseHeadersPolicyId,
    viewerRequestFunctionArn: functionArn,
    bridgePorts: [...(input.bridgePorts ?? [4317])],
    ...(input.collaborationRelayOrigin !== undefined
      ? { collaborationRelayOrigin: input.collaborationRelayOrigin }
      : {}),
    headers,
  };
}

function headerPolicy(headers) {
  return {
    Name: `visualnerve-isolated-app-headers-${EXISTING_APP_TARGET.distributionId}`,
    Comment:
      "Reviewed isolated app security headers; no marketing script exceptions.",
    SecurityHeadersConfig: {
      ContentSecurityPolicy: {
        ContentSecurityPolicy: headers["Content-Security-Policy"],
        Override: true,
      },
      ContentTypeOptions: { Override: true },
      FrameOptions: { FrameOption: "DENY", Override: true },
      ReferrerPolicy: { ReferrerPolicy: "no-referrer", Override: true },
      StrictTransportSecurity: {
        AccessControlMaxAgeSec: 31536000,
        IncludeSubdomains: false,
        Preload: false,
        Override: true,
      },
    },
    CustomHeadersConfig: {
      Quantity: 4,
      Items: [
        "Permissions-Policy",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Resource-Policy",
        "X-Robots-Tag",
      ].map((Header) => ({ Header, Value: headers[Header], Override: true })),
    },
  };
}

/** Pure preparation: output uses AWS CLI input shapes but never calls AWS or writes files. */
export function prepareExistingAppResources(snapshot, input) {
  const target = existingAppTarget(input);
  if (
    !snapshot ||
    typeof snapshot.ETag !== "string" ||
    !/^E[A-Z0-9]+$/.test(snapshot.ETag)
  )
    fail(
      "Provide a fresh get-distribution-config snapshot including its ETag.",
    );
  if (snapshot.Id !== undefined && snapshot.Id !== target.distributionId)
    fail("The snapshot belongs to another distribution.");
  const config = structuredClone(snapshot.DistributionConfig);
  if (
    !config ||
    typeof config.CallerReference !== "string" ||
    !config.CallerReference ||
    config.Enabled !== true
  )
    fail("Expected the complete enabled distribution configuration.");
  const aliases = items(config.Aliases, "Aliases");
  if (aliases.length !== 1 || aliases[0] !== target.domainName)
    fail("Only the exact isolated app alias is supported.");
  if (
    items(config.Origins, "Origins").length !== 1 ||
    items(config.OriginGroups, "OriginGroups").length ||
    items(config.CacheBehaviors, "CacheBehaviors").length
  )
    fail(
      "Extra origins, failover or cache behaviors require separate manual review.",
    );
  const origin = config.Origins.Items[0];
  const restHost = `${target.bucketName}.s3.${target.region}.amazonaws.com`;
  const allowedOrigins = [
    restHost,
    `${target.bucketName}.s3-website-${target.region}.amazonaws.com`,
    `${target.bucketName}.s3-website.${target.region}.amazonaws.com`,
  ];
  if (
    !allowedOrigins.includes(origin.DomainName) ||
    !origin.Id ||
    origin.OriginPath
  )
    fail("The origin must be the reviewed app bucket root.");
  if (items(origin.CustomHeaders, "Origin custom headers").length)
    fail(
      "Origin headers may contain secrets; do not include them in review artifacts.",
    );
  const behavior = config.DefaultCacheBehavior;
  if (!behavior || behavior.TargetOriginId !== origin.Id)
    fail("The default behavior must reference the app bucket origin.");
  const certificate = config.ViewerCertificate;
  if (
    certificate?.CloudFrontDefaultCertificate !== false ||
    !new RegExp(
      `^arn:aws:acm:us-east-1:${target.accountId}:certificate/[\\da-f-]+$`,
      "i",
    ).test(certificate.ACMCertificateArn ?? "")
  )
    fail(
      "Preserve the reviewed app ACM certificate in the owner account and us-east-1.",
    );
  const functions = items(
    behavior.FunctionAssociations,
    "FunctionAssociations",
  );
  if (
    functions.some(
      (item) =>
        item.EventType === "viewer-request" &&
        item.FunctionARN !== target.viewerRequestFunctionArn,
    ) ||
    items(
      behavior.LambdaFunctionAssociations,
      "LambdaFunctionAssociations",
    ).some((item) => item.EventType === "viewer-request")
  )
    fail("An existing viewer-request handler requires separate review.");
  const errors = items(config.CustomErrorResponses, "CustomErrorResponses");
  if (
    errors.some((item) => !Number.isInteger(item.ErrorCode)) ||
    new Set(errors.map((item) => item.ErrorCode)).size !== errors.length
  )
    fail("Custom error status codes must be distinct integer codes.");
  if (errors.some((item) => String(item.ResponseCode) === "200"))
    fail(
      "Do not retain a global HTTP200 error fallback for app or Help routes.",
    );

  // Keep CallerReference, aliases/certificate, WAF, logging, policies and unrelated fields.
  origin.DomainName = restHost;
  origin.OriginPath = "";
  delete origin.CustomOriginConfig;
  origin.S3OriginConfig = { OriginAccessIdentity: "" };
  origin.OriginAccessControlId = target.originAccessControlId;
  behavior.ViewerProtocolPolicy = "redirect-to-https";
  behavior.AllowedMethods = {
    Quantity: 2,
    Items: ["GET", "HEAD"],
    CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
  };
  behavior.ResponseHeadersPolicyId = target.responseHeadersPolicyId;
  behavior.FunctionAssociations = {
    Quantity:
      functions.filter((item) => item.EventType !== "viewer-request").length +
      1,
    Items: [
      ...functions.filter((item) => item.EventType !== "viewer-request"),
      {
        FunctionARN: target.viewerRequestFunctionArn,
        EventType: "viewer-request",
      },
    ],
  };
  if (behavior.GrpcConfig) behavior.GrpcConfig.Enabled = false;
  if (
    !["TLSv1.2_2021", "TLSv1.2_2025", "TLSv1.3_2025"].includes(
      certificate.MinimumProtocolVersion,
    )
  )
    certificate.MinimumProtocolVersion = "TLSv1.2_2021";
  config.DefaultRootObject = "index.html";
  const retainedErrors = errors.filter(
    (item) => ![403, 404].includes(item.ErrorCode),
  );
  config.CustomErrorResponses = {
    Quantity: retainedErrors.length + 2,
    Items: [
      ...retainedErrors,
      ...[403, 404].map((ErrorCode) => ({
        ErrorCode,
        ResponsePagePath: "/error.html",
        ResponseCode: "404",
        ErrorCachingMinTTL: 0,
      })),
    ],
  };
  const distributionArn = `arn:aws:cloudfront::${target.accountId}:distribution/${target.distributionId}`;
  const bucketArn = `arn:aws:s3:::${target.bucketName}`;
  const { headers, ...identity } = target;
  const routingSource = readFileSync(
    new URL("./viewer-request.js", import.meta.url),
    "utf8",
  ).replace("__CANONICAL_HOST__", target.domainName);
  return {
    format: "visual-nerve-existing-app-resource-plan",
    schemaVersion: 1,
    requiresManualApproval: true,
    target: identity,
    updateDistribution: {
      Id: target.distributionId,
      IfMatch: snapshot.ETag,
      DistributionConfig: config,
    },
    createOriginAccessControl: {
      OriginAccessControlConfig: {
        Name: `visualnerve-isolated-app-oac-${target.distributionId}`,
        Description: "Private isolated app static origin only.",
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    },
    createResponseHeadersPolicy: {
      ResponseHeadersPolicyConfig: headerPolicy(headers),
    },
    bucketPolicy: {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "AllowExactAppDistributionReadOnly",
          Effect: "Allow",
          Principal: { Service: "cloudfront.amazonaws.com" },
          Action: "s3:GetObject",
          Resource: `${bucketArn}/*`,
          Condition: { StringEquals: { "AWS:SourceArn": distributionArn } },
        },
        {
          Sid: "DenyInsecureTransport",
          Effect: "Deny",
          Principal: "*",
          Action: "s3:*",
          Resource: [bucketArn, `${bucketArn}/*`],
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ],
    },
    publicAccessBlock: {
      Bucket: target.bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    },
    ownershipControls: {
      Bucket: target.bucketName,
      OwnershipControls: {
        Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
      },
    },
    deleteBucketWebsite: { Bucket: target.bucketName },
    viewerRequestFunction: {
      Name: routingName,
      FunctionConfig: {
        Comment:
          "Canonical isolated app host and real directory objects; no global SPA fallback.",
        Runtime: "cloudfront-js-2.0",
      },
      FunctionCode: Buffer.from(routingSource).toString("base64"),
    },
    viewerRequestFunctionSource: routingSource,
  };
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
if (isMain()) {
  if (process.argv.length !== 4)
    fail(
      "Usage: node deployment/app-existing-resources.mjs <sanitized-config.json> <reviewed-target.json>",
    );
  const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const target = JSON.parse(readFileSync(process.argv[3], "utf8"));
  process.stdout.write(
    `${JSON.stringify(prepareExistingAppResources(snapshot, target), null, 2)}\n`,
  );
}
