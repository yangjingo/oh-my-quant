/**
 * Animated text effects: pulse, progress dots, streaming cursor, elapsed timer.
 * Pattern: pi/src/components/loader.ts — frame-based animation driven by setInterval.
 */
import React, { useState, useEffect, useRef } from "react";
import { Text } from "ink";

// ── Pulse — brightness oscillation ──

export function Pulse({ text, active, intervalMs = 600 }: { text: string; active: boolean; intervalMs?: number }) {
  const [dim, setDim] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) { if (ref.current) clearInterval(ref.current); ref.current = null; return; }
    ref.current = setInterval(() => setDim((d) => !d), intervalMs);
    return () => { if (ref.current) clearInterval(ref.current); ref.current = null; };
  }, [active, intervalMs]);

  if (!active) return <Text>{text}</Text>;
  return <Text dimColor={dim}>{text}</Text>;
}

// ── Progress dots — animated trailing dots ──

const DOTS_FRAMES = ["", ".", "..", "..."];

export function ProgressDots({ active, intervalMs = 300 }: { active: boolean; intervalMs?: number }) {
  const [frame, setFrame] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) { if (ref.current) clearInterval(ref.current); ref.current = null; return; }
    ref.current = setInterval(() => setFrame((f) => (f + 1) % DOTS_FRAMES.length), intervalMs);
    return () => { if (ref.current) clearInterval(ref.current); ref.current = null; };
  }, [active, intervalMs]);

  if (!active) return null;
  return <Text>{DOTS_FRAMES[frame]}</Text>;
}

// ── Streaming cursor — blinking block ──

export function StreamCursor({ active, intervalMs = 530 }: { active: boolean; intervalMs?: number }) {
  const [visible, setVisible] = useState(true);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) { if (ref.current) clearInterval(ref.current); ref.current = null; return; }
    ref.current = setInterval(() => setVisible((v) => !v), intervalMs);
    return () => { if (ref.current) clearInterval(ref.current); ref.current = null; };
  }, [active, intervalMs]);

  if (!active) return null;
  return <Text dimColor={!visible}>{visible ? "▌" : " "}</Text>;
}

// ── Elapsed timer — shows MM:SS since active ──

export function ElapsedTimer({ active, startMs }: { active: boolean; startMs?: number }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(startMs ?? Date.now());
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) { if (ref.current) clearInterval(ref.current); ref.current = null; return; }
    ref.current = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => { if (ref.current) clearInterval(ref.current); ref.current = null; };
  }, [active]);

  if (!active) return null;
  const s = Math.floor(elapsed / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return <Text dimColor>{m}:{ss}</Text>;
}
