import { expect, test, type Page } from "@playwright/test";

/**
 * Stands in for Tauri's IPC bridge. The dialog plugin and convertFileSrc both go through
 * __TAURI_INTERNALS__, so stubbing it drives the real app in a plain browser, with the
 * fixture served by Vite.
 */
const TAURI_STUB = `
window.__TAURI_INTERNALS__ = {
  convertFileSrc: () => "/@fs__fixture__",
  transformCallback: (cb) => { const id = Math.random(); window[id] = cb; return id; },
  invoke: async (cmd) => {
    if (cmd === "plugin:dialog|open") return ["C:\\\\videos\\\\clip.webm"];
    if (cmd === "plugin:dialog|save") return "C:\\\\videos\\\\out.mp4";
    if (cmd === "check_ffmpeg_available") return true;
    if (cmd === "probe_audio_streams") return [true];
    if (cmd === "plugin:event|listen") return 0;
    return null;
  },
};
`;

async function openEditor(page: Page) {
  // Route the stubbed asset URL at the fixture the repo ships.
  await page.route("**/@fs__fixture__", (route) =>
    route.fulfill({ path: new URL("./fixtures/clip.webm", import.meta.url).pathname }),
  );
  await page.addInitScript(TAURI_STUB);
  await page.goto("/");
}

async function importClip(page: Page) {
  await page.getByRole("button", { name: /Importieren/ }).click();
  await expect(page.locator(".media-card")).toBeVisible();
  await page.locator(".media-card").dblclick();
  await expect(page.locator(".clip-block")).toBeVisible();
}

/** Nothing may push the layout wider than the window - see playwright.config.ts. */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "the page scrolls sideways").toBeLessThanOrEqual(innerWidth);
}

async function expectInsideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} has no box`).not.toBeNull();
  const width = await page.evaluate(() => window.innerWidth);
  expect(box!.x, `${selector} starts off-screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${selector} ends off-screen`).toBeLessThanOrEqual(width + 1);
}

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test("keeps the preview on screen once a clip is on the timeline", async ({ page }) => {
  await importClip(page);

  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, ".preview-panel__stage canvas");
  await expect(page.locator(".preview-panel__controls button")).toHaveCount(3);
  await expectInsideViewport(page, ".preview-panel__controls");
});

test("survives a timeline far wider than the window", async ({ page }) => {
  await importClip(page);

  // Maximum zoom stretches the timeline well past any real window, the same way a long
  // video does at the default zoom.
  await page.locator('.timeline__zoom input[type="range"]').fill("300");

  const contentWidth = await page
    .locator(".timeline__content")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(contentWidth).toBeGreaterThan(2000);

  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, ".preview-panel__stage canvas");
});

test("centres the preview in the space it has", async ({ page }) => {
  await importClip(page);

  const stage = (await page.locator(".preview-panel__stage").boundingBox())!;
  const canvas = (await page.locator(".preview-panel__stage canvas").boundingBox())!;

  expect(canvas.x + canvas.width / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
  // And it uses the room it has rather than sitting at its intrinsic 1280x720.
  expect(canvas.width).toBeGreaterThan(stage.width * 0.9);
});

test("keeps the export button and the zoom slider reachable", async ({ page }) => {
  await importClip(page);

  await expectInsideViewport(page, ".app__header");
  await expect(page.getByRole("button", { name: "Exportieren" })).toBeEnabled();
  await expectInsideViewport(page, ".timeline__zoom");
});

test("draws the clip rather than leaving the canvas blank", async ({ page }) => {
  await importClip(page);
  await page.waitForTimeout(1500);

  const hasColour = await page.locator(".preview-panel__stage canvas").evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) return true;
    }
    return false;
  });

  expect(hasColour, "the preview stayed black").toBe(true);
});

test("marks the timeline chrome as unselectable", async ({ page }) => {
  await importClip(page);

  // Asserted as a property rather than by dragging: Playwright's synthetic mouse input
  // does not start a native text selection, so a drag-based test passes even with the
  // guard removed and would prove nothing. What breaks in a real browser is the
  // selection gesture taking the pointer over, and this is the property that stops it.
  for (const selector of [".timeline__ruler-wrap", ".timeline-ruler__label", ".track-row__lane"]) {
    const userSelect = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).userSelect);
    expect(userSelect, `${selector} is selectable`).toBe("none");
  }
});

test("keeps following the pointer for the whole scrub", async ({ page }) => {
  await importClip(page);
  const ruler = (await page.locator(".timeline__ruler-wrap").boundingBox())!;
  const y = ruler.y + ruler.height / 2;
  const timecode = () => page.locator(".timeline__timecode").first().textContent();

  await page.mouse.move(ruler.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 150, y);
  const midway = await timecode();
  await page.mouse.move(ruler.x + 400, y);
  const atEnd = await timecode();
  await page.mouse.up();

  // A scrub that gets stuck reports the same time from the point it froze onwards.
  expect(atEnd).not.toBe(midway);
});

test("advances the playhead when play is pressed", async ({ page }) => {
  await importClip(page);

  await page.locator(".preview-panel__controls button").nth(1).click();
  await page.waitForTimeout(1200);

  const timecode = await page.locator(".preview-panel__timecode").textContent();
  expect(timecode).not.toMatch(/^00:00:00/);
});
