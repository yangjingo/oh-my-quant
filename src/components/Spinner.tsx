/**
 * Ora-style animated spinner.
 * Patterns from pi/src/components/loader.ts — frame-based animation at configurable interval.
 */
import React, { useState, useEffect, useRef } from "react";
import { Text } from "ink";

// Ora-classic spinner sets
export const SPINNERS = {
  dots:       { frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], interval: 80 },
  line:       { frames: ["|","/","-","\\"], interval: 120 },
  dots2:      { frames: ["⣾","⣽","⣻","⢿","⡿","⣟","⣯","⣷"], interval: 80 },
  arc:        { frames: ["◜","◠","◝","◞","◡","◟"], interval: 100 },
  star:       { frames: ["✶","✸","✹","✺","✹","✷"], interval: 70 },
  bounce:     { frames: ["⠁","⠂","⠄","⠂"], interval: 120 },
  triangle:   { frames: ["◢","◣","◤","◥"], interval: 100 },
  pipe:       { frames: ["┤","┘","┴","└","├","┌","┬","┐"], interval: 80 },
  simpleDots: { frames: [".  ",".. ","..."], interval: 200 },
};

export type SpinnerVariant = keyof typeof SPINNERS;

interface SpinnerProps {
  active: boolean;
  variant?: SpinnerVariant;
  color?: string;
}

export function Spinner({ active, variant = "dots", color }: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const cfg = SPINNERS[variant];

  useEffect(() => {
    if (!active) {
      if (ref.current) clearInterval(ref.current);
      ref.current = null;
      return;
    }
    ref.current = setInterval(() => {
      setFrame((f) => (f + 1) % cfg.frames.length);
    }, cfg.interval);
    return () => {
      if (ref.current) clearInterval(ref.current);
      ref.current = null;
    };
  }, [active, variant, cfg.frames.length, cfg.interval]);

  if (!active) return null;
  return <Text color={color}>{cfg.frames[frame]}</Text>;
}
