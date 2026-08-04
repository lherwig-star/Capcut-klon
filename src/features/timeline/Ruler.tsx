import "./Ruler.css";

const TICK_STEPS_SEC = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];

function pickTickStep(pxPerSec: number): number {
  const minPxBetweenTicks = 70;
  for (const step of TICK_STEPS_SEC) {
    if (step * pxPerSec >= minPxBetweenTicks) return step;
  }
  return TICK_STEPS_SEC[TICK_STEPS_SEC.length - 1];
}

function formatTickLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

interface RulerProps {
  widthPx: number;
  pxPerSec: number;
  durationSec: number;
}

export function Ruler({ widthPx, pxPerSec, durationSec }: RulerProps) {
  const step = pickTickStep(pxPerSec);
  const tickCount = Math.ceil(Math.max(durationSec, widthPx / pxPerSec) / step) + 2;
  const ticks = Array.from({ length: tickCount }, (_, i) => i * step);

  return (
    <div className="timeline-ruler" style={{ width: widthPx }}>
      {ticks.map((t) => (
        <div key={t} className="timeline-ruler__tick" style={{ left: t * pxPerSec }}>
          <span className="timeline-ruler__label">{formatTickLabel(t)}</span>
        </div>
      ))}
    </div>
  );
}
