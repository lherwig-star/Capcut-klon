import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-Ebene der Tests. jsdom berechnet kein Layout, weshalb ihm eine ganze
 * Fehlerklasse entgeht: Die Timeline ist breiter als jedes Fenster, und ohne
 * `min-width: 0` auf den Grid-Kindern weitete sie das gesamte Layout auf, statt in
 * sich zu scrollen - die Vorschau wurde dabei aus dem Bild geschoben. 99 grüne
 * Unit-Tests haben davon nichts gesehen.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Erlaubt einen bereits vorhandenen Chromium statt eines Downloads; ohne die
        // Variable nimmt Playwright wie gewohnt seinen eigenen.
        launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    command: "npx vite --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
