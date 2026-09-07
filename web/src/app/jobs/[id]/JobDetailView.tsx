"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BackendResultsTable, type BackendRow } from "@/components/BackendResultsTable";
import { CodeBlock } from "@/components/CodeBlock";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, EmptyState, KeyValue, PageHeader, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { api } from "@/lib/api/client";
import type { JobDetail } from "@/lib/api/types";
import { formatUsd } from "@/lib/pricing";
import { useCredentials } from "@/lib/useCredentials";
import { formatDate, prettyJson } from "@/lib/utils";

const KINDS = ["optimize", "quote", "interpret"];

function isEncrypted(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as Record<string, unknown>).encrypted === true;
}

function StoredPayload({ title, value, filename }: { title: string; value: Record<string, unknown> | null | undefined; filename: string }) {
  const { t } = useI18n();
  return (
    <Card title={title}>
      {!value ? (
        <p className="text-sm text-slate-500">{t("jobs.noPayload")}</p>
      ) : isEncrypted(value) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t("jobs.encryptedHint")}{" "}
          <Link href="/settings" className="font-medium underline">
            {t("nav.settings")}
          </Link>
        </div>
      ) : (
        <CodeBlock code={prettyJson(value)} filename={filename} mime="application/json" collapsible defaultOpen />
      )}
    </Card>
  );
}

export function JobDetailView({ jobId }: { jobId: string }) {
  const { t, locale } = useI18n();
  const { apiKey, payloadKey, ready } = useCredentials();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.job(jobId);
      setJob(r.data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!ready || !apiKey) return;
    void load();
  }, [load, ready, apiKey, payloadKey]);

  const backendRows: BackendRow[] = (job?.backend_results ?? []) as BackendRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("jobs.detailTitle")}
        subtitle={jobId}
        action={
          <Link href="/jobs" className="text-sm font-medium text-indigo-700 hover:underline">
            ← {t("jobs.back")}
          </Link>
        }
      />

      {ready && !apiKey && (
        <EmptyState>
          <Link href="/settings" className="text-indigo-700 underline">
            {t("jobs.needKey")}
          </Link>
        </EmptyState>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> {t("common.loading")}
        </div>
      )}
      {error ? <ErrorBanner error={error} onRetry={load} /> : null}

      {job && (
        <>
          <Card title={t("jobs.summary")} action={<StatusBadge status={job.status} />}>
            <KeyValue
              items={[
                { label: t("jobs.jobId"), value: <code className="font-mono text-xs">{job.job_id}</code> },
                { label: t("jobs.kind"), value: KINDS.includes(job.kind) ? t(`jobs.kind.${job.kind}` as MessageKey) : job.kind },
                { label: t("jobs.target"), value: job.target_backend ?? "—" },
                { label: t("jobs.selected"), value: job.selected_backend ?? "—" },
                { label: t("jobs.total"), value: formatUsd(job.total_usd) },
                { label: t("jobs.created"), value: formatDate(job.created_at, locale) },
                { label: t("jobs.expires"), value: formatDate(job.expires_at, locale) },
              ]}
            />
          </Card>

          <Card title={t("jobs.backendResults")}>
            <BackendResultsTable results={backendRows} selected={job.selected_backend} />
          </Card>

          <StoredPayload title={t("jobs.storedResponse")} value={job.response} filename={`${job.job_id}-response.json`} />
          <StoredPayload title={t("jobs.storedRequest")} value={job.request} filename={`${job.job_id}-request.json`} />
        </>
      )}
    </div>
  );
}
