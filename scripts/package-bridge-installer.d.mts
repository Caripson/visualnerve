export interface BridgeReleaseArtifact {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}
export interface BridgeInstallerRelease {
  format: "visual-nerve-bridge-release";
  schemaVersion: 1;
  bridgeVersion: string;
  revision: string;
  sourceDirty: boolean;
  goVersion: string;
  goMinimumVersion: string;
  source: BridgeReleaseArtifact;
  installer: BridgeReleaseArtifact;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}
export const INSTALLER_GO_VERSION: string;
export function packageBridgeInstaller(options?: {
  root?: string;
  outputDirectory?: string;
  siteUrl?: string;
  revision?: string;
  sourceDirty?: boolean;
}): BridgeInstallerRelease;
