"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPercent } from "@/lib/utils";

export const HISTOGRAM_TOP_N = 16;

export interface HistogramDatum {
  bitstring: string;
  probability: number;
  count?: number;
  target?: boolean;
}

export function toHistogramData(
  probabilities: Record<string, number>,
  counts?: Record<string, number>,
  targets: string[] = [],
  topN = HISTOGRAM_TOP_N,
): HistogramDatum[] {
  const targetSet = new Set(targets);
  return Object.entries(probabilities)
    .map(([bitstring, probability]) => ({
      bitstring,
      probability,
      count: counts?.[bitstring],
      target: targetSet.has(bitstring),
    }))
    .sort((a, b) => b.probability - a.probability || a.bitstring.localeCompare(b.bitstring))
    .slice(0, topN);
}

export function Histogram({ data, height = 260 }: { data: HistogramDatum[]; height?: number }) {
  if (data.length === 0) return null;
  return (
    <div style={{ width: "100%", height }} role="img" aria-label="Measurement probability histogram">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="bitstring" tick={{ fontSize: 11, fontFamily: "monospace" }} interval={0} angle={data.length > 8 ? -45 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 56 : 30} />
          <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} width={44} domain={[0, 1]} />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            formatter={(value, _name, item) => {
              const d = item?.payload as HistogramDatum | undefined;
              const pct = formatPercent(typeof value === "number" ? value : Number(value), 2);
              return [d?.count !== undefined ? `${pct} (${d.count})` : pct, "P"];
            }}
          />
          <Bar dataKey="probability" fill="#4f46e5" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
