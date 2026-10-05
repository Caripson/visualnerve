import { readFileSync } from 'node:fs';
// JSON is accepted directly by CloudFormation. Nothing here provisions resources.
const ref = (name) => ({ Ref: name });
const attr = (name, key) => ({ 'Fn::GetAtt': [name, key] });
const sub = (value) => ({ 'Fn::Sub': value });
const choose = (name, yes, no) => ({ 'Fn::If': [name, yes, no] });
const functionCode = readFileSync(new URL('./viewer-request.js', import.meta.url), 'utf8').replace('__CANONICAL_HOST__', '${CanonicalDomain}');
export const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Visual Nerve: public static application files, private browser data. No content API or server database.',
  Parameters: {
    CanonicalDomain: { Type: 'String', Default: '', AllowedPattern: '^$|^[a-z0-9][a-z0-9.-]+[a-z0-9]$', Description: 'Single canonical hostname; empty uses the CloudFront domain.' },
    AlternateDomain: { Type: 'String', Default: '', AllowedPattern: '^$|^[a-z0-9][a-z0-9.-]+[a-z0-9]$', Description: 'Optional alias (e.g. www); redirected to CanonicalDomain. Include it in the certificate.' },
    CertificateArn: { Type: 'String', Default: '', AllowedPattern: '^$|^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[a-f0-9-]{36}$', Description: 'ACM certificate in us-east-1 for all configured aliases, required for a custom domain.' },
  },
  Rules: {
    CustomDomainRequiresCertificate: { RuleCondition: { 'Fn::Not': [{ 'Fn::Equals': [ref('CanonicalDomain'), ''] }] }, Assertions: [{ Assert: { 'Fn::Not': [{ 'Fn::Equals': [ref('CertificateArn'), ''] }] }, AssertDescription: 'A custom domain needs a certificate ARN in us-east-1.' }] },
    AliasRequiresCanonicalDomain: { RuleCondition: { 'Fn::Not': [{ 'Fn::Equals': [ref('AlternateDomain'), ''] }] }, Assertions: [{ Assert: { 'Fn::Not': [{ 'Fn::Equals': [ref('CanonicalDomain'), ''] }] }, AssertDescription: 'Specify a canonical domain when using an alias.' }] },
  },
  Conditions: {
    CustomDomain: { 'Fn::Not': [{ 'Fn::Equals': [ref('CanonicalDomain'), ''] }] },
    Alias: { 'Fn::Not': [{ 'Fn::Equals': [ref('AlternateDomain'), ''] }] },
  },
  Resources: {
    AppBucket: {
      Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }, OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] }, BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } },
    },
    OriginAccess: { Type: 'AWS::CloudFront::OriginAccessControl', Properties: { OriginAccessControlConfig: { Name: sub('${AWS::StackName}-static-app'), OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' } } },
    ViewerRequest: { Type: 'AWS::CloudFront::Function', Properties: { Name: sub('${AWS::StackName}-canonical-site'), AutoPublish: true, FunctionConfig: { Comment: 'Canonical origin and static directory indexes; GET/HEAD only.', Runtime: 'cloudfront-js-2.0' }, FunctionCode: sub(functionCode) } },
    AppCache: { Type: 'AWS::CloudFront::CachePolicy', Properties: { CachePolicyConfig: { Name: sub('${AWS::StackName}-static-cache'), MinTTL: 0, DefaultTTL: 0, MaxTTL: 31536000, ParametersInCacheKeyAndForwardedToOrigin: { EnableAcceptEncodingGzip: true, EnableAcceptEncodingBrotli: true, CookiesConfig: { CookieBehavior: 'none' }, HeadersConfig: { HeaderBehavior: 'none' }, QueryStringsConfig: { QueryStringBehavior: 'none' } } } } },
    Distribution: { Type: 'AWS::CloudFront::Distribution', Properties: { DistributionConfig: {
      Enabled: true, HttpVersion: 'http2and3', IPV6Enabled: true, DefaultRootObject: 'index.html',
      // A private S3 origin can return 403 for a missing object. Preserve HTTP 404 in both cases.
      CustomErrorResponses: [403, 404].map(ErrorCode => ({ ErrorCode, ResponseCode: 404, ResponsePagePath: '/error.html', ErrorCachingMinTTL: 10 })),
      Aliases: choose('CustomDomain', choose('Alias', [ref('CanonicalDomain'), ref('AlternateDomain')], [ref('CanonicalDomain')]), ref('AWS::NoValue')),
      ViewerCertificate: choose('CustomDomain', { AcmCertificateArn: ref('CertificateArn'), SslSupportMethod: 'sni-only', MinimumProtocolVersion: 'TLSv1.2_2021' }, { CloudFrontDefaultCertificate: true }),
      Origins: [{ Id: 'StaticFiles', DomainName: attr('AppBucket', 'RegionalDomainName'), OriginAccessControlId: attr('OriginAccess', 'Id'), S3OriginConfig: { OriginAccessIdentity: '' } }],
      DefaultCacheBehavior: { TargetOriginId: 'StaticFiles', ViewerProtocolPolicy: 'redirect-to-https', AllowedMethods: ['GET', 'HEAD'], CachedMethods: ['GET', 'HEAD'], Compress: true, CachePolicyId: ref('AppCache'), FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: attr('ViewerRequest', 'FunctionARN') }] },
    } } },
    BucketPolicy: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref('AppBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject', Resource: sub('${AppBucket.Arn}/*'), Condition: { StringEquals: { 'AWS:SourceArn': sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}') } } },
      { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [attr('AppBucket', 'Arn'), sub('${AppBucket.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': false } } },
    ] } } },
  },
  Outputs: { BucketName: { Value: ref('AppBucket') }, DistributionId: { Value: ref('Distribution') }, CloudFrontDomain: { Value: attr('Distribution', 'DomainName') }, AppUrl: { Value: choose('CustomDomain', sub('https://${CanonicalDomain}'), sub('https://${Distribution.DomainName}')) } },
};
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.stdout.write(`${JSON.stringify(template, null, 2)}\n`);
