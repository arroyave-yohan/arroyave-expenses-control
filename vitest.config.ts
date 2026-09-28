import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // En CI se usa una copia sin el binding AI (scripts/ci-wrangler-config.mjs); en local, la config real.
      wrangler: { configPath: process.env.WRANGLER_TEST_CONFIG ?? './wrangler.jsonc' },
      miniflare: { bindings: { ACCESS_TEAM: 'test-team', ACCESS_AUD: 'test-aud', ACCESS_BYPASS: '', VAPID_PUBLIC_KEY: 'test-public-key-0123456789', VAPID_PRIVATE_KEY: 'test-private-key-0123456789', VAPID_SUBJECT: 'https://test.local' } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
