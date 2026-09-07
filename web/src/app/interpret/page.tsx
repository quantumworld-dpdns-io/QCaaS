"use client";

import { useState, type FormEvent } from "react";
import { BillingCard } from "@/components/BillingCard";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InterpretationPanel } from "@/components/InterpretationPanel";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { api } from "@/lib/api/client";
import type { BudgetPlan, InterpretRequest, InterpretResponse, ResultFormat } from "@/lib/api/types";
import { EXAMPLE_COUNTS_JSON, RESULT_FORMATS, TARGET_BACKENDS } from "@/lib/constants";
import { PLANS } from "@/lib/pricing";
import { parseCsvList, parseIntList } from "@/lib/utils";

export default function InterpretPage() {
  const t = useT();
  const [format, setFormat] = useState<ResultFormat>("counts_dict");
  const [payload, setPayload] = useState("");
  const [bits, setBits] = useState("");
  const [algorithm, setAlgorithm] = useState("");
  const [problem, setProblem] = useState("");
  const [metric, setMetric] = useState("");
  const [backend, setBackend] = useState("");
  const [qubits, setQubits] = useState("");
  const [plan, setPlan] = useState<BudgetPlan>("payg");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<InterpretResponse | null>(null);

  const build = (): InterpretRequest => {
    const raw = payload.trim();
    if (!raw) throw new Error(t("interpret.errPayloadRequired"));
    let result_payload: InterpretRequest["result_payload"] = raw;
    if (format !== "csv") {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        result_payload = parsed as Record<string, unknown>;
      } catch {
        throw new Error(t("interpret.errInvalidJson"));
      }
    }
    const ctx = {
      ...(algorithm.trim() ? { algorithm: algorithm.trim() } : {}),
      ...(problem.trim() ? { problem_description: problem.trim() } : {}),
      ...(metric.trim() ? { target_metric: metric.trim() } : {}),
    };
    const targets = parseCsvList(bits);
    const physical = parseIntList(qubits);
    return {
      result_format: format,
      result_payload,
      budget_mode: plan,
      ...(Object.keys(ctx).length ? { context: ctx } : {}),
      ...(targets.length ? { target_bitstrings: targets } : {}),
      ...(backend ? { target_backend: backend } : {}),
      ...(physical.length ? { physical_qubits: physical } : {}),
    };
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    let body: InterpretRequest;
    try {
      body = build();
    } catch (err) {
      setError(err);
      return;
    }
    setLoading(true);
    try {
      const r = await api.interpret(body);
      setResult(r.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("interpret.title")} subtitle={t("interpret.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="space-y-4 lg:col-span-2" noValidate>
          <Card
            title={t("interpret.payload")}
            action={
              <Button variant="secondary" size="sm" onClick={() => { setFormat("counts_dict"); setPayload(EXAMPLE_COUNTS_JSON); setBits("00, 11"); }}>
                {t("interpret.loadExample")}
              </Button>
            }
          >
            <div className="space-y-4">
              <Field label={t("interpret.resultFormat")} htmlFor="rf">
                <Select id="rf" value={format} onChange={(e) => setFormat(e.target.value as ResultFormat)}>
                  {RESULT_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`resultFormat.${f}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("interpret.payload")} htmlFor="payload">
                <Textarea id="payload" rows={8} value={payload} onChange={(e) => setPayload(e.target.value)} placeholder={t("interpret.payloadPlaceholder")} spellCheck={false} />
              </Field>
              <Field label={t("form.targetBitstrings")} hint={t("form.targetBitstringsHint")} htmlFor="bits">
                <Input id="bits" value={bits} onChange={(e) => setBits(e.target.value)} placeholder="00, 11" className="font-mono" />
              </Field>
            </div>
          </Card>

          <Card title={t("form.context")}>
            <div className="space-y-4">
              <Field label={t("form.algorithm")} htmlFor="alg">
                <Input id="alg" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} placeholder={t("form.algorithmPlaceholder")} />
              </Field>
              <Field label={t("form.problem")} htmlFor="prob">
                <Textarea id="prob" rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder={t("form.problemPlaceholder")} className="font-sans" />
              </Field>
              <Field label={t("form.targetMetric")} htmlFor="tm">
                <Input id="tm" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder={t("form.targetMetricPlaceholder")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`${t("interpret.targetBackend")} (${t("common.optional")})`} hint={t("interpret.targetBackendHint")} htmlFor="tb">
                  <Select id="tb" value={backend} onChange={(e) => setBackend(e.target.value)}>
                    <option value="">{t("common.none")}</option>
                    {TARGET_BACKENDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`${t("interpret.physicalQubits")} (${t("common.optional")})`} hint={t("interpret.physicalQubitsHint")} htmlFor="pq">
                  <Input id="pq" value={qubits} onChange={(e) => setQubits(e.target.value)} placeholder="0, 1" className="font-mono" />
                </Field>
              </div>
              <Field label={t("form.plan")} htmlFor="plan">
                <Select id="plan" value={plan} onChange={(e) => setPlan(e.target.value as BudgetPlan)}>
                  {PLANS.map((p) => (
                    <option key={p} value={p}>
                      {t(`plan.${p}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Button type="submit" disabled={loading}>
            {loading && <Spinner className="border-white/40 border-t-white" />}
            {loading ? t("common.submitting") : t("interpret.submit")}
          </Button>
        </form>

        <div className="space-y-4 lg:col-span-3">
          {error ? <ErrorBanner error={error} onRetry={() => submit()} /> : null}
          {!result && !error && <EmptyState>{t("interpret.empty")}</EmptyState>}
          {result && (
            <>
              <InterpretationPanel interpretation={result.interpretation} />
              <BillingCard billing={result.billing} />
              <p className="text-xs text-slate-500">
                {t("optimize.jobId")}: <code className="font-mono">{result.job_id}</code>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
