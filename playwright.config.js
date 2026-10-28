import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 45000, workers: 1,
  use: {baseURL:process.env.BERKASIA_BASE_URL || 'http://127.0.0.1:4175', headless:true, launchOptions: process.env.BERKASIA_CHROME ? {executablePath: process.env.BERKASIA_CHROME} : {}},
  webServer: process.env.BERKASIA_BASE_URL ? undefined : {command:'npm run dev -- --port 4175 --strictPort', url:'http://127.0.0.1:4175', reuseExistingServer:!process.env.CI, timeout:30000}
});
