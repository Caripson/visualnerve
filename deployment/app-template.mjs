import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { template } from "./template.mjs";
import {
  APP_ORIGIN,
  appContentSecurityPolicy,
  appResponseHeaders,
} from "./app-policy.mjs";

// A distinct stack/output: importing this module never changes the www template or AWS.
export const appTemplate = structuredClone(template);
appTemplate.Description =
  "Visual Nerve isolated app origin: audited local workspace/assets only. No marketing scripts, content API or server database.";
appTemplate.Metadata = {
  Surface: "isolated-app",
  OutputDirectory: "public-app",
  Deployment:
    "manual Deploy isolated app workflow; exact release gates required; generating this template does not deploy",
};
appTemplate.Parameters.BucketName.Description =
  "Separate private app bucket. Configure after infrastructure review; never use the www.visualnerve.com bucket.";
appTemplate.Parameters.BucketName.AllowedPattern =
  "^$|^(?!www\\.visualnerve\\.com$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$";
appTemplate.Parameters.CanonicalDomain.Default = new URL(APP_ORIGIN).hostname;
appTemplate.Parameters.CanonicalDomain.AllowedPattern =
  "^(?!www\\.visualnerve\\.com$|visualnerve\\.caripson\\.com$)[a-z0-9][a-z0-9.-]+[a-z0-9]$";
appTemplate.Parameters.AlternateDomain.Description =
  "Optional app-origin alias only; do not redirect the existing www workspace here.";
appTemplate.Parameters.AlternateDomain.AllowedPattern =
  "^$|^(?!www\\.visualnerve\\.com$|visualnerve\\.caripson\\.com$)[a-z0-9][a-z0-9.-]+[a-z0-9]$";
appTemplate.Parameters.BridgePort = {
  Type: "Number",
  Default: 4317,
  MinValue: 1,
  MaxValue: 65535,
  Description:
    "Approved loopback bridge port. Match the output APP_BRIDGE_PORTS policy; custom UI ports require an explicitly reviewed policy update.",
};
const headers = appResponseHeaders();
appTemplate.Resources.AppHeaders = {
  Type: "AWS::CloudFront::ResponseHeadersPolicy",
  Properties: {
    ResponseHeadersPolicyConfig: {
      Name: { "Fn::Sub": "${AWS::StackName}-isolated-app-headers" },
      Comment:
        "App-origin policy only; no script exceptions for marketing analytics.",
      SecurityHeadersConfig: {
        ContentSecurityPolicy: {
          ContentSecurityPolicy: {
            "Fn::Sub": appContentSecurityPolicy().replaceAll(
              ":4317/bridge",
              ":${BridgePort}/bridge",
            ),
          },
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
        Items: [
          "Permissions-Policy",
          "Cross-Origin-Opener-Policy",
          "Cross-Origin-Resource-Policy",
          "X-Robots-Tag",
        ].map((Header) => ({ Header, Value: headers[Header], Override: true })),
      },
    },
  },
};
appTemplate.Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId =
  { Ref: "AppHeaders" };

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
if (isMain()) process.stdout.write(`${JSON.stringify(appTemplate, null, 2)}\n`);
