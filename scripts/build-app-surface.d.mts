import type { AppSurfaceOptions } from "../deployment/app-policy.mjs";
export function auditAppSurface(
  directory: string,
  options?: { allowLegacyAlias?: boolean },
): string[];
export function buildAppSurface(
  sourceDirectory: string,
  destinationDirectory: string,
  options?: AppSurfaceOptions,
): Promise<{
  directory: string;
  files: string[];
  appOrigin: string;
  websiteOrigin: string;
  bridgePorts: number[];
  collaborationRelayOrigin?: string;
}>;
