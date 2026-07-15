import { defineConfig } from '@playwright/test';

// Ports dedicated to the E2E harness so they don't collide with Tauri's
// fixed dev port (1420, see vite.config.ts) or a developer's own `npm run
// dev`. See e2e/scripts/start-headless-server.mjs for the fixture repo +
// server bring-up.
const SERVER_PORT = 4899;
const VITE_PORT = 5183;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The whole suite runs against ONE shared fixture repo (see
  // e2e/fixtures/build-fixture.mjs), mutated in a deliberate progression
  // across the numbered spec files (pull, then stage/commit, then push) —
  // workers:1 keeps that strictly sequential, not just per-file.
  workers: 1,
  webServer: [
    {
      command: 'node e2e/scripts/start-headless-server.mjs',
      url: `http://localhost:${SERVER_PORT}/api/repo`,
      env: { E2E_SERVER_PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${VITE_PORT} --strictPort`,
      url: `http://localhost:${VITE_PORT}`,
      env: { VITE_API_BASE: `http://localhost:${SERVER_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  use: {
    baseURL: `http://localhost:${VITE_PORT}`,
  },
});
