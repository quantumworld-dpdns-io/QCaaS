"use client";

import { useCallback, useState } from "react";
import { UsersTable } from "@/components/admin/UsersTable";
import { ErrorBanner } from "@/components/ErrorBanner";
import { RequireAuth } from "@/components/RequireAuth";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, PageHeader, Select, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { accounts } from "@/lib/auth/client";
import type { AdminJobList, AdminStats, AdminUserList, AuditList, User } from "@/lib/auth/types";
import { useAuth } from "@/lib/auth/useAuth";
import { formatUsd } from "@/lib/pricing";
import { asResult, useApiQuery } from "@/lib/useApiQuery";
import { formatDate, formatNumber } from "@/lib/utils";

const KINDS = ["optimize", "quote", "interpret"] as const;
const PAGE = 25;
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const td = "px-3 py-2 text-sm text-slate-800 whitespace-nowrap";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function kindLabel(t: (k: MessageKey) => string, kind: string): string {
  return (KINDS as readonly string[]).includes(kind) ? t(`jobs.kind.${kind}` as MessageKey) : kind;
}

function StatsSection() {
  const { t } = useI18n();
  const fetcher = useCallback((signal: AbortSignal) => asResult(accounts.admin.stats(signal)), []);
  const { data, error, loading, refetch } = useApiQuery<AdminStats>("admin-stats", fetcher);
  const split = (rec: Record<string, number>, label: (k: string) => string) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${label(k)} ${formatNumber(v)}`)
      .join(" · ") || "—";
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        {t("admin.stats")} {loading && <Spinner className="ml-2" />}
      </h2>
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={t("admin.stats.users")} value={formatNumber(data.users)} sub={`${t("admin.stats.usersWithKey")}: ${formatNumber(data.users_with_api_key)}`} />
          <Tile label={t("admin.stats.customers")} value={formatNumber(data.qcaas.customers)} sub={`${t("admin.stats.activeCustomers")}: ${formatNumber(data.qcaas.active_customers)}`} />
          <Tile label={t("admin.stats.jobs")} value={formatNumber(data.qcaas.jobs.total)} sub={`${t("admin.stats.byKind")}: ${split(data.qcaas.jobs.by_kind, (k) => kindLabel(t, k))}`} />
          <Tile label={t("admin.stats.revenue")} value={formatUsd(data.qcaas.revenue_usd)} />
          <Tile label={t("admin.stats.qpuSeconds")} value={formatNumber(data.qcaas.estimated_qpu_seconds, 1)} />
          <Tile label={t("admin.stats.backends")} value={formatNumber(Object.values(data.qcaas.selected_backends).reduce((a, b) => a + b, 0))} sub={split(data.qcaas.selected_backends, (k) => k)} />
        </div>
      )}
    </section>
  );
}

function UsersSection({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n();
  const fetcher = useCallback((signal: AbortSignal) => asResult(accounts.admin.users(signal)), []);
  const { data, error, loading, refetch } = useApiQuery<AdminUserList>("admin-users", fetcher);
  const [overrides, setOverrides] = useState<Record<string, User>>({});
  const users = (data?.items ?? []).map((u) => overrides[u.id] ?? u);
  return (
    <Card title={`${t("admin.users")}${data ? ` (${data.total})` : ""}`} action={loading ? <Spinner /> : undefined}>
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {data && <UsersTable users={users} currentUserId={currentUserId} onUpdated={(u) => setOverrides((o) => ({ ...o, [u.id]: u }))} />}
    </Card>
  );
}

function JobsSection() {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const fetcher = useCallback((signal: AbortSignal) => asResult(accounts.admin.jobs({ limit: PAGE, offset, kind: kind || undefined }, signal)), [kind, offset]);
  const { data, error, loading, refetch } = useApiQuery<AdminJobList>(`admin-jobs|${kind}|${offset}`, fetcher);
  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <Card
      title={`${t("admin.jobs")}${data ? ` (${total})` : ""}`}
      action={
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
          {loading && <Spinner />}
        </label>
      }
    >
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {data && data.items.length === 0 && <p className="text-sm text-slate-500">{t("admin.empty")}</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("jobs.jobId")}</th>
                <th className={th}>{t("admin.jobs.account")}</th>
                <th className={th}>{t("admin.jobs.customer")}</th>
                <th className={th}>{t("jobs.kind")}</th>
                <th className={th}>{t("jobs.status")}</th>
                <th className={th}>{t("jobs.target")}</th>
                <th className={th}>{t("jobs.selected")}</th>
                <th className={th}>{t("jobs.total")}</th>
                <th className={th}>{t("admin.jobs.qpuSeconds")}</th>
                <th className={th}>{t("jobs.created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data.items.map((j) => (
                <tr key={j.job_id}>
                  <td className={`${td} font-mono text-xs`}>{j.job_id}</td>
                  <td className={td}>{j.account_email ?? "—"}</td>
                  <td className={`${td} font-mono text-xs`}>{j.customer_id}</td>
                  <td className={td}>{kindLabel(t, j.kind)}</td>
                  <td className={td}>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className={td}>{j.target_backend ?? "—"}</td>
                  <td className={td}>{j.selected_backend ?? "—"}</td>
                  <td className={td}>{formatUsd(j.total_usd)}</td>
                  <td className={td}>{formatNumber(j.estimated_qpu_seconds, 2)}</td>
                  <td className={td}>{formatDate(j.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>{t("jobs.pageOf", { page, pages })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ← {t("common.previous")}
            </Button>
            <Button variant="secondary" size="sm" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>
              {t("common.next")} →
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function AuditSection() {
  const { t, locale } = useI18n();
  const fetcher = useCallback((signal: AbortSignal) => asResult(accounts.admin.audit(signal)), []);
  const { data, error, loading, refetch } = useApiQuery<AuditList>("admin-audit", fetcher);
  return (
    <Card title={t("admin.audit")} action={loading ? <Spinner /> : undefined}>
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {data && data.items.length === 0 && <p className="text-sm text-slate-500">{t("admin.empty")}</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("admin.audit.at")}</th>
                <th className={th}>{t("admin.audit.actor")}</th>
                <th className={th}>{t("admin.audit.action")}</th>
                <th className={th}>{t("admin.audit.target")}</th>
                <th className={th}>{t("admin.audit.detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{formatDate(a.at, locale)}</td>
                  <td className={`${td} font-mono text-xs`}>{a.actor_id ?? "—"}</td>
                  <td className={td}>{a.action}</td>
                  <td className={`${td} font-mono text-xs`}>{a.target_id ?? "—"}</td>
                  <td className="px-3 py-2 text-sm text-slate-600">{a.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AdminContent() {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.title")} subtitle={t("admin.subtitle")} />
      <StatsSection />
      <UsersSection currentUserId={user.id} />
      <JobsSection />
      <AuditSection />
    </div>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth role="admin">
      <AdminContent />
    </RequireAuth>
  );
}
