export const APP_ACCOUNT: string;
export const APP_FUNCTION: string;
export function appHostingReferences(snapshot: Record<string, any>): {
  originAccessControlId: string;
  responseHeadersPolicyId: string;
};
export function verifyAppHosting(
  input: Record<string, any>,
  manifest: Record<string, any>,
): {
  originAccessControlId: string;
  responseHeadersPolicyId: string;
  accountId: string;
  bucket: string;
  distributionId: string;
  bridgePorts: number[];
  collaborationRelayOrigin?: string;
};
