"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postAuthPath } from "@/components/AuthForm";
import { PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/i18n/context";
import { accounts } from "@/lib/auth/client";

/**
 * SSO landing page. The accounts service redirects here with the JWT in the URL fragment
 * (`#token=...&expires_at=...`) so it never reaches a server log. We exchange it for a
 * session via GET /me and forward to the dashboard/admin (or a saved `next` path).
 */
export default function OAuthCallbackPage() {
  const t = useT();
  const router = useRouter();
  const ran = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = frag.get("token");
    const expiresAt = frag.get("expires_at");
    // Clear the fragment so the token isn't left in the address bar / history.
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      router.replace("/login?sso_error=missing_token");
      return;
    }
    const expiresIso = expiresAt ? new Date(Number(expiresAt) * 1000).toISOString() : new Date(Date.now() + 86_400_000).toISOString();

    accounts
      .completeOAuth(token, expiresIso)
      .then((user) => {
        const saved = sessionStorage.getItem("qcaas.postLogin");
        sessionStorage.removeItem("qcaas.postLogin");
        router.replace(saved ? postAuthPath(user, `?next=${encodeURIComponent(saved)}`) : postAuthPath(user, ""));
      })
      .catch(() => {
        setFailed(true);
        setTimeout(() => router.replace("/login?sso_error=exchange_failed"), 1200);
      });
  }, [router]);

  return (
    <div className="mx-auto max-w-md space-y-6 py-16 text-center">
      <PageHeader title={t("auth.sso.completing")} />
      {!failed && <Spinner className="mx-auto border-slate-300 border-t-indigo-600" />}
      {failed && <p className="text-sm text-red-700">{t("auth.sso.error")}</p>}
    </div>
  );
}
