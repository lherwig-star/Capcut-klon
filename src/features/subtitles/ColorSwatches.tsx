import { ACCENT_COLOR_PALETTE } from "./types";

interface ColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
  compact?: boolean;
  title?: string;
}

export function ColorSwatches({ value, onChange, compact, title }: ColorSwatchesProps) {
  return (
    <div className={`color-swatches${compact ? " color-swatches--compact" : ""}`} title={title}>
      {ACCENT_COLOR_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch${value.toLowerCase() === color.toLowerCase() ? " is-selected" : ""}`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
          aria-label={color}
          title={color}
        />
      ))}
    </div>
  );
}
