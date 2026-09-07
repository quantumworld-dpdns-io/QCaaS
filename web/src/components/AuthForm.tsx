"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/i18n/context";
import { accounts } from "@/lib/auth/client";
import { accountsErrorMessage } from "@/lib/auth/messages";
import { getAccountsUrl } from "@/lib/auth/store";
import type { User } from "@/lib/auth/types";
import { useAuth } from "@/lib/auth/useAuth";

const MIN_PASSWORD = 8;

/** Google/GitHub sign-in buttons; only rendered for providers the server has configured. */
function SSOButtons() {
  const t = useT();
  const [providers, setProviders] = useState<("google" | "github")[]>([]);
  useEffect(() => {
    const ac = new AbortController();
    accounts
      .providers(ac.signal)
      .then((r) => setProviders(r.providers ?? []))
      .catch(() => setProviders([]));
    return () => ac.abort();
  }, []);
  if (providers.length === 0) return null;
  const next = typeof window !== "undefined" ? window.location.search : "";
  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <a
          key={p}
          href={`${getAccountsUrl()}/auth/oauth/${p}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          data-provider={p}
          onClick={() => {
            // Preserve ?next= across the redirect so the callback lands on the right page.
            if (next) sessionStorage.setItem("qcaas.postLogin", new URLSearchParams(next).get("next") ?? "");
          }}
        >
          {t(p === "google" ? "auth.sso.google" : "auth.sso.github")}
        </a>
      ))}
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        {t("auth.sso.or")}
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    </div>
  );
}

/** Where to send a user after login/register: `?next=` if it is a local path, else by role. */
export function postAuthPath(user: User, search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return user.role === "admin" ? "/admin" : "/dashboard";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const t = useT();
  const router = useRouter();
  const { user, loading, login, register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Surface an SSO failure passed back as ?sso_error= from the accounts callback. Read once
  // on the client during initial state so it shows without an effect-driven setState.
  const [error, setError] = useState<string | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sso_error") ? t("auth.sso.error") : null,
  );
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && !name.trim()) return setError(t("auth.err.nameRequired"));
    if (password.length < MIN_PASSWORD) return setError(t("auth.err.passwordShort"));
    setBusy(true);
    try {
      const u = mode === "login" ? await login(email.trim(), password) : await register(name.trim(), email.trim(), password);
      router.replace(postAuthPath(u, typeof window !== "undefined" ? window.location.search : ""));
    } catch (err) {
      setError(accountsErrorMessage(t, err));
      setBusy(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title={t(isLogin ? "auth.login.title" : "auth.register.title")} subtitle={t(isLogin ? "auth.login.subtitle" : "auth.register.subtitle")} />
      {!loading && user && (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          {t("welcome.signedIn", { email: user.email })}{" "}
          <Link href={user.role === "admin" ? "/admin" : "/dashboard"} className="font-medium underline">
            {t(user.role === "admin" ? "welcome.goAdmin" : "welcome.goDashboard")}
          </Link>
        </p>
      )}
      <Card>
        <div className="mb-4">
          <SSOButtons />
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {!isLogin && (
            <Field label={t("auth.name")} htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
          )}
          <Field label={t("auth.email")} htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label={t("auth.password")} htmlFor="password" hint={isLogin ? undefined : t("auth.passwordHint")}>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={MIN_PASSWORD}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner className="border-white/40 border-t-white" />}
            {t(isLogin ? "auth.login.submit" : "auth.register.submit")}
          </Button>
          {!isLogin && <p className="text-xs text-slate-500">{t("auth.register.firstAdmin")}</p>}
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600">
        {t(isLogin ? "auth.login.noAccount" : "auth.register.haveAccount")}{" "}
        <Link href={isLogin ? "/register" : "/login"} className="font-medium text-indigo-700 hover:underline">
          {t(isLogin ? "auth.login.registerLink" : "auth.register.loginLink")}
        </Link>
      </p>
    </div>
  );
}
