export const APP_ORIGIN: string;
export const WEBSITE_ORIGIN: string;
export interface AppSurfaceOptions {
  appOrigin?: string;
  websiteOrigin?: string;
  bridgePorts?: number[];
}
export function appSurfaceOptions(
  options?: AppSurfaceOptions,
): Required<AppSurfaceOptions>;
export function appContentSecurityPolicy(bridgePorts?: number[]): string;
export function appResponseHeaders(
  bridgePorts?: number[],
): Record<string, string>;
