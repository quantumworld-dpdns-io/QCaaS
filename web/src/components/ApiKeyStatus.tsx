"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { api } from "@/lib/api/client";
import { useCredentials } from "@/lib/useCredentials";
import { cn } from "@/lib/utils";

type State = "noKey" | "checking" | "connected" | "failed";

export function ApiKeyStatus() {
  const t = useT();
  const { apiKey, ready } = useCredentials();
  const [probe, setProbe] = useState<{ key: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!ready || !apiKey) return;
    const ac = new AbortController();
    api
      .jobs({ limit: 1 }, ac.signal)
      .then(() => !ac.signal.aborted && setProbe({ key: apiKey, ok: true }))
      .catch(() => !ac.signal.aborted && setProbe({ key: apiKey, ok: false }));
    return () => ac.abort();
  }, [apiKey, ready]);

  const state: State = !ready || !apiKey ? "noKey" : probe?.key !== apiKey ? "checking" : probe.ok ? "connected" : "failed";

  const dot: Record<State, string> = {
    noKey: "bg-slate-400",
    checking: "bg-amber-400 animate-pulse",
    connected: "bg-emerald-500",
    failed: "bg-red-500",
  };

  return (
    <Link
      href="/settings"
      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      title={t("nav.settings")}
    >
      <span className={cn("h-2 w-2 rounded-full", dot[state])} aria-hidden />
      {t(`keyStatus.${state}`)}
    </Link>
  );
}
