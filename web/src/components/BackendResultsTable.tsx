"use client";

import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import type { BackendResult, OptimizationBackend } from "@/lib/api/types";
import { formatUsd } from "@/lib/pricing";
import { cn, formatNumber } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

/** Loose row shape so the table also renders JobDetail.backend_results (untyped dicts). */
export type BackendRow = Omit<Partial<BackendResult>, "backend" | "status"> & { backend?: string; status?: string };

export function engineLabel(t: (k: MessageKey) => string, backend: string | undefined): string {
  if (!backend) return "—";
  const key = `engine.${backend}` as MessageKey;
  return (["auto", "ibm_composer", "classiq"] as OptimizationBackend[]).includes(backend as OptimizationBackend)
    ? t(key)
    : backend;
}

export function BackendResultsTable({
  results,
  selected,
  className,
}: {
  results: Record<string, BackendRow> | BackendRow[] | null | undefined;
  selected?: string | null;
  className?: string;
}) {
  const t = useT();
  const rows: BackendRow[] = !results
    ? []
    : Array.isArray(results)
      ? results
      : Object.entries(results).map(([k, v]) => ({ ...v, backend: v.backend ?? k }));

  if (rows.length === 0) return <p className="text-sm text-slate-500">{t("results.empty")}</p>;

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-sm text-slate-800 whitespace-nowrap";

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-slate-200", className)}>
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>{t("results.backend")}</th>
            <th className={th}>{t("results.status")}</th>
            <th className={th}>{t("results.depth")}</th>
            <th className={th}>{t("results.gates")}</th>
            <th className={th}>{t("results.twoQubit")}</th>
            <th className={th}>{t("results.width")}</th>
            <th className={th}>{t("results.runtime")}</th>
            <th className={th}>{t("results.cost")}</th>
            <th className={th}>{t("results.duration")}</th>
            <th className={th}>{t("results.reason")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r, i) => {
            const isSel = selected && r.backend === selected;
            return (
              <tr key={`${r.backend ?? i}`} className={cn(isSel && "bg-indigo-50/60")}>
                <td className={cn(td, "font-medium")}>
                  {engineLabel(t, r.backend)}
                  {isSel && <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">★</span>}
                </td>
                <td className={td}><StatusBadge status={r.status} /></td>
                <td className={td}>{formatNumber(r.depth ?? r.metrics?.depth)}</td>
                <td className={td}>{formatNumber(r.gate_count ?? r.metrics?.gate_count)}</td>
                <td className={td}>{formatNumber(r.two_qubit_gate_count ?? r.metrics?.two_qubit_gate_count)}</td>
                <td className={td}>{formatNumber(r.width ?? r.metrics?.width)}</td>
                <td className={td}>{r.estimated_qpu_runtime_sec != null ? `${formatNumber(r.estimated_qpu_runtime_sec, 3)} ${t("common.seconds")}` : "—"}</td>
                <td className={td}>{formatUsd(r.estimated_qpu_cost_usd)}</td>
                <td className={td}>{r.duration_ms != null ? `${formatNumber(r.duration_ms)} ${t("common.ms")}` : "—"}</td>
                <td className={cn(td, "max-w-xs whitespace-normal text-slate-600")}>{r.reason ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
