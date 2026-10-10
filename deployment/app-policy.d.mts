export const APP_ORIGIN: string;
export const WEBSITE_ORIGIN: string;
export interface AppSurfaceOptions {
  appOrigin?: string;
  websiteOrigin?: string;
  bridgePorts?: number[];
  collaborationRelayOrigin?: string;
}
export function appSurfaceOptions(
  options?: AppSurfaceOptions,
): Required<Omit<AppSurfaceOptions, "collaborationRelayOrigin">> & {
  collaborationRelayOrigin?: string;
};
export function appContentSecurityPolicy(
  bridgePorts?: number[],
  collaborationRelayOrigin?: string,
): string;
export function appResponseHeaders(
  bridgePorts?: number[],
  collaborationRelayOrigin?: string,
): Record<string, string>;
