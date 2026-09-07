"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ErrorBanner } from "@/components/ErrorBanner";
import { RequireAuth } from "@/components/RequireAuth";
import { Button, Card, Field, Input, KeyValue, PageHeader, Select, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { api } from "@/lib/api/client";
import type { JobList } from "@/lib/api/types";
import { accounts } from "@/lib/auth/client";
import { accountsErrorMessage } from "@/lib/auth/messages";
import type { ApiKeyResponse, Plan, Session } from "@/lib/auth/types";
import { useAuth } from "@/lib/auth/useAuth";
import { PLANS, formatUsd } from "@/lib/pricing";
import { useApiQuery } from "@/lib/useApiQuery";
import { cn, formatDate } from "@/lib/utils";

const RECENT = 5;
const KINDS: readonly string[] = ["optimize", "quote", "interpret"];

function RoleBadge({ role }: { role: "customer" | "admin" }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", role === "admin" ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-slate-100 text-slate-700 ring-slate-200")}>
      {t(`role.${role}`)}
    </span>
  );
}

function ProfileCard({ session }: { session: Session }) {
  const { t, locale } = useI18n();
  const { user } = session;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accounts.updateMe({ name: name.trim() });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(accountsErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={t("dashboard.profile")}
      action={
        !editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t("dashboard.edit")}
          </Button>
        )
      }
    >
      {editing ? (
        <form onSubmit={onSave} className="space-y-3">
          <Field label={t("dashboard.name")} htmlFor="profile-name">
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {t("dashboard.save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setName(user.name); }} disabled={busy}>
              {t("dashboard.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <KeyValue
          items={[
            { label: t("dashboard.name"), value: <>{user.name || "—"} {saved && <span className="ml-2 text-xs text-emerald-700">{t("dashboard.saved")}</span>}</> },
            { label: t("dashboard.email"), value: user.email },
            { label: t("dashboard.role"), value: <RoleBadge role={user.role} /> },
            { label: t("dashboard.memberSince"), value: formatDate(user.created_at, locale) },
          ]}
        />
      )}
    </Card>
  );
}

function ApiKeyCard({ session, refresh }: { session: Session; refresh: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const { user, has_api_key } = session;
  const [plan, setPlan] = useState<Plan>("payg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ key: ApiKeyResponse; fresh: boolean; existed: boolean } | null>(null);

  const run = async (fn: () => Promise<ApiKeyResponse>, fresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setShown({ key: r, fresh: fresh && r.created, existed: fresh && !r.created });
      if (fresh) await refresh();
    } catch (err) {
      setError(accountsErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const keyPanel = shown && (
    <div className={cn("space-y-2 rounded-lg border p-3", shown.fresh ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}>
      <p className={cn("text-sm font-medium", shown.fresh ? "text-amber-800" : "text-slate-700")}>
        {shown.fresh ? t("dashboard.keyOnce") : shown.existed ? t("dashboard.keyExisted") : t("dashboard.revealWarning")}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs" data-testid="api-key-value">
          {shown.key.api_key}
        </code>
        <CopyButton text={shown.key.api_key} />
        <Button variant="ghost" size="sm" onClick={() => setShown(null)}>
          {t("dashboard.hideKey")}
        </Button>
      </div>
    </div>
  );

  return (
    <Card title={t("dashboard.apiKey")}>
      <div className="space-y-4">
        {!has_api_key ? (
          <>
            <p className="text-sm text-slate-600">{t("dashboard.noKey")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("dashboard.plan")} htmlFor="plan" className="w-44">
                <Select id="plan" value={plan} onChange={(e) => setPlan(e.target.value as Plan)} disabled={busy}>
                  {PLANS.map((p) => (
                    <option key={p} value={p}>
                      {t(`plan.${p}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button onClick={() => run(() => accounts.provisionApiKey({ plan }), true)} disabled={busy}>
                {busy && <Spinner className="border-white/40 border-t-white" />}
                {busy ? t("dashboard.provisioning") : t("dashboard.provision")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <KeyValue
              items={[
                { label: t("dashboard.keyPrefix"), value: <code className="font-mono text-xs">{user.api_key_prefix ?? shown?.key.key_prefix ?? "—"}…</code> },
                { label: t("dashboard.keyCreated"), value: formatDate(user.api_key_created_at, locale) },
                { label: t("dashboard.customerId"), value: <code className="font-mono text-xs">{user.qcaas_customer_id ?? shown?.key.customer_id ?? "—"}</code> },
              ]}
            />
            {!shown && (
              <Button variant="secondary" size="sm" onClick={() => run(() => accounts.revealApiKey(), false)} disabled={busy}>
                {busy ? <Spinner /> : null}
                {t("dashboard.reveal")}
              </Button>
            )}
          </>
        )}
        {keyPanel}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <p className="text-xs text-slate-500">{t("dashboard.proxyNote")}</p>
      </div>
    </Card>
  );
}

function UsageCard({ session }: { session: Session }) {
  const { t, locale } = useI18n();
  const fetcher = useCallback((signal: AbortSignal) => api.jobs({ limit: RECENT }, signal), []);
  const { data, error, loading, refetch } = useApiQuery<JobList>(session.has_api_key ? `dash|${session.user.id}` : null, fetcher);
  const spend = data?.items.reduce((sum, j) => sum + (j.total_usd ?? 0), 0) ?? 0;
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-sm text-slate-800 whitespace-nowrap";

  return (
    <Card
      title={t("dashboard.usage")}
      action={
        <Link href="/jobs" className="text-sm font-medium text-indigo-700 hover:underline">
          {t("dashboard.allJobs")}
        </Link>
      }
    >
      {!session.has_api_key && <p className="text-sm text-slate-500">{t("dashboard.provisionFirst")}</p>}
      {loading && <Spinner />}
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {data && data.items.length === 0 && <p className="text-sm text-slate-500">{t("dashboard.noJobs")}</p>}
      {data && data.items.length > 0 && (
        <>
          <div className="mb-3 flex items-baseline justify-between text-sm">
            <span className="text-slate-500">{t("dashboard.lastJobs", { n: data.items.length })}</span>
            <span>
              <span className="text-slate-500">{t("dashboard.totalSpend")}: </span>
              <span className="font-semibold text-slate-900" data-testid="dashboard-spend">{formatUsd(spend)}</span>
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>{t("jobs.kind")}</th>
                  <th className={th}>{t("jobs.selected")}</th>
                  <th className={th}>{t("jobs.total")}</th>
                  <th className={th}>{t("jobs.created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((j) => (
                  <tr key={j.job_id}>
                    <td className={td}>
                      <Link href={`/jobs/${encodeURIComponent(j.job_id)}`} className="text-indigo-700 hover:underline">
                        {KINDS.includes(j.kind) ? t(`jobs.kind.${j.kind}` as MessageKey) : j.kind}
                      </Link>
                    </td>
                    <td className={td}>{j.selected_backend ?? j.target_backend ?? "—"}</td>
                    <td className={td}>{formatUsd(j.total_usd)}</td>
                    <td className={td}>{formatDate(j.created_at, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function DashboardContent() {
  const { t } = useI18n();
  const { session, refresh } = useAuth();
  if (!session) return null;
  const actions: Array<{ href: string; key: MessageKey }> = [
    { href: "/quote", key: "nav.quote" },
    { href: "/optimize", key: "nav.optimize" },
    { href: "/interpret", key: "nav.interpret" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard session={session} />
        <ApiKeyCard session={session} refresh={refresh} />
      </div>
      <UsageCard session={session} />
      <Card title={t("dashboard.quick")}>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              {t(a.key)} →
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
