"use client";

import { useT } from "@/i18n/context";
import type { Interpretation } from "@/lib/api/types";
import { formatPercent } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { Card } from "./ui";

function List({ items }: { items: string[] | undefined }) {
  const t = useT();
  if (!items || items.length === 0) return <p className="text-sm text-slate-500">{t("common.none")}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function metricValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function InterpretationPanel({ interpretation, className }: { interpretation: Interpretation | null | undefined; className?: string }) {
  const t = useT();
  if (!interpretation) {
    return (
      <Card title={t("interp.title")} className={className}>
        <p className="text-sm text-slate-500">{t("interp.none")}</p>
      </Card>
    );
  }
  const it = interpretation;
  const noise = it.noise_concerns && it.noise_concerns.length > 0
    ? it.noise_concerns
    : (it.noise_analysis ?? []).map((n) => `${n.kind} @ ${n.location}: ${n.message}`);
  const metrics = Object.entries(it.key_metrics ?? {});

  return (
    <Card
      title={t("interp.title")}
      className={className}
      action={
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t("interp.confidence")}</span>
          <StatusBadge status={it.confidence} />
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("interp.summary")}</h3>
          <p className="text-sm text-slate-900">{it.summary}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-indigo-50 p-3">
            <div className="text-xs text-indigo-700">{t("interp.successProbability")}</div>
            <div className="text-2xl font-bold text-indigo-900">{formatPercent(it.success_probability, 2)}</div>
          </div>
          {metrics.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("interp.keyMetrics")}</h3>
              <dl className="grid grid-cols-1 gap-x-4 text-sm">
                {metrics.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <dt className="truncate font-mono text-xs text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-900">{metricValue(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("interp.noiseConcerns")}</h3>
          <List items={noise} />
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("interp.business")}</h3>
          <p className="whitespace-pre-line text-sm text-slate-900">{it.business_interpretation}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("interp.recommendations")}</h3>
            <List items={it.recommendations} />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("interp.nextSteps")}</h3>
            <List items={it.next_steps} />
          </div>
        </div>
      </div>
    </Card>
  );
}
