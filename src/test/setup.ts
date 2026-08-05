import { webcrypto } from "node:crypto";
import { vi } from "vitest";

// jsdom's crypto has no randomUUID, which shared/id.ts relies on for every clip and track.
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// jsdom implements no media playback at all and throws "Not implemented" for these.
// Defined on the prototype rather than per test, so React's unmount cleanup - which runs
// after a test's own restoreAllMocks - still finds them.
Object.defineProperties(HTMLMediaElement.prototype, {
  play: {
    configurable: true,
    value(this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { value: false, configurable: true });
      return Promise.resolve();
    },
  },
  pause: {
    configurable: true,
    value(this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { value: true, configurable: true });
    },
  },
  load: { configurable: true, value: () => undefined },
});

vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
  () => ({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" }) as unknown as CanvasRenderingContext2D,
);

// jsdom ships no PointerEvent, so Testing Library falls back to a bare Event and every
// clientX silently arrives as undefined - which turns drag maths into NaN rather than a
// failed assertion. MouseEvent already carries the coordinates; only the pointer fields
// need adding.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  Object.defineProperty(globalThis, "PointerEvent", {
    value: PointerEventPolyfill,
    configurable: true,
  });
}

// Same story for DragEvent, which the media-library drop path needs for its clientX.
if (typeof globalThis.DragEvent === "undefined") {
  class DragEventPolyfill extends MouseEvent {
    readonly dataTransfer: DataTransfer | null;

    constructor(type: string, params: DragEventInit = {}) {
      super(type, params);
      this.dataTransfer = params.dataTransfer ?? null;
    }
  }
  Object.defineProperty(globalThis, "DragEvent", { value: DragEventPolyfill, configurable: true });
}

// Nor does it implement pointer capture, which every drag in the timeline relies on.
Object.defineProperties(Element.prototype, {
  setPointerCapture: { configurable: true, value: () => undefined },
  releasePointerCapture: { configurable: true, value: () => undefined },
  hasPointerCapture: { configurable: true, value: () => false },
});
