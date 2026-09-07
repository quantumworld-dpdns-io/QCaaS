"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { useT } from "@/i18n/context";
import { useAuth } from "@/lib/auth/useAuth";
import type { Role } from "@/lib/auth/types";

/**
 * Client-side route guard. Not logged in -> replace to /login?next=<path>.
 * `role="admin"` additionally renders a friendly 403 page for customers.
 */
export function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const mustRedirect = !loading && !user;
  useEffect(() => {
    if (mustRedirect) router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
  }, [mustRedirect, pathname, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-500" data-testid="auth-guard-pending">
        <Spinner /> {loading ? t("common.loading") : t("guard.redirecting")}
      </div>
    );
  }

  if (role && user.role !== role) {
    return (
      <div className="mx-auto max-w-md py-12 text-center" role="alert" data-testid="auth-guard-forbidden">
        <p className="text-5xl font-bold text-slate-300">403</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{t("guard.forbidden.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("guard.forbidden.desc")}</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          {t("guard.forbidden.back")}
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
