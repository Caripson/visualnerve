import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ENABLED: "true",
          ALLOWED_ORIGINS: "https://app.visualnerve.com,http://localhost:5173",
        },
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 15000 },
});
