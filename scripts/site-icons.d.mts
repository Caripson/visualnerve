export const SITE_ICON_FILES: readonly string[];
export const SITE_ICON_PATHS: readonly string[];
export function siteIconLinks(): string;
export function buildIconContainer(frames: readonly Buffer[]): Buffer;
export function validateSiteIcons(directory: string): {
  source: string;
  frames: number[];
  pngSize: number;
  appleSize: number;
};
export function generateSiteIcons(
  directory: string,
  executablePath?: string,
): Promise<ReturnType<typeof validateSiteIcons>>;
