import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 20000,
    baseURL: 'http://127.0.0.1:4327',
    viewport: { width: 1440, height: 980 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      // Self-signed certificates and synthetic DNS are confined to isolated tests.
      args: [
        '--no-sandbox',
        '--ignore-certificate-errors',
        '--host-resolver-rules=MAP public-app.test 127.0.0.1',
        '--no-proxy-server',
      ],
    },
  },
  webServer: {
    command: '../scripts/e2e-server.sh',
    url: 'http://127.0.0.1:4327/api/v1/health',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    timeout: 30000,
  },
});
