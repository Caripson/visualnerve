export interface ExistingAppInput {
  domainName?: string;
  bucketName?: string;
  distributionId?: string;
  region?: string;
  accountId: string;
  originAccessControlId: string;
  responseHeadersPolicyId: string;
  viewerRequestFunctionArn: string;
  bridgePorts?: number[];
}
export const EXISTING_APP_TARGET: Readonly<{
  domainName: string;
  bucketName: string;
  distributionId: string;
  region: string;
}>;
export function existingAppTarget(input: ExistingAppInput): ExistingAppInput & {
  domainName: string;
  bucketName: string;
  distributionId: string;
  region: string;
  headers: Record<string, string>;
};
export function prepareExistingAppResources(
  snapshot: {
    ETag: string;
    DistributionConfig: Record<string, any>;
    Id?: string;
  },
  input: ExistingAppInput,
): {
  format: string;
  schemaVersion: number;
  requiresManualApproval: boolean;
  target: ExistingAppInput;
  updateDistribution: {
    Id: string;
    IfMatch: string;
    DistributionConfig: Record<string, any>;
  };
  createOriginAccessControl: Record<string, any>;
  createResponseHeadersPolicy: Record<string, any>;
  bucketPolicy: Record<string, any>;
  publicAccessBlock: Record<string, any>;
  ownershipControls: Record<string, any>;
  deleteBucketWebsite: { Bucket: string };
  viewerRequestFunction: {
    Name: string;
    FunctionConfig: Record<string, any>;
    FunctionCode: string;
  };
  viewerRequestFunctionSource: string;
};
