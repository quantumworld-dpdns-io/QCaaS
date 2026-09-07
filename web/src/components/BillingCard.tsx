"use client";

import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import type { Billing } from "@/lib/api/types";
import { formatUsd } from "@/lib/pricing";
import { Card } from "./ui";

export function BillingCard({ billing, className }: { billing: Billing | null | undefined; className?: string }) {
  const t = useT();
  if (!billing) return null;

  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: t("billing.plan"), value: t(`plan.${billing.plan}` as MessageKey) },
    { label: t("billing.qpuCost"), value: formatUsd(billing.qpu_cost_usd) },
    { label: t("billing.serviceFee"), value: formatUsd(billing.service_fee_usd) },
  ];
  if (billing.classiq_platform_fee_usd !== null && billing.classiq_platform_fee_usd !== undefined) {
    rows.push({ label: t("billing.classiqFee"), value: formatUsd(billing.classiq_platform_fee_usd) });
  }
  if (billing.actual_qpu_cost_usd !== null && billing.actual_qpu_cost_usd !== undefined) {
    rows.push({ label: t("billing.actualQpu"), value: formatUsd(billing.actual_qpu_cost_usd) });
  }

  return (
    <Card title={t("billing.title")} className={className}>
      <dl className="text-sm" data-testid="billing-card">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between border-b border-slate-100 py-1.5">
            <dt className="text-slate-500">{r.label}</dt>
            <dd className="font-medium text-slate-900">{r.value}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between pt-3">
          <dt className="font-semibold text-slate-900">{t("billing.total")}</dt>
          <dd className="text-lg font-bold text-indigo-700" data-testid="billing-total">
            {formatUsd(billing.total_usd)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
