"use client";

import { useT } from "@/i18n/context";
import { cn, formatNumber } from "@/lib/utils";

export function MetricCard({ label, before, after }: { label: string; before: number; after: number | null | undefined }) {
  const t = useT();
  const hasAfter = after !== null && after !== undefined;
  const delta = hasAfter && before > 0 ? ((after - before) / before) * 100 : null;
  const improved = delta !== null && delta < 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-end gap-3">
        <div>
          <div className="text-xs text-slate-500">{t("optimize.before")}</div>
          <div className="text-xl font-semibold text-slate-700">{formatNumber(before)}</div>
        </div>
        <div className="pb-1 text-slate-400">→</div>
        <div>
          <div className="text-xs text-slate-500">{t("optimize.after")}</div>
          <div className="text-2xl font-bold text-slate-900">{formatNumber(after)}</div>
        </div>
        {delta !== null && (
          <div
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold",
              improved ? "bg-emerald-50 text-emerald-700" : delta === 0 ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700",
            )}
            title={t("optimize.change")}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
