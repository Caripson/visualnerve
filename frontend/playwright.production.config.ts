import { defineConfig } from '@playwright/test';

// Deliberate post-deployment checks only. Never reuse the normal synthetic TLS
// fixture's certificate bypass, host remap or automatic local webServer.
if (process.env.DEBUG || process.env.PWDEBUG)
  throw new Error(
    'Disable DEBUG/PWDEBUG for production smoke: credential actions must not be logged.',
  );

export default defineConfig({
  testDir: './tests/production',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 30000 },
  reporter: [['list', { printSteps: false, printFailuresInline: false }]],
  outputDir: '../tmp/verification/production-smoke',
  preserveOutput: 'never',
  use: {
    baseURL: 'https://app.visualnerve.com',
    viewport: { width: 1440, height: 980 },
    locale: 'en-US',
    actionTimeout: 30000,
    headless: process.env.VN_PRODUCTION_HEADED !== '1',
    ignoreHTTPSErrors: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  },
});
