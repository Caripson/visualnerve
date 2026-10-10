// @vitest-environment node
import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  EXISTING_APP_TARGET,
  existingAppTarget,
  prepareExistingAppResources,
} from '../../deployment/app-existing-resources.mjs';

const input = {
  accountId: '123456789012',
  originAccessControlId: 'EOAC123456789',
  responseHeadersPolicyId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  viewerRequestFunctionArn:
    'arn:aws:cloudfront::123456789012:function/visualnerve-isolated-app-routes-E10TKGRYWGM422',
};

it('prepares only the explicit reviewed relay origins without changing website resources', () => {
  const origin = 'https://relay.example.com';
  const initial = snapshot();
  const untouched = structuredClone(initial);
  const prepared = prepareExistingAppResources(initial, {
    ...input,
    collaborationRelayOrigin: origin,
  });
  expect(initial).toEqual(untouched);
  expect(prepared.target.collaborationRelayOrigin).toBe(origin);
  const csp =
    prepared.createResponseHeadersPolicy.ResponseHeadersPolicyConfig.SecurityHeadersConfig
      .ContentSecurityPolicy.ContentSecurityPolicy;
  expect(csp).toContain(` ${origin} wss://relay.example.com`);
  expect(csp).not.toContain('https://*.');
  expect(() =>
    existingAppTarget({
      ...input,
      collaborationRelayOrigin: 'https://relay.example.com;script-src',
    }),
  ).toThrow();
});
function snapshot() {
  return {
    ETag: 'EREVIEW1234567',
    DistributionConfig: {
      CallerReference: 'unchanged-owner-caller-reference',
      Aliases: { Quantity: 1, Items: ['app.visualnerve.com'] },
      DefaultRootObject: '',
      Origins: {
        Quantity: 1,
        Items: [
          {
            Id: 'owner-origin-identifier',
            DomainName: 'app.visualnerve.com.s3-website-us-east-1.amazonaws.com',
            OriginPath: '',
            CustomHeaders: { Quantity: 0 },
            CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'http-only' },
            ConnectionAttempts: 3,
            ConnectionTimeout: 10,
            OriginShield: { Enabled: false },
            OriginAccessControlId: '',
          },
        ],
      },
      OriginGroups: { Quantity: 0 },
      DefaultCacheBehavior: {
        TargetOriginId: 'owner-origin-identifier',
        TrustedSigners: { Enabled: false, Quantity: 0 },
        TrustedKeyGroups: { Enabled: false, Quantity: 0 },
        ViewerProtocolPolicy: 'allow-all',
        AllowedMethods: {
          Quantity: 7,
          Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
          CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
        },
        Compress: true,
        LambdaFunctionAssociations: { Quantity: 0 },
        FunctionAssociations: { Quantity: 0 },
        FieldLevelEncryptionId: '',
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
        GrpcConfig: { Enabled: false },
      },
      CacheBehaviors: { Quantity: 0 },
      CustomErrorResponses: { Quantity: 0, Items: [] as Record<string, unknown>[] },
      Logging: { Enabled: false, IncludeCookies: false, Bucket: '', Prefix: '' },
      PriceClass: 'PriceClass_100',
      Enabled: true,
      ViewerCertificate: {
        CloudFrontDefaultCertificate: false,
        ACMCertificateArn:
          'arn:aws:acm:us-east-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        MinimumProtocolVersion: 'TLSv1',
        SSLSupportMethod: 'sni-only',
        CertificateSource: 'acm',
      },
      Restrictions: { GeoRestriction: { RestrictionType: 'none', Quantity: 0 } },
      WebACLId: 'preserved-owner-waf-reference',
      HttpVersion: 'http2',
      IsIPV6Enabled: true,
    },
  };
}

it('prepares complete ETag-fenced AWS API shapes without mutating the existing snapshot or unrelated owner fields', () => {
  const before = snapshot();
  const original = structuredClone(before);
  const plan = prepareExistingAppResources(before, input);
  expect(before).toEqual(original);
  expect(plan.requiresManualApproval).toBe(true);
  expect(plan.updateDistribution.Id).toBe('E10TKGRYWGM422');
  expect(plan.updateDistribution.IfMatch).toBe(before.ETag);
  expect(plan.updateDistribution).not.toHaveProperty('ETag');
  const updated = plan.updateDistribution.DistributionConfig;
  for (const key of [
    'CallerReference',
    'Aliases',
    'Logging',
    'PriceClass',
    'Restrictions',
    'WebACLId',
    'HttpVersion',
    'IsIPV6Enabled',
    'Enabled',
  ])
    expect(updated[key]).toEqual(
      original.DistributionConfig[key as keyof typeof original.DistributionConfig],
    );
  expect(updated.DefaultCacheBehavior.CachePolicyId).toBe(
    original.DistributionConfig.DefaultCacheBehavior.CachePolicyId,
  );
  expect(updated.Origins.Items[0]).toMatchObject({
    Id: 'owner-origin-identifier',
    DomainName: 'app.visualnerve.com.s3.us-east-1.amazonaws.com',
    S3OriginConfig: { OriginAccessIdentity: '' },
    OriginAccessControlId: input.originAccessControlId,
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
  });
  expect(updated.Origins.Items[0]).not.toHaveProperty('CustomOriginConfig');
  expect(updated.DefaultRootObject).toBe('index.html');
  expect(updated.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
  expect(updated.DefaultCacheBehavior.AllowedMethods.Items).toEqual(['GET', 'HEAD']);
  expect(updated.DefaultCacheBehavior.ResponseHeadersPolicyId).toBe(input.responseHeadersPolicyId);
  expect(updated.ViewerCertificate.MinimumProtocolVersion).toBe('TLSv1.2_2021');
  expect(updated.ViewerCertificate.ACMCertificateArn).toBe(
    before.DistributionConfig.ViewerCertificate.ACMCertificateArn,
  );
});

it('scopes private bucket reads to the exact distribution ARN/account and emits real OAC/header API input quantities', () => {
  const plan = prepareExistingAppResources(snapshot(), { ...input, bridgePorts: [9443] });
  const grant = plan.bucketPolicy.Statement[0];
  expect(grant).toEqual({
    Sid: 'AllowExactAppDistributionReadOnly',
    Effect: 'Allow',
    Principal: { Service: 'cloudfront.amazonaws.com' },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::app.visualnerve.com/*',
    Condition: {
      StringEquals: {
        'AWS:SourceArn': 'arn:aws:cloudfront::123456789012:distribution/E10TKGRYWGM422',
      },
    },
  });
  expect(plan.bucketPolicy.Statement[1]).toMatchObject({
    Effect: 'Deny',
    Condition: { Bool: { 'aws:SecureTransport': 'false' } },
  });
  expect(plan.publicAccessBlock.PublicAccessBlockConfiguration).toEqual({
    BlockPublicAcls: true,
    IgnorePublicAcls: true,
    BlockPublicPolicy: true,
    RestrictPublicBuckets: true,
  });
  expect(plan.ownershipControls.OwnershipControls.Rules).toEqual([
    { ObjectOwnership: 'BucketOwnerEnforced' },
  ]);
  expect(plan.createOriginAccessControl.OriginAccessControlConfig).toMatchObject({
    OriginAccessControlOriginType: 's3',
    SigningBehavior: 'always',
    SigningProtocol: 'sigv4',
  });
  const headers = plan.createResponseHeadersPolicy.ResponseHeadersPolicyConfig;
  expect(headers.CustomHeadersConfig.Quantity).toBe(headers.CustomHeadersConfig.Items.length);
  expect(headers.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy).toContain(
    'wss://127.0.0.1:9443/bridge',
  );
  expect(headers.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy).not.toContain(
    '4317/bridge',
  );
  expect(headers.SecurityHeadersConfig.StrictTransportSecurity.Preload).toBe(false);
  expect(plan.target.bridgePorts).toEqual([9443]);
  expect(plan.deleteBucketWebsite).toEqual({ Bucket: 'app.visualnerve.com' });
  expect(plan).not.toHaveProperty('bucketEncryption');
});

it('routes only real app/docs directory objects and preserves unknown Help paths as HTTP404 rather than global SPA200', () => {
  const before = snapshot();
  before.DistributionConfig.CustomErrorResponses = {
    Quantity: 2,
    Items: [
      {
        ErrorCode: 404,
        ResponseCode: '404',
        ResponsePagePath: '/old-error.html',
        ErrorCachingMinTTL: 60,
      },
      { ErrorCode: 500, ErrorCachingMinTTL: 1 },
    ],
  };
  const plan = prepareExistingAppResources(before, input);
  const context: { handler?: (event: unknown) => any } = {};
  expect(Buffer.from(plan.viewerRequestFunction.FunctionCode, 'base64').toString()).toBe(
    plan.viewerRequestFunctionSource,
  );
  runInNewContext(plan.viewerRequestFunctionSource, context);
  for (const [uri, expected] of [
    ['/', '/index.html'],
    ['/help/', '/help/index.html'],
    ['/help/editing/', '/help/editing/index.html'],
    ['/help/missing', '/help/missing/index.html'],
    ['/editor/app.js', '/editor/app.js'],
    ['/licenses/package-LICENSE', '/licenses/package-LICENSE'],
  ]) {
    const routed = context.handler!({
      request: { method: 'GET', uri, headers: { host: { value: 'app.visualnerve.com' } } },
    });
    expect(routed.uri).toBe(expected);
    expect(routed.statusCode).toBeUndefined();
  }
  for (const uri of ['/app', '/app/', '/app/index.html', '/app/nested']) {
    const retired = context.handler!({
      request: { method: 'GET', uri, headers: { host: { value: 'app.visualnerve.com' } } },
    });
    expect(retired.statusCode).toBe(404);
    expect(retired.headers['cache-control'].value).toBe('no-store');
    expect(retired.headers.location).toBeUndefined();
  }
  const errors = plan.updateDistribution.DistributionConfig.CustomErrorResponses;
  expect(errors.Quantity).toBe(errors.Items.length);
  expect(errors.Items).toContainEqual({ ErrorCode: 500, ErrorCachingMinTTL: 1 });
  for (const code of [403, 404])
    expect(errors.Items).toContainEqual({
      ErrorCode: code,
      ResponsePagePath: '/error.html',
      ResponseCode: '404',
      ErrorCachingMinTTL: 0,
    });
  expect(errors.Items.every((item: { ResponseCode?: string }) => item.ResponseCode !== '200')).toBe(
    true,
  );
  expect(
    context.handler!({
      request: { method: 'POST', uri: '/', headers: { host: { value: 'app.visualnerve.com' } } },
    }).statusCode,
  ).toBe(405);
});

it('rejects mismatched targets/accounts, missing prospective controls, unsanitized origin headers and unsupported resource graphs', () => {
  for (const change of [
    { bucketName: 'www.visualnerve.com' },
    { domainName: 'www.visualnerve.com' },
    { distributionId: 'EOTHER1234567' },
    { region: 'eu-west-1' },
    { accountId: '000000000000' },
    { originAccessControlId: '' },
    { responseHeadersPolicyId: '' },
    { viewerRequestFunctionArn: 'arn:aws:cloudfront::123456789012:function/shared-www-function' },
    { bridgePorts: [0] },
  ])
    expect(() => existingAppTarget({ ...input, ...change })).toThrow();
  const changes = [
    (value: ReturnType<typeof snapshot>) => {
      value.ETag = '';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.DistributionConfig.Aliases.Items = ['www.visualnerve.com'];
    },
    (value: ReturnType<typeof snapshot>) => {
      value.DistributionConfig.Origins.Items[0].DomainName = 'api.example.com';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.DistributionConfig.OriginGroups.Quantity = 1;
    },
    (value: ReturnType<typeof snapshot>) => {
      value.DistributionConfig.CacheBehaviors.Quantity = 1;
    },
    (value: ReturnType<typeof snapshot>) => {
      Object.assign(value.DistributionConfig.Origins.Items[0].CustomHeaders, {
        Quantity: 1,
        Items: [{ HeaderName: 'Authorization', HeaderValue: 'not-for-output' }],
      });
    },
    (value: ReturnType<typeof snapshot>) => {
      Object.assign(value.DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations, {
        Quantity: 1,
        Items: [{ EventType: 'viewer-request' }],
      });
    },
    (value: ReturnType<typeof snapshot>) => {
      value.DistributionConfig.ViewerCertificate.ACMCertificateArn =
        'arn:aws:acm:us-east-1:999999999999:certificate/aaaa';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.DistributionConfig.CustomErrorResponses = {
        Quantity: 1,
        Items: [{ ErrorCode: 404, ResponseCode: '200', ResponsePagePath: '/index.html' }],
      };
    },
  ];
  for (const change of changes) {
    const value = snapshot();
    change(value);
    expect(() => prepareExistingAppResources(value, input)).toThrow('App resource review');
  }
});

it('supports an idempotent regenerated plan while preserving an unrelated viewer-response association', () => {
  const before = snapshot();
  before.DistributionConfig.ViewerCertificate.MinimumProtocolVersion = 'TLSv1.3_2025';
  Object.assign(before.DistributionConfig.DefaultCacheBehavior.FunctionAssociations, {
    Quantity: 1,
    Items: [
      {
        EventType: 'viewer-response',
        FunctionARN: 'arn:aws:cloudfront::123456789012:function/owner-response-function',
      },
    ],
  });
  const first = prepareExistingAppResources(before, input);
  const second = prepareExistingAppResources(
    { ETag: 'ENEWREVIEWTAG', DistributionConfig: first.updateDistribution.DistributionConfig },
    input,
  );
  expect(second.updateDistribution.DistributionConfig).toEqual(
    first.updateDistribution.DistributionConfig,
  );
  expect(second.updateDistribution.IfMatch).toBe('ENEWREVIEWTAG');
  expect(
    second.updateDistribution.DistributionConfig.ViewerCertificate.MinimumProtocolVersion,
  ).toBe('TLSv1.3_2025');
  expect(
    second.updateDistribution.DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Quantity,
  ).toBe(2);
  expect(
    second.updateDistribution.DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items[0]
      .EventType,
  ).toBe('viewer-response');
  expect(EXISTING_APP_TARGET.bucketName).toBe('app.visualnerve.com');
});
