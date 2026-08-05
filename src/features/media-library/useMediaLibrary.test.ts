import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../shared/types";

const open = vi.fn();
const probeMediaFile = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => open(...args) }));
vi.mock("./mediaProbe", () => ({ probeMediaFile: (path: string) => probeMediaFile(path) }));

const { useMediaLibrary } = await import("./useMediaLibrary");

function asset(id: string, name: string): MediaAsset {
  return { id, kind: "video", name, path: `/tmp/${name}`, url: `asset:///tmp/${name}`, durationSec: 5 };
}

beforeEach(() => {
  open.mockReset();
  probeMediaFile.mockReset();
});

describe("useMediaLibrary", () => {
  it("adds every successfully probed file", async () => {
    open.mockResolvedValue(["/tmp/a.mp4", "/tmp/b.mp4"]);
    probeMediaFile.mockImplementation(async (path: string) =>
      asset(path, path.split("/").pop() as string),
    );

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    expect(result.current.assets.map((a) => a.name)).toEqual(["a.mp4", "b.mp4"]);
    expect(result.current.errors).toEqual([]);
  });

  it("keeps the good files and reports the bad one by name", async () => {
    open.mockResolvedValue(["/tmp/good.mp4", "/tmp/bad.mp4"]);
    probeMediaFile.mockImplementation(async (path: string) => {
      if (path.includes("bad")) throw new Error("bad.mp4: Codec wird nicht unterstützt.");
      return asset(path, "good.mp4");
    });

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    expect(result.current.assets).toHaveLength(1);
    expect(result.current.errors).toEqual(["bad.mp4: Codec wird nicht unterstützt."]);
  });

  it("releases the importing flag even when every file fails", async () => {
    // The symptom that started all this: the Import button stayed greyed out forever.
    open.mockResolvedValue(["/tmp/bad.mp4"]);
    probeMediaFile.mockRejectedValue(new Error("kaputt"));

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    await waitFor(() => expect(result.current.importing).toBe(false));
    expect(result.current.progress).toBeNull();
  });

  it("does nothing when the dialog is dismissed", async () => {
    open.mockResolvedValue(null);

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    expect(result.current.assets).toEqual([]);
    expect(result.current.importing).toBe(false);
    expect(probeMediaFile).not.toHaveBeenCalled();
  });

  it("accepts a single path as well as a list", async () => {
    open.mockResolvedValue("/tmp/only.mp4");
    probeMediaFile.mockResolvedValue(asset("1", "only.mp4"));

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    expect(result.current.assets).toHaveLength(1);
  });

  it("surfaces a failing file dialog instead of swallowing it", async () => {
    open.mockRejectedValue(new Error("Dialog kaputt"));

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    expect(result.current.errors[0]).toMatch(/Dialog kaputt/);
    expect(result.current.importing).toBe(false);
  });

  it("removes an asset and clears dismissed errors", async () => {
    open.mockResolvedValue(["/tmp/a.mp4"]);
    probeMediaFile.mockResolvedValue(asset("keep", "a.mp4"));

    const { result } = renderHook(() => useMediaLibrary());
    await act(() => result.current.importFiles());

    act(() => result.current.removeAsset("keep"));
    expect(result.current.assets).toEqual([]);

    act(() => result.current.dismissErrors());
    expect(result.current.errors).toEqual([]);
  });
});
