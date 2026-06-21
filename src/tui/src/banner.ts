/**
 * WhyJ Quant — CLI welcome banner (compact)
 * Single-line wordmark + motto. Gold accent on dark terminals.
 */
type RGB = [number, number, number];

import { GOLD, CASH_WARM, CREAM, MUTED } from "./styles.ts";
import { hexToRgb } from "./theme.ts";

const GOLD_RGB: RGB = hexToRgb(GOLD);
const GOLD_ON_DARK_RGB: RGB = hexToRgb(CASH_WARM);
const INK_RGB: RGB = hexToRgb(CREAM);
const MUTED_RGB: RGB = hexToRgb(MUTED);
const RESET = "\x1b[0m";

const supportsColor =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY ?? false);

const fg = (r: number, g: number, b: number) =>
  supportsColor ? `\x1b[38;2;${r};${g};${b}m` : "";
const reset = () => (supportsColor ? RESET : "");
const muted = (s: string) => fg(...MUTED_RGB) + s + reset();

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
    if (ch === " ") {
      out += ch;
      return;
    }
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
  const trend = "▁▃▅▇█";
  const textIndent = " ".repeat([...trend].length + 2);
  const logo =
    lead +
    gradient(trend, GOLD_RGB, GOLD_ON_DARK_RGB) + "  " +
    fg(...INK_RGB) + "WhyJ Quant" + reset();

  const tagline =
    lead +
    textIndent +
    muted("v" + version);

  return [
    ...Array(Math.max(0, marginTop)).fill(""),
    logo,
    tagline,
    "",
  ].join("\n");
}

export function printBanner(opts: BannerOptions = {}): void {
  console.log(buildBanner(opts));
}
