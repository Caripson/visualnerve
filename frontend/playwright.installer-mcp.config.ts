import { defineConfig } from '@playwright/test';
import { mcpDockerBrowserOptions, mcpDockerTarget } from '../scripts/mcp-docker/config.mjs';

const target = mcpDockerTarget();
export default defineConfig({
  testDir: './tests/installer-mcp',
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../tmp/verification/installer-mcp-results',
  use: {
    baseURL: target.appUrl,
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'off',
    screenshot: 'off',
    ...mcpDockerBrowserOptions(target, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH),
  },
  webServer: target.hosted
    ? undefined
    : {
        command: '../scripts/mcp-docker/app-server.sh',
        url: 'https://127.0.0.1:4342/',
        ignoreHTTPSErrors: true,
        reuseExistingServer: false,
        timeout: 30000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
      },
});
