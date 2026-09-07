"use client";

import { useState, type FormEvent } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, Field, Input, KeyValue, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/i18n/context";
import { api, clearCredentials, getBaseUrl, setCredentials, type RateLimit } from "@/lib/api/client";
import { useCredentials } from "@/lib/useCredentials";

type Check = { state: "idle" | "running" | "ok" | "failed"; error?: unknown; rateLimit?: RateLimit };

function SettingsForm({ initialApiKey, initialPayloadKey }: { initialApiKey: string; initialPayloadKey: string }) {
  const t = useT();
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [payloadKey, setPayloadKey] = useState(initialPayloadKey);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<Check>({ state: "idle" });
  const [jobs, setJobs] = useState<Check>({ state: "idle" });
  const [showKey, setShowKey] = useState(false);

  const runTests = async () => {
    setHealth({ state: "running" });
    setJobs({ state: "running" });
    try {
      await api.healthz();
      setHealth({ state: "ok" });
    } catch (e) {
      setHealth({ state: "failed", error: e });
    }
    try {
      const r = await api.jobs({ limit: 1 });
      setJobs({ state: "ok", rateLimit: r.rateLimit });
    } catch (e) {
      setJobs({ state: "failed", error: e });
    }
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setCredentials(apiKey, payloadKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await runTests();
  };

  const onClear = () => {
    clearCredentials();
    setApiKey("");
    setPayloadKey("");
    setHealth({ state: "idle" });
    setJobs({ state: "idle" });
  };

  const badge = (c: Check) =>
    c.state === "running" ? (
      <Spinner />
    ) : c.state === "idle" ? (
      <span className="text-sm text-slate-500">{t("settings.notRun")}</span>
    ) : (
      <StatusBadge status={c.state === "ok" ? "ok" : "failed"} />
    );

  return (
    <>
      <form onSubmit={onSave}>
        <Card>
          <div className="space-y-4">
            <KeyValue items={[{ label: t("settings.baseUrl"), value: <code className="font-mono text-xs">{getBaseUrl()}</code> }]} />
            <Field label={t("settings.apiKey")} hint={t("settings.apiKeyHint")} htmlFor="apiKey">
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <Button variant="secondary" size="sm" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? t("common.hide") : t("common.show")}
                </Button>
              </div>
            </Field>
            <Field label={`${t("settings.payloadKey")} (${t("common.optional")})`} hint={t("settings.payloadKeyHint")} htmlFor="payloadKey">
              <Input
                id="payloadKey"
                type="password"
                value={payloadKey}
                onChange={(e) => setPayloadKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit">{t("settings.save")}</Button>
              <Button variant="danger" onClick={onClear}>
                {t("settings.clear")}
              </Button>
              {saved && <span className="text-sm text-emerald-700">{t("settings.saved")}</span>}
            </div>
          </div>
        </Card>
      </form>

      <Card title={t("settings.testTitle")}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <code className="font-mono text-sm">{t("settings.health")}</code>
            {badge(health)}
          </div>
          {health.state === "failed" && <ErrorBanner error={health.error} />}
          <div className="flex items-center justify-between">
            <code className="font-mono text-sm">{t("settings.jobsTest")}</code>
            {badge(jobs)}
          </div>
          {jobs.state === "failed" && <ErrorBanner error={jobs.error} />}
          {jobs.state === "ok" && jobs.rateLimit && jobs.rateLimit.limit !== null && (
            <p className="text-xs text-slate-500">
              {t("common.rateLimit", { remaining: jobs.rateLimit.remaining ?? "?", limit: jobs.rateLimit.limit })}
            </p>
          )}
        </div>
      </Card>
    </>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { apiKey, payloadKey, ready } = useCredentials();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      {ready ? (
        <SettingsForm initialApiKey={apiKey ?? ""} initialPayloadKey={payloadKey ?? ""} />
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> {t("common.loading")}
        </div>
      )}
    </div>
  );
}
