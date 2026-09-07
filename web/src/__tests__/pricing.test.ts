import { describe, expect, it } from "vitest";
import { CLASSIQ_PLATFORM_FEE_USD, QPU_USD_PER_MIN, SERVICE_FEE_FROM_USD, estimate, formatUsd, qpuCost, roundUsd } from "@/lib/pricing";

describe("pricing", () => {
  it("exposes the published per-minute rates", () => {
    expect(QPU_USD_PER_MIN).toEqual({ payg: 96, flex: 72, premium: 48 });
    expect(SERVICE_FEE_FROM_USD).toBe(0.05);
    expect(CLASSIQ_PLATFORM_FEE_USD).toBe(2.08);
  });

  it("computes QPU cost from runtime seconds (matches docs/pricing.csv rows)", () => {
    expect(qpuCost(5, "payg")).toBe(8);
    expect(qpuCost(5, "flex")).toBe(6);
    expect(qpuCost(5, "premium")).toBe(4);
    expect(qpuCost(60, "payg")).toBe(96);
    expect(qpuCost(0, "payg")).toBe(0);
    expect(qpuCost(-1, "payg")).toBe(0);
    expect(qpuCost(Number.NaN, "payg")).toBe(0);
  });

  it("adds the Classiq fee only when Classiq runs", () => {
    const ibm = estimate(5, "payg");
    expect(ibm.classiqFeeUsd).toBe(0);
    expect(ibm.totalUsd).toBe(roundUsd(8 + 0.05));

    const classiq = estimate(5, "payg", { usesClassiq: true });
    expect(classiq.classiqFeeUsd).toBe(2.08);
    expect(classiq.totalUsd).toBe(roundUsd(8 + 0.05 + 2.08));
  });

  it("never charges less than the minimum service fee", () => {
    expect(estimate(1, "flex", { serviceFeeUsd: 0.01 }).serviceFeeUsd).toBe(0.05);
    expect(estimate(1, "flex", { serviceFeeUsd: 0.5 }).serviceFeeUsd).toBe(0.5);
  });

  it("formats USD", () => {
    expect(formatUsd(8.03)).toBe("$8.03");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(96, 0)).toBe("$96");
    expect(formatUsd(null)).toBe("—");
  });
});
