"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, PageHeader, Select, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { api } from "@/lib/api/client";
import type { JobList } from "@/lib/api/types";
import { formatUsd } from "@/lib/pricing";
import { useApiQuery } from "@/lib/useApiQuery";
import { useCredentials } from "@/lib/useCredentials";
import { formatDate } from "@/lib/utils";

const KINDS = ["optimize", "quote", "interpret"] as const;
const PAGE_SIZES = [10, 25, 50, 100];

export default function JobsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { credential, ready } = useCredentials();
  const [kind, setKind] = useState<string>("");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const fetcher = useCallback((signal: AbortSignal) => api.jobs({ kind: kind || undefined, limit, offset }, signal), [kind, limit, offset]);
  const enabled = ready && !!credential;
  const { data, error, loading, refetch } = useApiQuery<JobList>(enabled ? `${credential}|${kind}|${limit}|${offset}` : null, fetcher);

  const total = data?.total ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-sm text-slate-800 whitespace-nowrap";
  const go = (id: string) => router.push(`/jobs/${encodeURIComponent(id)}`);

  return (
    <div className="space-y-6">
      <PageHeader title={t("jobs.title")} subtitle={t("jobs.subtitle")} />

      {ready && !credential && (
        <EmptyState>
          <Link href="/settings" className="text-indigo-700 underline">
            {t("jobs.needKey")}
          </Link>
        </EmptyState>
      )}

      {enabled && (
        <Card
          title={data ? t("jobs.count", { total }) : t("jobs.title")}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                {t("jobs.kind")}
                <Select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setOffset(0);
                  }}
                  className="w-auto"
                >
                  <option value="">{t("jobs.allKinds")}</option>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`jobs.kind.${k}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                {t("jobs.pageSize")}
                <Select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setOffset(0);
                  }}
                  className="w-auto"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              {loading && <Spinner />}
            </div>
          }
        >
          {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
          {data && data.items.length === 0 && !error && <p className="text-sm text-slate-500">{t("jobs.empty")}</p>}
          {data && data.items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>{t("jobs.jobId")}</th>
                    <th className={th}>{t("jobs.kind")}</th>
                    <th className={th}>{t("jobs.status")}</th>
                    <th className={th}>{t("jobs.target")}</th>
                    <th className={th}>{t("jobs.selected")}</th>
                    <th className={th}>{t("jobs.total")}</th>
                    <th className={th}>{t("jobs.created")}</th>
                    <th className={th}>{t("jobs.expires")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((j) => (
                    <tr
                      key={j.job_id}
                      className="cursor-pointer hover:bg-indigo-50/50"
                      onClick={() => go(j.job_id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") go(j.job_id);
                      }}
                    >
                      <td className={td}>
                        <Link href={`/jobs/${encodeURIComponent(j.job_id)}`} className="font-mono text-xs text-indigo-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {j.job_id}
                        </Link>
                      </td>
                      <td className={td}>{(KINDS as readonly string[]).includes(j.kind) ? t(`jobs.kind.${j.kind}` as MessageKey) : j.kind}</td>
                      <td className={td}>
                        <StatusBadge status={j.status} />
                      </td>
                      <td className={td}>{j.target_backend ?? "—"}</td>
                      <td className={td}>{j.selected_backend ?? "—"}</td>
                      <td className={td}>{formatUsd(j.total_usd)}</td>
                      <td className={td}>{formatDate(j.created_at, locale)}</td>
                      <td className={td}>{formatDate(j.expires_at, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && total > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>{t("jobs.pageOf", { page, pages })}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>
                  ← {t("common.previous")}
                </Button>
                <Button variant="secondary" size="sm" disabled={offset + limit >= total || loading} onClick={() => setOffset(offset + limit)}>
                  {t("common.next")} →
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
