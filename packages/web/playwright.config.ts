// E2E（MSW のモックで動かす: 実装計画 §7）。CI では `pnpm --filter @factory/web e2e`
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5199', locale: 'ja-JP', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /mobile\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // スマホ（06_ui_spec.md §6）。CI に入れるブラウザは Chromium だけなので、iPhone の寸法も Chromium で動かす
    { name: 'iphone', testMatch: /mobile\.spec/, use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', testMatch: /mobile\.spec/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'VITE_API_MOCK=true npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
