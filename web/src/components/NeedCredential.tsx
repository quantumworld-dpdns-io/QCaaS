"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { useT } from "@/i18n/context";
import { useCredentials } from "@/lib/useCredentials";

/** Empty state shown when /v2/* calls cannot be authenticated: points to the dashboard (logged in) or Settings. */
export function NeedCredential() {
  const t = useT();
  const { signedInWithoutKey } = useCredentials();
  return (
    <EmptyState>
      {signedInWithoutKey ? (
        <Link href="/dashboard" className="text-indigo-700 underline">
          {t("jobs.needKeyDashboard")}
        </Link>
      ) : (
        <Link href="/settings" className="text-indigo-700 underline">
          {t("jobs.needKey")}
        </Link>
      )}
    </EmptyState>
  );
}
