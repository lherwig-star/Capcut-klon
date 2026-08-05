import { describe, expect, it } from "vitest";
import { clamp, formatTimecode } from "./time";

describe("clamp", () => {
  it("keeps a value inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("formatTimecode", () => {
  it("omits the hour segment below an hour", () => {
    expect(formatTimecode(0)).toBe("00:00:00");
    expect(formatTimecode(65.5, 30)).toBe("01:05:15");
  });

  it("includes hours once past one", () => {
    expect(formatTimecode(3661, 30)).toBe("01:01:01:00");
  });

  it("never renders a negative time", () => {
    expect(formatTimecode(-10)).toBe("00:00:00");
  });

  it("does not round a partial frame up into the next second", () => {
    // 1.999s at 25fps is still second 1, frame 24 - never "02:00".
    expect(formatTimecode(1.999, 25)).toBe("00:01:24");
  });
});
