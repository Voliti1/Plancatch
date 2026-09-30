import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
export default defineConfig({
  ...config,
  testDir: "./live-tests",
  outputDir: "./test-results/live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 15000 },
  // Never capture login credentials or real Bearer tokens in trace/HAR/video.
  use: {
    ...config.use,
    trace: "off",
    video: "off",
    screenshot: "off",
    actionTimeout: 15000,
    navigationTimeout: 15000,
  },
});
