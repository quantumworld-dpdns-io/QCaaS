"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import type { BudgetPlan, OptimizationBackend, QuoteRequest, RedundancyModeName, SelectionMetric } from "@/lib/api/types";
import {
  CIRCUIT_FORMATS,
  EXAMPLE_BELL_QASM2,
  OPTIMIZATION_BACKENDS,
  PRIMARY_BACKENDS,
  REDUNDANCY_MODES,
  SELECTION_METRICS,
  TARGET_BACKENDS,
  type AcceptedCircuitFormat,
} from "@/lib/constants";
import { PLANS } from "@/lib/pricing";
import { parseCsvList } from "@/lib/utils";
import { Button, Card, Checkbox, Field, Input, Select, Spinner, Textarea } from "./ui";

export interface CircuitFormValues {
  circuitFormat: AcceptedCircuitFormat;
  circuitSource: string;
  targetBackend: string;
  shots: number;
  plan: BudgetPlan;
  optimizationLevel: number;
  optimizationBackend: OptimizationBackend;
  redundancyMode: RedundancyModeName;
  primary: Exclude<OptimizationBackend, "auto">;
  timeoutSec: string;
  selectionMetric: SelectionMetric;
  maxDepth: string;
  maxWidth: string;
  maxGateCount: string;
  errorBound: string;
  // optimize-only
  includeSimulation: boolean;
  noisySimulation: boolean;
  targetBitstrings: string;
  algorithm: string;
  problemDescription: string;
  targetMetric: string;
}

export const DEFAULT_FORM_VALUES: CircuitFormValues = {
  circuitFormat: "openqasm2",
  circuitSource: "",
  targetBackend: "ibm_sherbrooke",
  shots: 1024,
  plan: "payg",
  optimizationLevel: 2,
  optimizationBackend: "auto",
  redundancyMode: "fallback",
  primary: "ibm_composer",
  timeoutSec: "",
  selectionMetric: "qpu_cost",
  maxDepth: "",
  maxWidth: "",
  maxGateCount: "",
  errorBound: "",
  includeSimulation: true,
  noisySimulation: false,
  targetBitstrings: "",
  algorithm: "",
  problemDescription: "",
  targetMetric: "",
};

function optInt(s: string): number | undefined {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function optFloat(s: string): number | undefined {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Build the QuoteRequest (shared subset). Throws Error with a MessageKey for validation errors. */
export function buildQuoteRequest(v: CircuitFormValues): QuoteRequest {
  const src = v.circuitSource.trim();
  if (!src) throw new Error("form.errCircuitRequired");
  let payload: QuoteRequest["circuit_payload"] = src;
  if (v.circuitFormat === "json") {
    try {
      const parsed: unknown = JSON.parse(src);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new Error("form.errInvalidJson");
    }
  }
  const constraints: QuoteRequest["constraints"] = {};
  const md = optInt(v.maxDepth);
  const mw = optInt(v.maxWidth);
  const mg = optInt(v.maxGateCount);
  const eb = optFloat(v.errorBound);
  if (md) constraints.max_depth = md;
  if (mw) constraints.max_width = mw;
  if (mg) constraints.max_gate_count = mg;
  if (eb && eb <= 1) constraints.error_bound = eb;

  const timeout = optFloat(v.timeoutSec);
  return {
    circuit_format: v.circuitFormat,
    circuit_payload: payload,
    target_backend: v.targetBackend,
    optimization_level: v.optimizationLevel,
    shots: v.shots,
    budget_mode: v.plan,
    optimization_backend: v.optimizationBackend,
    ...(Object.keys(constraints).length ? { constraints } : {}),
    redundancy_mode: {
      mode: v.redundancyMode,
      primary: v.primary,
      selection_metric: v.selectionMetric,
      ...(timeout ? { timeout_sec: Math.min(timeout, 600) } : {}),
    },
  };
}

export function buildOptimizeExtras(v: CircuitFormValues) {
  const bits = parseCsvList(v.targetBitstrings);
  const ctx = {
    ...(v.algorithm.trim() ? { algorithm: v.algorithm.trim() } : {}),
    ...(v.problemDescription.trim() ? { problem_description: v.problemDescription.trim() } : {}),
    ...(v.targetMetric.trim() ? { target_metric: v.targetMetric.trim() } : {}),
  };
  return {
    include_simulation: v.includeSimulation,
    noisy_simulation: v.noisySimulation,
    execute_on_qpu: false,
    ...(bits.length ? { target_bitstrings: bits } : {}),
    ...(Object.keys(ctx).length ? { context: ctx } : {}),
  };
}

export function CircuitForm({
  mode,
  values,
  onChange,
  onSubmit,
  loading,
}: {
  mode: "quote" | "optimize";
  values: CircuitFormValues;
  onChange: (next: CircuitFormValues) => void;
  onSubmit: () => void;
  loading?: boolean;
}) {
  const t = useT();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const set = <K extends keyof CircuitFormValues>(k: K, val: CircuitFormValues[K]) => onChange({ ...values, [k]: val });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const name = f.name.toLowerCase();
      const fmt: AcceptedCircuitFormat | null = name.endsWith(".json")
        ? "json"
        : name.endsWith(".qmod")
          ? "qmod"
          : /^\s*OPENQASM\s+3/i.test(text)
            ? "openqasm3"
            : /^\s*OPENQASM\s+2/i.test(text)
              ? "openqasm2"
              : null;
      onChange({ ...values, circuitSource: text, ...(fmt ? { circuitFormat: fmt } : {}) });
      setFileError(null);
    } catch {
      setFileError(t("form.errFileRead"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Card
        title={t("form.title")}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              {t("form.upload")}
            </Button>
            <input ref={fileRef} type="file" accept=".qasm,.qasm2,.qasm3,.txt,.json,.qmod" className="hidden" onChange={onFile} />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onChange({ ...values, circuitFormat: "openqasm2", circuitSource: EXAMPLE_BELL_QASM2 })}
            >
              {t("form.loadExample")}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.circuitFormat")} htmlFor={`${id}-fmt`}>
            <Select id={`${id}-fmt`} value={values.circuitFormat} onChange={(e) => set("circuitFormat", e.target.value as AcceptedCircuitFormat)}>
              {CIRCUIT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`format.${f}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.targetBackend")} htmlFor={`${id}-backend`}>
            <Select id={`${id}-backend`} value={values.targetBackend} onChange={(e) => set("targetBackend", e.target.value)}>
              {TARGET_BACKENDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("form.circuit")} htmlFor={`${id}-src`} className="mt-4">
          <Textarea
            id={`${id}-src`}
            rows={8}
            value={values.circuitSource}
            onChange={(e) => set("circuitSource", e.target.value)}
            placeholder={t("form.circuitPlaceholder")}
            spellCheck={false}
          />
        </Field>
        {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("form.shots")} htmlFor={`${id}-shots`}>
            <Input
              id={`${id}-shots`}
              type="number"
              min={1}
              max={100000}
              value={values.shots}
              onChange={(e) => set("shots", Math.max(1, Math.min(100000, Number(e.target.value) || 1)))}
            />
          </Field>
          <Field label={t("form.plan")} htmlFor={`${id}-plan`}>
            <Select id={`${id}-plan`} value={values.plan} onChange={(e) => set("plan", e.target.value as BudgetPlan)}>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {t(`plan.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.optimizationLevel")} htmlFor={`${id}-level`}>
            <Select id={`${id}-level`} value={values.optimizationLevel} onChange={(e) => set("optimizationLevel", Number(e.target.value))}>
              {[0, 1, 2, 3].map((l) => (
                <option key={l} value={l}>
                  {t(`level.${l}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.optimizationBackend")} htmlFor={`${id}-engine`}>
            <Select id={`${id}-engine`} value={values.optimizationBackend} onChange={(e) => set("optimizationBackend", e.target.value as OptimizationBackend)}>
              {OPTIMIZATION_BACKENDS.map((b) => (
                <option key={b} value={b}>
                  {t(`engine.${b}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={t("form.redundancy")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("form.redundancyMode")} htmlFor={`${id}-mode`}>
            <Select id={`${id}-mode`} value={values.redundancyMode} onChange={(e) => set("redundancyMode", e.target.value as RedundancyModeName)}>
              {REDUNDANCY_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`mode.${m}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.primary")} htmlFor={`${id}-primary`}>
            <Select id={`${id}-primary`} value={values.primary} onChange={(e) => set("primary", e.target.value as Exclude<OptimizationBackend, "auto">)}>
              {PRIMARY_BACKENDS.map((b) => (
                <option key={b} value={b}>
                  {t(`engine.${b}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.selectionMetric")} htmlFor={`${id}-metric`}>
            <Select id={`${id}-metric`} value={values.selectionMetric} onChange={(e) => set("selectionMetric", e.target.value as SelectionMetric)}>
              {SELECTION_METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`metric.${m}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${t("form.timeout")} (${t("common.optional")})`} htmlFor={`${id}-timeout`}>
            <Input id={`${id}-timeout`} type="number" min={1} max={600} step="any" value={values.timeoutSec} onChange={(e) => set("timeoutSec", e.target.value)} />
          </Field>
        </div>
      </Card>

      {mode === "optimize" && (
        <Card title={t("form.simulation")}>
          <div className="flex flex-wrap gap-6">
            <Checkbox label={t("form.includeSimulation")} checked={values.includeSimulation} onChange={(e) => set("includeSimulation", e.target.checked)} />
            <Checkbox
              label={t("form.noisySimulation")}
              checked={values.noisySimulation}
              disabled={!values.includeSimulation}
              onChange={(e) => set("noisySimulation", e.target.checked)}
            />
          </div>
          <Field label={t("form.targetBitstrings")} hint={t("form.targetBitstringsHint")} htmlFor={`${id}-bits`} className="mt-4">
            <Input id={`${id}-bits`} value={values.targetBitstrings} onChange={(e) => set("targetBitstrings", e.target.value)} placeholder="00, 11" className="font-mono" />
          </Field>
          <h3 className="mt-5 mb-2 text-sm font-semibold text-slate-800">{t("form.context")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("form.algorithm")} htmlFor={`${id}-alg`}>
              <Input id={`${id}-alg`} value={values.algorithm} onChange={(e) => set("algorithm", e.target.value)} placeholder={t("form.algorithmPlaceholder")} />
            </Field>
            <Field label={t("form.problem")} htmlFor={`${id}-prob`}>
              <Input id={`${id}-prob`} value={values.problemDescription} onChange={(e) => set("problemDescription", e.target.value)} placeholder={t("form.problemPlaceholder")} />
            </Field>
            <Field label={t("form.targetMetric")} htmlFor={`${id}-tm`}>
              <Input id={`${id}-tm`} value={values.targetMetric} onChange={(e) => set("targetMetric", e.target.value)} placeholder={t("form.targetMetricPlaceholder")} />
            </Field>
          </div>
        </Card>
      )}

      <div>
        <button type="button" className="text-sm font-medium text-indigo-700 hover:underline" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          {advanced ? "▾" : "▸"} {t("form.advanced")} · {t("form.constraints")}
        </button>
        {advanced && (
          <Card className="mt-2">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("form.maxDepth")} htmlFor={`${id}-md`}>
                <Input id={`${id}-md`} type="number" min={1} value={values.maxDepth} onChange={(e) => set("maxDepth", e.target.value)} />
              </Field>
              <Field label={t("form.maxWidth")} htmlFor={`${id}-mwd`}>
                <Input id={`${id}-mwd`} type="number" min={1} value={values.maxWidth} onChange={(e) => set("maxWidth", e.target.value)} />
              </Field>
              <Field label={t("form.maxGateCount")} htmlFor={`${id}-mg`}>
                <Input id={`${id}-mg`} type="number" min={1} value={values.maxGateCount} onChange={(e) => set("maxGateCount", e.target.value)} />
              </Field>
              <Field label={t("form.errorBound")} htmlFor={`${id}-eb`}>
                <Input id={`${id}-eb`} type="number" min={0} max={1} step="any" value={values.errorBound} onChange={(e) => set("errorBound", e.target.value)} />
              </Field>
            </div>
          </Card>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading}>
          {loading && <Spinner className="border-white/40 border-t-white" />}
          {loading ? t("common.submitting") : mode === "quote" ? t("form.submitQuote") : t("form.submitOptimize")}
        </Button>
        <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_FORM_VALUES })} disabled={loading}>
          {t("common.reset")}
        </Button>
      </div>
    </form>
  );
}
