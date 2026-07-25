import { copyText } from "./shared";

const SWATCHES = [
  { label: "Paper", token: "var(--paper)", text: "var(--ink)", cls: "paper" },
  { label: "Ink", token: "var(--ink)", text: "var(--paper)", cls: "ink" },
  { label: "Accent", token: "var(--orange)", text: "var(--on-accent)", cls: "accent" },
  { label: "Blue", token: "var(--blue)", text: "var(--on-accent)", cls: "blue" },
];

export default function ColorsTool() {
  return (
    <div class="swatches">
      {SWATCHES.map((sw) => (
        <button
          type="button"
          class={`swatch swatch-${sw.cls}`}
          style={{ "--swatch": sw.token, "--swatch-text": sw.text } as Record<string, string>}
          onClick={() => copyText(sw.token)}
        >
          {sw.label}
          <small>{sw.token}</small>
        </button>
      ))}
    </div>
  );
}
