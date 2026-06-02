/**
 * WhyJ Quant — CLI welcome banner (compact)
 * Single-line logo + tagline + hint. Gold accent on dark terminals.
 */
type RGB = [number, number, number];

const GOLD: RGB = [0xfa, 0xcc, 0x15];
const CREAM: RGB = [0xff, 0xf3, 0xc4];
const RESET = "\x1b[0m";

const supportsColor =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY ?? false);

const fg = (r: number, g: number, b: number) =>
  supportsColor ? `\x1b[38;2;${r};${g};${b}m` : "";
const reset = () => (supportsColor ? RESET : "");
const dim = (s: string) => (supportsColor ? "\x1b[2m" + s + RESET : s);

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const mix = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

function gradient(line: string, from: RGB, to: RGB): string {
  if (!supportsColor) return line;
  const chars = [...line];
  const n = Math.max(chars.length - 1, 1);
  let out = "";
  chars.forEach((ch, i) => {
    if (ch === " ") return void (out += ch);
    const [r, g, b] = mix(from, to, i / n);
    out += fg(r, g, b) + ch;
  });
  return out + reset();
}

export interface BannerOptions {
  version?: string;
  marginTop?: number;
}

export function buildBanner(opts: BannerOptions = {}): string {
  const {
    version = "0.1.0",
    marginTop = 1,
  } = opts;

  const lead = "  ";
  const chartBot = "▁▃▅▇██";

  // Logo line: bar chart + WhyJ Quant
  const logo = lead +
    gradient(chartBot, GOLD, CREAM) + "  " +
    fg(...CREAM) + "WhyJ " + fg(...GOLD) + "Quant" + reset();

  const tagline =
    lead +
    dim("Quantitative intelligence, sharpened to a quill's point.") +
    dim("  ·  v" + version);

  const hint =
    lead +
    fg(...GOLD) + ">" + reset() +
    dim(" type ") + fg(...CREAM) + "/" + reset() +
    dim(" for commands, or just ask a question.");

  return [
    ...Array(Math.max(0, marginTop)).fill(""),
    logo,
    tagline,
    "",
    hint,
    "",
  ].join("\n");
}

export function printBanner(opts: BannerOptions = {}): void {
  console.log(buildBanner(opts));
}
