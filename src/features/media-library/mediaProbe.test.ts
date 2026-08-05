import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

// The ffmpeg route is the real path in the packaged app; these tests cover the browser
// fallback, so it reports "unavailable" unless a test says otherwise.
const videoThumbnail = vi.fn<(path: string, at: number) => Promise<string | null>>();
vi.mock("../export/runExport", () => ({
  videoThumbnail: (path: string, at: number) => videoThumbnail(path, at),
}));

const { detectMediaKind, probeMediaFile } = await import("./mediaProbe");

/**
 * Stands in for jsdom's video element, which never loads anything and fires no events.
 * Each instance records how it was driven so a test can decide which event to fire.
 */
class FakeVideo {
  currentTime = 0;
  duration = NaN;
  videoWidth = 0;
  videoHeight = 0;
  readyState = 0;
  muted = false;
  preload = "";
  playsInline = false;
  src = "";
  error: MediaError | null = null;
  onloadedmetadata: (() => void) | null = null;
  onloadeddata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;

  removeAttribute() {}
  load() {}

  /** Reports metadata the way a real element does once the header has been parsed. */
  emitMetadata(duration: number, width = 320, height = 240) {
    this.duration = duration;
    this.videoWidth = width;
    this.videoHeight = height;
    this.readyState = 1;
    this.onloadedmetadata?.();
  }

  emitSeeked() {
    this.readyState = 2;
    this.onseeked?.();
  }

  emitError(code: number) {
    this.error = { code } as MediaError;
    this.onerror?.();
  }
}

let created: FakeVideo[] = [];

beforeEach(() => {
  created = [];
  videoThumbnail.mockReset().mockResolvedValue(null);
  vi.useFakeTimers();

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "video") {
      const el = new FakeVideo();
      created.push(el);
      return el as unknown as HTMLElement;
    }
    if (tag === "canvas") {
      const canvas = realCreate("canvas") as HTMLCanvasElement;
      vi.spyOn(canvas, "getContext").mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/jpeg;base64,AAA");
      return canvas;
    }
    return realCreate(tag);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("detectMediaKind", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(detectMediaKind("C:\\a\\b.MP4")).toBe("video");
    expect(detectMediaKind("/x/y.wav")).toBe("audio");
    expect(detectMediaKind("/x/y.JPEG")).toBe("image");
  });

  it("returns null for anything else", () => {
    expect(detectMediaKind("/x/notes.txt")).toBeNull();
    expect(detectMediaKind("/x/noextension")).toBeNull();
  });
});

describe("probeMediaFile", () => {
  it("rejects an unsupported file by name", async () => {
    await expect(probeMediaFile("/x/notes.txt")).rejects.toThrow(/nicht unterstützt/);
  });

  it("returns metadata for a video once it reports and seeks", async () => {
    const pending = probeMediaFile("C:\\videos\\clip.mp4");
    await vi.advanceTimersByTimeAsync(0);

    created[0].emitMetadata(12.5);
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitSeeked();

    const asset = await pending;
    expect(asset).toMatchObject({ kind: "video", name: "clip.mp4", durationSec: 12.5, width: 320, height: 240 });
    expect(asset.thumbnailUrl).toMatch(/^data:image\/jpeg/);
  });

  it("still imports the video when the thumbnail seek never completes", async () => {
    // The original hang: a seek to the position the element already sits at fires no
    // 'seeked' event, and the import waited on it forever.
    const pending = probeMediaFile("/videos/clip.mp4");
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitMetadata(9);

    await vi.advanceTimersByTimeAsync(10_000);

    const asset = await pending;
    expect(asset.durationSec).toBe(9);
    // No 'seeked' ever fired, but a real file's first frame is on screen the moment
    // metadata resolves - a stalled seek should not throw that away.
    expect(asset.thumbnailUrl).toBeUndefined();
  });

  it("falls back to whatever frame is decoded when the seek never completes", async () => {
    // Quality-of-life fix: a slow first disk read through the asset protocol used to
    // leave real imported clips with the generic icon instead of an actual frame.
    const pending = probeMediaFile("/videos/clip.mp4");
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitMetadata(9);
    created[0].readyState = 2; // HAVE_CURRENT_DATA - a frame is already decoded

    await vi.advanceTimersByTimeAsync(10_000);

    const asset = await pending;
    expect(asset.thumbnailUrl).toMatch(/^data:image\/jpeg/);
  });

  it("uses ffmpeg's thumbnail, which is the only route that works in the packaged app", async () => {
    // In the packaged app the page is served from tauri.localhost and the file from
    // asset.localhost. Drawing that <video> onto a canvas taints it, so toDataURL throws
    // SecurityError and the browser route can never produce a thumbnail there, however
    // long it is given - which is why every clip showed the generic icon.
    videoThumbnail.mockResolvedValue("data:image/jpeg;base64,FFMPEG");
    const pending = probeMediaFile("C:\\videos\\clip.mp4");
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitMetadata(20);
    await vi.advanceTimersByTimeAsync(0);

    const asset = await pending;
    expect(asset.thumbnailUrl).toBe("data:image/jpeg;base64,FFMPEG");
    // Seeks a little way in rather than to frame zero, which is often black.
    expect(videoThumbnail).toHaveBeenCalledWith("C:\\videos\\clip.mp4", 0.5);
  });

  it("asks ffmpeg for frame zero when the duration is unknown", async () => {
    videoThumbnail.mockResolvedValue("data:image/jpeg;base64,FFMPEG");
    const pending = probeMediaFile("/videos/stream.mkv");
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitMetadata(Number.POSITIVE_INFINITY);
    await vi.advanceTimersByTimeAsync(0);

    await pending;
    expect(videoThumbnail).toHaveBeenCalledWith("/videos/stream.mkv", 0);
  });

  it("gives up rather than hanging when metadata never arrives", async () => {
    const pending = probeMediaFile("/videos/silent.mp4");
    const assertion = expect(pending).rejects.toThrow(/Zeitüberschreitung/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("reports an unsupported codec as such", async () => {
    const pending = probeMediaFile("/videos/broken.mp4");
    const caught: Promise<Error> = pending.then(
      () => new Error("probe unexpectedly succeeded"),
      (err: Error) => err,
    );
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitError(4); // MEDIA_ERR_SRC_NOT_SUPPORTED
    expect((await caught).message).toMatch(/Codec/);
  });

  it("does not depend on the global MediaError being present", async () => {
    // The message lookup runs inside onerror; a ReferenceError there would escape into
    // the media element's event dispatch and leave the import promise pending forever.
    const pending = probeMediaFile("/videos/broken.mp4");
    const caught: Promise<Error> = pending.then(
      () => new Error("probe unexpectedly succeeded"),
      (err: Error) => err,
    );
    await vi.advanceTimersByTimeAsync(0);

    const original = Reflect.get(globalThis, "MediaError");
    Reflect.deleteProperty(globalThis, "MediaError");
    try {
      created[0].emitError(3); // MEDIA_ERR_DECODE
      expect((await caught).message).toMatch(/beschädigt/);
    } finally {
      if (original) Object.defineProperty(globalThis, "MediaError", { value: original, configurable: true });
    }
  });

  it("treats an endless duration as unknown instead of propagating Infinity", async () => {
    const pending = probeMediaFile("/videos/stream.mkv");
    await vi.advanceTimersByTimeAsync(0);
    created[0].emitMetadata(Number.POSITIVE_INFINITY);
    await vi.advanceTimersByTimeAsync(10_000);

    const asset = await pending;
    expect(asset.durationSec).toBe(0);
  });
});
