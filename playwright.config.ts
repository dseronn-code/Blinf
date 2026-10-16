import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E (Playwright) contra o servidor do GestãoPro com o banco populado pelo seed.
 * Por padrão usa um servidor já no ar (E2E_BASE_URL, padrão http://localhost:3000).
 * Com E2E_START_SERVER=1 o Playwright sobe `npm run start` (exige `npm run build` antes).
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_START_SERVER === '1'
    ? { command: 'npm run start', url: `${baseURL}/login`, reuseExistingServer: true, timeout: 180_000 }
    : undefined,
});
