import { defineConfig, devices } from '@playwright/test';

// One console per migration state: day zero, mid-run, and finished.
const server = (name, port) => ({
  command: 'node console/server.mjs',
  env: { PORT: String(port), CONSOLE_DATA: `tests/ui/fixtures/${name}` },
  url: `http://localhost:${port}/api/state`,
  reuseExistingServer: !process.env.CI,
});

export default defineConfig({
  testDir: 'tests/ui',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [server('run', 4173), server('done', 4174), server('empty', 4175)],
});
