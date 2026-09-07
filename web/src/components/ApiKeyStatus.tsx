"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { api } from "@/lib/api/client";
import { useCredentials } from "@/lib/useCredentials";
import { cn } from "@/lib/utils";

type State = "noKey" | "noKeySession" | "checking" | "connected" | "failed";

export function ApiKeyStatus() {
  const t = useT();
  const { credential, ready, mode, signedInWithoutKey } = useCredentials();
  const [probe, setProbe] = useState<{ key: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!ready || !credential) return;
    const ac = new AbortController();
    api
      .jobs({ limit: 1 }, ac.signal)
      .then(() => !ac.signal.aborted && setProbe({ key: credential, ok: true }))
      .catch(() => !ac.signal.aborted && setProbe({ key: credential, ok: false }));
    return () => ac.abort();
  }, [credential, ready]);

  const state: State =
    !ready || !credential
      ? signedInWithoutKey
        ? "noKeySession"
        : "noKey"
      : probe?.key !== credential
        ? "checking"
        : probe.ok
          ? "connected"
          : "failed";

  const dot: Record<State, string> = {
    noKey: "bg-slate-400",
    noKeySession: "bg-amber-400",
    checking: "bg-amber-400 animate-pulse",
    connected: "bg-emerald-500",
    failed: "bg-red-500",
  };

  const href = mode === "session" || signedInWithoutKey ? "/dashboard" : "/settings";
  const label = state === "connected" && mode === "session" ? t("keyStatus.session") : t(`keyStatus.${state}`);

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      title={href === "/dashboard" ? t("nav.dashboard") : t("nav.settings")}
    >
      <span className={cn("h-2 w-2 rounded-full", dot[state])} aria-hidden />
      {label}
    </Link>
  );
}
