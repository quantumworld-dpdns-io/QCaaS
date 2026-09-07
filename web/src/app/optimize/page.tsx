"use client";

import { useMemo, useState } from "react";
import { BackendResultsTable, engineLabel } from "@/components/BackendResultsTable";
import { BillingCard } from "@/components/BillingCard";
import { CircuitForm, DEFAULT_FORM_VALUES, buildOptimizeExtras, buildQuoteRequest, type CircuitFormValues } from "@/components/CircuitForm";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBanner } from "@/components/ErrorBanner";
import { HISTOGRAM_TOP_N, Histogram, toHistogramData } from "@/components/Histogram";
import { InterpretationPanel } from "@/components/InterpretationPanel";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, EmptyState, KeyValue, PageHeader } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { api, type RateLimit } from "@/lib/api/client";
import type { OptimizeRequest, OptimizeResponse } from "@/lib/api/types";
import { formatNumber, parseCsvList, transpiledExtension } from "@/lib/utils";

export default function OptimizePage() {
  const { t } = useI18n();
  const [values, setValues] = useState<CircuitFormValues>(DEFAULT_FORM_VALUES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [rate, setRate] = useState<RateLimit | null>(null);

  const submit = async () => {
    setError(null);
    let body: OptimizeRequest;
    try {
      body = { ...buildQuoteRequest(values), ...buildOptimizeExtras(values) };
    } catch (e) {
      setError(new Error(t((e as Error).message as MessageKey)));
      return;
    }
    setLoading(true);
    try {
      const r = await api.optimize(body);
      setResult(r.data);
      setRate(r.rateLimit);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const histogram = useMemo(() => {
    if (!result?.simulation_result) return [];
    return toHistogramData(result.simulation_result.probabilities, result.simulation_result.counts, parseCsvList(values.targetBitstrings));
  }, [result, values.targetBitstrings]);

  const transpiled = result?.transpiled_circuit ?? result?.results?.[result.selected_result.backend]?.transpiled_circuit ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("optimize.title")} subtitle={t("optimize.subtitle")} />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <CircuitForm mode="optimize" values={values} onChange={setValues} onSubmit={submit} loading={loading} />
        </div>
        <div className="space-y-4 xl:col-span-3">
          {error ? <ErrorBanner error={error} onRetry={submit} /> : null}
          {!result && !error && <EmptyState>{t("optimize.empty")}</EmptyState>}
          {result && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <MetricCard label={t("optimize.depth")} before={result.depth_before} after={result.depth_after} />
                <MetricCard label={t("optimize.gates")} before={result.gate_count_before} after={result.gate_count_after} />
              </div>

              <Card
                title={t("optimize.results")}
                action={
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{t("optimize.jobId")}:</span>
                    <code className="font-mono">{result.job_id}</code>
                    <StatusBadge status={result.status} />
                  </div>
                }
              >
                <BackendResultsTable results={result.results} selected={result.selected_result.backend} />
                <div className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm">
                  <span className="font-semibold text-indigo-900">{t("optimize.selectedBy", { backend: engineLabel(t, result.selected_result.backend) })}</span>
                  <span className="text-indigo-800"> — {result.selected_result.reason}</span>
                  <span className="ml-2 text-xs text-indigo-700">
                    ({t("optimize.depth")}: {formatNumber(result.selected_result.depth)}, {t("optimize.gates")}: {formatNumber(result.selected_result.gate_count)})
                  </span>
                </div>
                {rate && rate.limit !== null && <p className="mt-2 text-xs text-slate-500">{t("common.rateLimit", { remaining: rate.remaining ?? "?", limit: rate.limit })}</p>}
              </Card>

              {transpiled && (
                <Card title={t("optimize.transpiled")}>
                  <CodeBlock
                    code={transpiled.source}
                    filename={`${result.job_id}-${result.target_backend}.${transpiledExtension(transpiled.format)}`}
                    title={transpiled.format}
                    collapsible
                    defaultOpen={false}
                  />
                  {transpiled.layout && Object.keys(transpiled.layout).length > 0 && (
                    <div className="mt-3">
                      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("optimize.layout")}</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(transpiled.layout).map(([v, p]) => (
                          <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                            q{v} → {p}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              <Card
                title={t("optimize.simulation")}
                action={
                  result.simulation_result ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>{t("optimize.shots", { n: formatNumber(result.simulation_result.shots) })}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{result.simulation_result.noisy ? t("optimize.noisy") : t("optimize.ideal")}</span>
                    </div>
                  ) : null
                }
              >
                {result.simulation_result ? (
                  <>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("optimize.histogram", { n: Math.min(HISTOGRAM_TOP_N, histogram.length) })}</h4>
                    <Histogram data={histogram} />
                  </>
                ) : (
                  <p className="text-sm text-slate-500">{t("optimize.noSimulation")}</p>
                )}
              </Card>

              {result.qpu_execution && (
                <Card title={t("optimize.qpu")}>
                  <KeyValue
                    items={[
                      { label: t("optimize.qpu"), value: result.qpu_execution.submitted ? t("optimize.qpuSubmitted") : t("optimize.qpuNotSubmitted") },
                      ...(result.qpu_execution.ibm_job_id ? [{ label: "IBM job", value: <code className="font-mono text-xs">{result.qpu_execution.ibm_job_id}</code> }] : []),
                      ...(result.qpu_execution.status ? [{ label: t("results.status"), value: <StatusBadge status={result.qpu_execution.status} /> }] : []),
                      ...(result.qpu_execution.message ? [{ label: t("quote.note"), value: result.qpu_execution.message }] : []),
                    ]}
                  />
                </Card>
              )}

              <InterpretationPanel interpretation={result.interpretation} />
              <BillingCard billing={result.billing} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
