export interface McpDockerTarget {
  appUrl: string;
  origin: string;
  hosted: boolean;
  expectedEntrySha256?: string;
  expectedRevision?: string;
}
export function mcpDockerTarget(
  environment?: Record<string, string | undefined>,
): McpDockerTarget;
export function mcpDockerBrowserOptions(
  target: McpDockerTarget,
  executablePath?: string,
): {
  ignoreHTTPSErrors: boolean;
  launchOptions: {
    executablePath?: string;
    channel?: string;
    args: string[];
  };
};
