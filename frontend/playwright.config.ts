import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], timezoneId: "America/Los_Angeles" },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run test:serve",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3100/test-api",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
