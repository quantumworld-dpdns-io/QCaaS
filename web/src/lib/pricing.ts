import type { BudgetPlan } from "@/lib/api/types";

/**
 * Static pricing snapshot exported from the backend pricing model
 * (docs/pricing.csv). All values are USD.
 */
export const PLANS: readonly BudgetPlan[] = ["payg", "flex", "premium"];

/** QPU price per minute of runtime, by plan. */
export const QPU_USD_PER_MIN: Record<BudgetPlan, number> = {
  payg: 96,
  flex: 72,
  premium: 48,
};

/** Minimum QCaaS service fee per job. */
export const SERVICE_FEE_FROM_USD = 0.05;

/** Classiq platform fee, charged only when the Classiq engine actually runs. */
export const CLASSIQ_PLATFORM_FEE_USD = 2.08;

export interface PriceEstimate {
  plan: BudgetPlan;
  qpuCostUsd: number;
  serviceFeeUsd: number;
  classiqFeeUsd: number;
  totalUsd: number;
}

/** Round half-up to cents, avoiding binary float drift. */
export function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** QPU cost for a given runtime in seconds under a plan. */
export function qpuCost(runtimeSec: number, plan: BudgetPlan): number {
  if (!Number.isFinite(runtimeSec) || runtimeSec < 0) return 0;
  return roundUsd((runtimeSec / 60) * QPU_USD_PER_MIN[plan]);
}

/** Full estimate for one plan; adds the Classiq fee when that engine is used. */
export function estimate(
  runtimeSec: number,
  plan: BudgetPlan,
  opts: { usesClassiq?: boolean; serviceFeeUsd?: number } = {},
): PriceEstimate {
  const qpuCostUsd = qpuCost(runtimeSec, plan);
  const serviceFeeUsd = Math.max(SERVICE_FEE_FROM_USD, opts.serviceFeeUsd ?? SERVICE_FEE_FROM_USD);
  const classiqFeeUsd = opts.usesClassiq ? CLASSIQ_PLATFORM_FEE_USD : 0;
  return {
    plan,
    qpuCostUsd,
    serviceFeeUsd,
    classiqFeeUsd,
    totalUsd: roundUsd(qpuCostUsd + serviceFeeUsd + classiqFeeUsd),
  };
}

export function formatUsd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
