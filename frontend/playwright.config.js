import { defineConfig } from '@playwright/test'


export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH
        ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
  webServer: [
    {
      command: '../backend/.venv/bin/python ../backend/tests/e2e_server.py',
      url: 'http://127.0.0.1:8000/api/categories',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
