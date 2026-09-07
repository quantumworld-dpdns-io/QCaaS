"use client";

import { useState } from "react";
import { engineLabel } from "@/components/BackendResultsTable";
import { BillingCard } from "@/components/BillingCard";
import { CircuitForm, DEFAULT_FORM_VALUES, buildQuoteRequest, type CircuitFormValues } from "@/components/CircuitForm";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, EmptyState, KeyValue, PageHeader } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { api, type RateLimit } from "@/lib/api/client";
import type { BackendEstimate, QuoteResponse } from "@/lib/api/types";
import { PLANS, formatUsd } from "@/lib/pricing";
import { cn, formatDate, formatNumber } from "@/lib/utils";

const ENGINES = ["ibm_composer", "classiq"] as const;

function EstimateCard({ engine, est, recommended, selectedPlan }: { engine: string; est: BackendEstimate | undefined; recommended: boolean; selectedPlan: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("rounded-xl border bg-white p-5 shadow-sm", recommended ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200")}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{engineLabel(t, engine)}</h3>
        <div className="flex items-center gap-2">
          {recommended && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">{t("quote.recommended")}</span>}
          <StatusBadge status={est?.status ?? "not_applicable"} />
        </div>
      </div>
      {est ? (
        <>
          <KeyValue
            items={[
              { label: t("quote.depth"), value: formatNumber(est.depth) },
              { label: t("quote.gates"), value: formatNumber(est.gate_count) },
              { label: t("quote.runtime"), value: est.estimated_qpu_runtime_sec != null ? `${formatNumber(est.estimated_qpu_runtime_sec, 3)} ${t("common.seconds")}` : "—" },
            ]}
          />
          <h4 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("quote.costPerPlan")}</h4>
          <ul className="divide-y divide-slate-100 text-sm">
            {PLANS.map((p) => (
              <li key={p} className={cn("flex justify-between py-1.5", p === selectedPlan && "font-semibold text-indigo-700")}>
                <span>{t(`plan.${p}` as MessageKey)}</span>
                <span>{formatUsd(est.estimated_qpu_cost_usd?.[p])}</span>
              </li>
            ))}
          </ul>
          {est.note && (
            <p className="mt-3 text-xs text-slate-500">
              {t("quote.note")}: {est.note}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500">{t("common.na")}</p>
      )}
    </div>
  );
}

export default function QuotePage() {
  const { t, locale } = useI18n();
  const [values, setValues] = useState<CircuitFormValues>(DEFAULT_FORM_VALUES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [rate, setRate] = useState<RateLimit | null>(null);

  const submit = async () => {
    setError(null);
    let body;
    try {
      body = buildQuoteRequest(values);
    } catch (e) {
      setError(new Error(t((e as Error).message as MessageKey)));
      return;
    }
    setLoading(true);
    try {
      const r = await api.quote(body);
      setResult(r.data);
      setRate(r.rateLimit);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("quote.title")} subtitle={t("quote.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <CircuitForm mode="quote" values={values} onChange={setValues} onSubmit={submit} loading={loading} />
        </div>
        <div className="space-y-4 lg:col-span-3">
          {error ? <ErrorBanner error={error} onRetry={submit} /> : null}
          {!result && !error && <EmptyState>{t("quote.empty")}</EmptyState>}
          {result && (
            <>
              <Card title={t("quote.estimates")}>
                <div className="grid gap-4 md:grid-cols-2">
                  {ENGINES.map((eng) => (
                    <EstimateCard key={eng} engine={eng} est={result.estimates[eng]} recommended={result.recommended_backend === eng} selectedPlan={result.plan} />
                  ))}
                </div>
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <span className="font-medium text-slate-900">{t("quote.recommended")}: </span>
                  <span className="font-semibold text-indigo-700">{engineLabel(t, result.recommended_backend)}</span>
                  <span className="text-slate-500"> — {t("quote.reason")}: </span>
                  <span className="text-slate-800">{result.recommendation_reason}</span>
                </div>
              </Card>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <KeyValue
                    items={[
                      { label: t("quote.quoteId"), value: <code className="font-mono text-xs">{result.quote_id}</code> },
                      { label: t("form.targetBackend"), value: result.target_backend },
                      { label: t("form.shots"), value: formatNumber(result.shots) },
                      { label: t("quote.selectedPlan"), value: t(`plan.${result.plan}` as MessageKey) },
                      { label: t("quote.runtime"), value: `${formatNumber(result.estimated_qpu_runtime_sec, 3)} ${t("common.seconds")}` },
                      { label: t("quote.validUntil"), value: formatDate(result.valid_until, locale) },
                    ]}
                  />
                  {rate && rate.limit !== null && <p className="mt-3 text-xs text-slate-500">{t("common.rateLimit", { remaining: rate.remaining ?? "?", limit: rate.limit })}</p>}
                </Card>
                <BillingCard billing={result.billing} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
