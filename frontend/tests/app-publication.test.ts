// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
  APP_ACCOUNT,
  APP_FUNCTION,
  verifyAppHosting,
} from '../../deployment/verify-app-hosting.mjs';
import { prepareExistingAppResources } from '../../deployment/app-existing-resources.mjs';
import { appResponseHeaders } from '../../deployment/app-policy.mjs';
import { buildAppSurface } from '../../scripts/build-app-surface.mjs';

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);
const sha = 'a'.repeat(40);
function reviewed(bridgePorts = [4317]) {
  const plan = prepareExistingAppResources(
    {
      ETag: 'EREVIEW1234567',
      DistributionConfig: {
        CallerReference: 'existing-owner-reference',
        Enabled: true,
        Aliases: { Quantity: 1, Items: ['app.visualnerve.com'] },
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: 'app-origin',
              DomainName: 'app.visualnerve.com.s3-website-us-east-1.amazonaws.com',
              CustomHeaders: { Quantity: 0 },
            },
          ],
        },
        OriginGroups: { Quantity: 0 },
        CacheBehaviors: { Quantity: 0 },
        CustomErrorResponses: { Quantity: 0 },
        DefaultCacheBehavior: {
          TargetOriginId: 'app-origin',
          FunctionAssociations: { Quantity: 0 },
          LambdaFunctionAssociations: { Quantity: 0 },
        },
        ViewerCertificate: {
          CloudFrontDefaultCertificate: false,
          ACMCertificateArn: `arn:aws:acm:us-east-1:${APP_ACCOUNT}:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
          MinimumProtocolVersion: 'TLSv1.2_2021',
        },
      },
    },
    {
      accountId: APP_ACCOUNT,
      originAccessControlId: 'EOAC123456789',
      responseHeadersPolicyId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      viewerRequestFunctionArn: `arn:aws:cloudfront::${APP_ACCOUNT}:function/${APP_FUNCTION}`,
      bridgePorts,
    },
  );
  const input = {
    identity: { Account: APP_ACCOUNT },
    distribution: {
      Distribution: {
        Id: 'E10TKGRYWGM422',
        ARN: `arn:aws:cloudfront::${APP_ACCOUNT}:distribution/E10TKGRYWGM422`,
        Status: 'Deployed',
        DistributionConfig: plan.updateDistribution.DistributionConfig,
      },
    },
    oac: { OriginAccessControl: { Id: 'EOAC123456789', ...plan.createOriginAccessControl } },
    headers: {
      ResponseHeadersPolicy: {
        Id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ...plan.createResponseHeadersPolicy,
      },
    },
    location: { LocationConstraint: null },
    websiteAbsent: true,
    publicAccess: {
      PublicAccessBlockConfiguration: plan.publicAccessBlock.PublicAccessBlockConfiguration,
    },
    ownership: { OwnershipControls: plan.ownershipControls.OwnershipControls },
    bucketPolicy: { Policy: JSON.stringify(plan.bucketPolicy) },
    functionDescription: {
      FunctionSummary: {
        Name: APP_FUNCTION,
        FunctionConfig: { Runtime: 'cloudfront-js-2.0' },
        FunctionMetadata: {
          FunctionARN: `arn:aws:cloudfront::${APP_ACCOUNT}:function/${APP_FUNCTION}`,
          Stage: 'LIVE',
        },
      },
    },
    functionSource: plan.viewerRequestFunctionSource,
  };
  const manifest = {
    format: 'visual-nerve-app-surface',
    schemaVersion: 1,
    vaultRequired: true,
    appOrigin: 'https://app.visualnerve.com',
    websiteOrigin: 'https://www.visualnerve.com',
    bridgePorts,
    responseHeaders: appResponseHeaders(bridgePorts),
  };
  return { input, manifest };
}

describe('isolated app read-only hosting release check', () => {
  it('accepts the hardened existing-resource plan without changing any source configuration', () => {
    const { input, manifest } = reviewed([4317, 9443]);
    const original = structuredClone(input);
    expect(verifyAppHosting(input, manifest)).toMatchObject({
      bucket: 'app.visualnerve.com',
      distributionId: 'E10TKGRYWGM422',
      accountId: APP_ACCOUNT,
      bridgePorts: [4317, 9443],
    });
    expect(input).toEqual(original);
    input.distribution.Distribution.DistributionConfig.DefaultCacheBehavior.AllowedMethods.Items.reverse();
    expect(verifyAppHosting(input, manifest)).toHaveProperty(
      'originAccessControlId',
      'EOAC123456789',
    );
  });
  it.each([
    [
      'different account',
      (input: any) => {
        input.identity.Account = '123456789012';
      },
    ],
    [
      'website origin',
      (input: any) => {
        input.distribution.Distribution.DistributionConfig.Origins.Items[0].DomainName =
          'app.visualnerve.com.s3-website-us-east-1.amazonaws.com';
      },
    ],
    [
      'deployment in progress',
      (input: any) => {
        input.distribution.Distribution.Status = 'InProgress';
      },
    ],
    [
      'unsigned OAC',
      (input: any) => {
        input.oac.OriginAccessControl.OriginAccessControlConfig.SigningBehavior = 'never';
      },
    ],
    [
      'public bucket',
      (input: any) => {
        input.publicAccess.PublicAccessBlockConfiguration.BlockPublicPolicy = false;
      },
    ],
    [
      'object ACLs',
      (input: any) => {
        input.ownership.OwnershipControls.Rules[0].ObjectOwnership = 'ObjectWriter';
      },
    ],
    [
      'wrong region',
      (input: any) => {
        input.location.LocationConstraint = 'eu-west-1';
      },
    ],
    [
      'website enabled',
      (input: any) => {
        input.websiteAbsent = false;
      },
    ],
    [
      'wrong distribution policy grant',
      (input: any) => {
        const policy = JSON.parse(input.bucketPolicy.Policy);
        policy.Statement[0].Condition.StringEquals['AWS:SourceArn'] =
          `arn:aws:cloudfront::${APP_ACCOUNT}:distribution/E2DFG7DKVLDNIQ`;
        input.bucketPolicy.Policy = JSON.stringify(policy);
      },
    ],
    [
      'public policy grant',
      (input: any) => {
        const policy = JSON.parse(input.bucketPolicy.Policy);
        policy.Statement.push({
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::app.visualnerve.com/*',
        });
        input.bucketPolicy.Policy = JSON.stringify(policy);
      },
    ],
    [
      'weakened CSP',
      (input: any) => {
        input.headers.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy +=
          "; script-src 'unsafe-eval'";
      },
    ],
    [
      'missing anti-framing header',
      (input: any) => {
        input.headers.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.SecurityHeadersConfig.FrameOptions.Override = false;
      },
    ],
    [
      'wrong noindex header',
      (input: any) => {
        input.headers.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items.find(
          (item: any) => item.Header === 'X-Robots-Tag',
        ).Value = 'index';
      },
    ],
    [
      'CORS exception',
      (input: any) => {
        input.headers.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.CorsConfig = {};
      },
    ],
    [
      'removed security header',
      (input: any) => {
        input.headers.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.RemoveHeadersConfig = {
          Quantity: 1,
          Items: [{ Header: 'Content-Security-Policy' }],
        };
      },
    ],
    [
      'global SPA fallback',
      (input: any) => {
        input.distribution.Distribution.DistributionConfig.CustomErrorResponses.Items[0].ResponseCode =
          '200';
      },
    ],
    [
      'wrong live source',
      (input: any) => {
        input.functionSource += '\n// unreleased edit';
      },
    ],
    [
      'development function',
      (input: any) => {
        input.functionDescription.FunctionSummary.FunctionMetadata.Stage = 'DEVELOPMENT';
      },
    ],
  ])('rejects %s before uploads', (_name, mutate) => {
    const { input, manifest } = reviewed();
    mutate(input);
    expect(() => verifyAppHosting(input, manifest)).toThrow('App publication refused');
  });
  it('rejects a custom-preview package or a policy with different loopback ports', () => {
    const { input, manifest } = reviewed();
    expect(() =>
      verifyAppHosting(input, { ...manifest, appOrigin: 'https://preview.visualnerve.com' }),
    ).toThrow('production package');
    const different = {
      ...manifest,
      bridgePorts: [9443],
      responseHeaders: appResponseHeaders([9443]),
    };
    expect(() => verifyAppHosting(input, different)).toThrow('response headers');
  });
});

async function shellFixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'visualnerve-app-publication-')));
  temporary.push(directory);
  const alias = join(directory, 'checkout alias #%');
  symlinkSync(directory, alias, 'dir');
  const put = (path: string, data: string, mode?: number) => {
    mkdirSync(dirname(join(alias, path)), { recursive: true });
    writeFileSync(join(alias, path), data, mode ? { mode } : undefined);
  };
  for (const path of [
    'scripts/deploy-app.sh',
    'scripts/require-ci.mjs',
    'deployment/verify-app-hosting.mjs',
    'deployment/app-surface-audit.mjs',
    'deployment/app-policy.mjs',
    'deployment/app-existing-resources.mjs',
    'deployment/require-app-approval.mjs',
    'deployment/viewer-request.js',
  ]) {
    mkdirSync(dirname(join(alias, path)), { recursive: true });
    copyFileSync(new URL(`../../${path}`, import.meta.url), join(alias, path));
  }
  const shell = (body: string) =>
    `<html><head><title>Fixture</title></head><body><header class="site-shell"><a class="site-brand" href="/"><span class="brand-symbol">⌘</span><b>Visual Nerve</b></a></header>${body}</body></html>`;
  put('public/index.html', shell('<main>Public marketing</main>'));
  put('public/app/index.html', shell('<div id="visual-nerve"></div>'));
  put('public/error.html', shell('<main>Error</main>'));
  put('public/editor/app.js', 'export const app = 1;');
  put('public/editor/app.css', '.app{}');
  put('public/editor/assets/example-hashed.js', 'export const worker = 1;');
  put('public/appearance.js', 'window.appearance = 1;');
  put('public/sw.js', '// public worker');
  put('public/site/mark.svg', '<svg/>');
  put('public/site/syntax.css', '.syntax{}');
  put('public/help/index.html', shell('<main class="help-main">Help</main>'));
  put('public/help/help.js', 'window.help = 1;');
  put('public/help/help.css', '.help{}');
  put('public/help/index.json', '[]');
  put('public/openapi.yaml', '{"paths":{}}');
  put('public/api/docs/index.html', shell('<main id="swagger-ui"></main>'));
  put('public/api/docs/docs.js', 'window.docs = 1;');
  put('public/api/docs/docs.css', '.docs{}');
  put('public/swagger/swagger-ui-bundle.js', 'window.SwaggerUIBundle = () => {};');
  put('public/swagger/swagger-ui.css', '.swagger-ui{}');
  put('public/licenses/inventory.json', '[]');
  put('public/licenses/example-LICENSE.BSD', 'License');
  for (const name of ['privacy', 'security', 'license'])
    put(
      `public/${name}/index.html`,
      shell(`<h1>${name}</h1><article class="product-article">Policy</article>`),
    );
  await buildAppSurface(join(alias, 'public'), join(alias, 'public-app'));
  const { input } = reviewed();
  for (const [name, value] of Object.entries(input))
    put(`review/${name}.json`, JSON.stringify(value));
  put('review/function.js', input.functionSource);
  put(
    'test-bin/node',
    `#!/usr/bin/env bash\nif [[ "$1" == */scripts/require-ci.mjs ]]; then\n  echo CI >> "$VN_TEST_GATE_LOG"\n  if [[ "\${VN_TEST_FAIL_CI:-}" == '1' || "\${VN_TEST_SECOND_CI:-}" == '1' && $(wc -l < "$VN_TEST_GATE_LOG") -ge 2 ]]; then exit 1; fi\n  exit 0\nfi\nexec "$VN_TEST_REAL_NODE" "$@"\n`,
    0o755,
  );
  put(
    'test-bin/aws',
    `#!${process.execPath}\nconst fs = require('node:fs'), path = require('node:path');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.VN_TEST_AWS_LOG, JSON.stringify(args) + '\\n');\nconst command = args.slice(0,2).join(' ');\nconst names = {'sts get-caller-identity':'identity','cloudfront get-distribution':'distribution','cloudfront get-origin-access-control':'oac','cloudfront get-response-headers-policy':'headers','cloudfront describe-function':'functionDescription','s3api get-bucket-location':'location','s3api get-public-access-block':'publicAccess','s3api get-bucket-ownership-controls':'ownership','s3api get-bucket-policy':'bucketPolicy'};\nif (names[command]) process.stdout.write(fs.readFileSync(path.join(process.env.VN_TEST_REVIEW,names[command]+'.json')));\nelse if (command === 'cloudfront get-function') { fs.copyFileSync(path.join(process.env.VN_TEST_REVIEW,'function.js'),args[args.indexOf('--stage')+2]); process.stdout.write('{"ETag":"EFUNCTION1234","ContentType":"application/javascript"}'); }\nelse if (command === 's3api get-bucket-website') { console.error('An error occurred ('+(process.env.VN_TEST_WEBSITE_ERROR || 'NoSuchWebsiteConfiguration')+') when calling the GetBucketWebsite operation'); process.exitCode=254; }\nelse if (command === 'cloudfront create-invalidation') process.stdout.write('IEXAMPLE1234\\n');\nelse if (command === 's3 rm' && args[2] === 's3://app.visualnerve.com/app/index.html') { if (process.env.VN_TEST_FAIL_RETIRE === '1') process.exitCode=1; }\nelse if (command !== 's3 cp' && command !== 'cloudfront wait') { console.error('Unexpected AWS command'); process.exitCode=1; }\n`,
    0o755,
  );
  const awsLog = join(alias, 'aws.log');
  const deploy = (extra: Record<string, string> = {}, args = ['--dry-run']) =>
    spawnSync('bash', [join(alias, 'scripts/deploy-app.sh'), ...args], {
      cwd: alias,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(alias, 'test-bin')}${delimiter}${process.env.PATH}`,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: sha,
        APP_SURFACE_APPROVED_SHA: sha,
        APP_SURFACE_STAGING_VERIFIED_SHA: sha,
        PRODUCTION_APPROVED_SHA: sha,
        VN_TEST_REAL_NODE: process.execPath,
        VN_TEST_REVIEW: join(alias, 'review'),
        VN_TEST_AWS_LOG: awsLog,
        VN_TEST_GATE_LOG: join(alias, 'gate.log'),
        ...extra,
      },
    });
  const calls = () => {
    try {
      return readFileSync(awsLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
    } catch {
      return [];
    }
  };
  return { directory, alias, deploy, calls, put };
}

describe('manual app publication shell boundary', () => {
  it('reads and validates private hosting, rechecks gates, and dry-runs only app files with explicit notice MIME and ordered publication', async () => {
    const { deploy, calls, alias } = await shellFixture();
    const result = deploy({
      APP_S3_BUCKET: 'www.visualnerve.com',
      APP_CLOUDFRONT_DISTRIBUTION_ID: 'E2DFG7DKVLDNIQ',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Read-only app hosting verification passed');
    const commands = calls();
    expect(
      commands
        .slice(0, 11)
        .every((args) => args[1].startsWith('get-') || args[1] === 'describe-function'),
    ).toBe(true);
    const uploads = commands.filter((args) => args[0] === 's3' && args[1] === 'cp');
    expect(uploads).toHaveLength(6);
    expect(
      uploads.every(
        (args) =>
          args[1] === 'cp' &&
          args[2].startsWith(`${join(alias, 'public-app')}/`) &&
          args[3].startsWith('s3://app.visualnerve.com/') &&
          args.includes('--dryrun'),
      ),
    ).toBe(true);
    expect(uploads[0].join(' ')).toContain('public,max-age=31536000,immutable');
    expect(uploads[2].join(' ')).toContain('--content-type text/plain');
    expect(uploads[3].join(' ')).toContain('--content-type application/json');
    expect(uploads[4].join(' ')).toContain('--include *.html');
    expect(uploads[5][2]).toBe(join(alias, 'public-app/sw.js'));
    expect(commands.filter((args) => args[0] === 's3' && args[1] === 'rm')).toEqual([
      ['s3', 'rm', 's3://app.visualnerve.com/app/index.html', '--dryrun'],
    ]);
    expect(readFileSync(join(alias, 'gate.log'), 'utf8').trim().split('\n')).toEqual(['CI', 'CI']);
    expect(commands.some((args) => args[1] === 'create-invalidation')).toBe(false);
  });
  it('waits for invalidation only after the uploads and narrow legacy shell removal succeed', async () => {
    const { deploy, calls } = await shellFixture();
    const result = deploy({}, []);
    expect(result.status, result.stderr).toBe(0);
    expect(calls().slice(-2)).toEqual([
      [
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        'E10TKGRYWGM422',
        '--paths',
        '/*',
        '--query',
        'Invalidation.Id',
        '--output',
        'text',
      ],
      [
        'cloudfront',
        'wait',
        'invalidation-completed',
        '--distribution-id',
        'E10TKGRYWGM422',
        '--id',
        'IEXAMPLE1234',
      ],
    ]);
  });
  it('does not invalidate a release if narrow removal of the retired app shell fails', async () => {
    const { deploy, calls } = await shellFixture();
    const result = deploy({ VN_TEST_FAIL_RETIRE: '1' }, []);
    expect(result.status).not.toBe(0);
    expect(calls().at(-1)).toEqual(['s3', 'rm', 's3://app.visualnerve.com/app/index.html']);
    expect(calls().some((args) => args[1] === 'create-invalidation')).toBe(false);
  });
  it('rejects weakened deployed headers before any object upload', async () => {
    const fixture = await shellFixture();
    const { input } = reviewed();
    const config = Reflect.get(input.headers.ResponseHeadersPolicy, 'ResponseHeadersPolicyConfig');
    config.SecurityHeadersConfig.FrameOptions.Override = false;
    fixture.put('review/headers.json', JSON.stringify(input.headers));
    const result = fixture.deploy({}, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('all nine deployed app response headers');
    expect(
      fixture.calls().some((args) => args[0] === 's3' || args[1] === 'create-invalidation'),
    ).toBe(false);
  });
  it('never accesses AWS without exact app approval and successful CI', async () => {
    const fixture = await shellFixture();
    expect(fixture.deploy({ APP_SURFACE_APPROVED_SHA: '' }).status).not.toBe(0);
    expect(fixture.calls()).toEqual([]);
    expect(fixture.deploy({ VN_TEST_FAIL_CI: '1' }).status).not.toBe(0);
    expect(fixture.calls()).toEqual([]);
  });
  it('rejects user exports before AWS and rejects failed website absence or late gate revocation before writes', async () => {
    const first = await shellFixture();
    first.put('public-app/licenses/private-backup.json', '{"format":"visual-nerve-workspace"}');
    const rejected = first.deploy();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('User export');
    expect(first.calls()).toEqual([]);
    const second = await shellFixture();
    expect(second.deploy({ VN_TEST_WEBSITE_ERROR: 'AccessDenied' }).status).not.toBe(0);
    expect(second.calls().some((args) => args[0] === 's3')).toBe(false);
    const third = await shellFixture();
    expect(third.deploy({ VN_TEST_SECOND_CI: '1' }).status).not.toBe(0);
    expect(third.calls().some((args) => args[0] === 's3')).toBe(false);
  });
  it('does not associate or change any AWS resource and never uses the website upload script', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/deploy-app.yml', import.meta.url),
      'utf8',
    );
    expect(workflow).toMatch(/on:\s+workflow_dispatch:/);
    expect(workflow).not.toMatch(/workflow_run:|push:|schedule:|deploy-static\.sh/);
    expect(workflow).toContain('name: app-production');
    expect(workflow).toContain('allowed-account-ids: "094904000140"');
    expect(workflow).toContain('run: ./scripts/deploy-app.sh');
    const script = readFileSync(new URL('../../scripts/deploy-app.sh', import.meta.url), 'utf8');
    expect(script).not.toMatch(
      /s3 sync|--delete|update-distribution|put-bucket|create-origin|create-response|publish-function/,
    );
  });
});
