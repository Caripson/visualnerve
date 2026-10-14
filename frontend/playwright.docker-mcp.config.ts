import { defineConfig } from '@playwright/test';
import { mcpDockerTarget, mcpDockerBrowserOptions } from '../scripts/mcp-docker/config.mjs';

const target = mcpDockerTarget();

export default defineConfig({
  testDir: './tests/docker-mcp',
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../tmp/verification/docker-mcp-results',
  use: {
    baseURL: target.appUrl,
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    screenshot: 'off',
    // Test traces could contain the disposable recovery key. Keep screenshots
    // explicit, after onboarding; never record a real browser profile.
    trace: 'off',
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
