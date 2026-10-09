import { defineConfig } from '@playwright/test'


const backendPort = process.env.NEWS_E2E_BACKEND_PORT ?? '8000'
const frontendPort = process.env.NEWS_E2E_FRONTEND_PORT ?? '5173'
const backendURL = `http://127.0.0.1:${backendPort}`
const frontendURL = `http://127.0.0.1:${frontendPort}`
const backendPython = process.platform === 'win32'
  ? '..\\backend\\.venv\\Scripts\\python.exe'
  : '../backend/.venv/bin/python'


export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: frontendURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } }
      : { channel: 'chrome' }),
  },
  webServer: [
    {
      command: `${backendPython} ../backend/tests/e2e_server.py`,
      url: `${backendURL}/api/categories`,
      env: {
        FRONTEND_ORIGIN: frontendURL,
        NEWS_E2E_BACKEND_PORT: backendPort,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: frontendURL,
      env: {
        VITE_API_BASE: backendURL,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
