import { defineConfig } from '@playwright/test'


const backendPort = process.env.NEWS_E2E_BACKEND_PORT ?? '8000'
const frontendPort = process.env.NEWS_E2E_FRONTEND_PORT ?? '5173'
const backendURL = `http://127.0.0.1:${backendPort}`
const frontendURL = `http://127.0.0.1:${frontendPort}`


export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: frontendURL,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH
        ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
  webServer: [
    {
      command: '../backend/.venv/bin/python ../backend/tests/e2e_server.py',
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
