export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Formats seconds as `HH:MM:SS:FF` (frames), omitting the hours segment when zero. */
export function formatTimecode(totalSeconds: number, fps = 30): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const frames = Math.floor((safe - Math.floor(safe)) * fps);
  const pad = (value: number) => value.toString().padStart(2, "0");

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
    : `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}
