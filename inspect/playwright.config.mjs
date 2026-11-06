// Visual regression and accessibility (spec 8). Run: npm run test:visual
// (needs `npx playwright install chromium` once). Update baselines only after a
// reviewed visual change: npx playwright test -c playwright.config.mjs --update-snapshots
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/visual',
  testMatch: '*.spec.mjs',
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}-{platform}{ext}',
  fullyParallel: true,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: { browserName: 'chromium', bypassCSP: true, deviceScaleFactor: 1 },
});
