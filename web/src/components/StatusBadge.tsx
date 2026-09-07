"use client";

import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/utils";

type Tone = "green" | "amber" | "gray" | "red" | "blue";

const TONES: Record<string, Tone> = {
  estimated: "green",
  success: "green",
  completed: "green",
  ok: "green",
  high: "green",
  assumed: "amber",
  medium: "amber",
  pending: "amber",
  running: "blue",
  not_applicable: "gray",
  skipped: "gray",
  low: "red",
  error: "red",
  failed: "red",
  timeout: "red",
};

const KNOWN: ReadonlySet<string> = new Set([
  "estimated",
  "assumed",
  "not_applicable",
  "error",
  "success",
  "timeout",
  "skipped",
  "completed",
  "failed",
  "pending",
  "running",
  "ok",
  "low",
  "medium",
  "high",
]);

const toneClass: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const t = useT();
  const s = (status ?? "").toLowerCase();
  const tone = TONES[s] ?? "gray";
  const label = KNOWN.has(s) ? t(`status.${s}` as MessageKey) : status || "—";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        toneClass[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
