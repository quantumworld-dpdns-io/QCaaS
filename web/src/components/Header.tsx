"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { getBaseUrl } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/utils";
import { ApiKeyStatus } from "./ApiKeyStatus";
import { LocaleToggle } from "./LocaleToggle";

const NAV: Array<{ href: string; key: MessageKey }> = [
  { href: "/quote", key: "nav.quote" },
  { href: "/optimize", key: "nav.optimize" },
  { href: "/interpret", key: "nav.interpret" },
  { href: "/jobs", key: "nav.jobs" },
];

export function Header() {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { user, isAdmin, loading, logout } = useAuth();
  const docsUrl = `${getBaseUrl()}/docs`;

  const nav: Array<{ href: string; key: MessageKey }> = [
    ...NAV,
    ...(user ? [{ href: "/dashboard", key: "nav.dashboard" as MessageKey }] : []),
    ...(isAdmin ? [{ href: "/admin", key: "nav.admin" as MessageKey }] : []),
    { href: "/settings", key: "nav.settings" },
  ];

  const linkClass = (href: string) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition",
      pathname === href || pathname.startsWith(`${href}/`)
        ? "bg-slate-900 text-white"
        : "text-slate-700 hover:bg-slate-100",
    );

  const onLogout = () => {
    logout();
    setOpen(false);
    router.push("/");
  };

  const authControls = (mobile: boolean) =>
    loading ? null : user ? (
      <div className={cn("flex items-center gap-2", mobile ? "border-t border-slate-200 pt-2" : "hidden md:flex")}>
        <span className="max-w-[12rem] truncate text-xs text-slate-600" title={t("nav.signedInAs", { email: user.email })}>
          {user.email}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {t("nav.logout")}
        </button>
      </div>
    ) : (
      <div className={cn("flex items-center gap-1", mobile ? "border-t border-slate-200 pt-2" : "hidden md:flex")}>
        <Link href="/login" className={linkClass("/login")} onClick={() => setOpen(false)}>
          {t("nav.login")}
        </Link>
        <Link
          href="/register"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          onClick={() => setOpen(false)}
        >
          {t("nav.register")}
        </Link>
      </div>
    );

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
            <span className="inline-block h-6 w-6 rounded-md bg-indigo-600" aria-hidden />
            {t("app.name")}
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={linkClass(n.href)}>
                {t(n.key)}
              </Link>
            ))}
            <a href={docsUrl} target="_blank" rel="noreferrer" className={linkClass("/docs")}>
              {t("nav.docs")} ↗
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ApiKeyStatus />
          {authControls(false)}
          <LocaleToggle />
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm md:hidden"
            aria-label={t("nav.menu")}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            ☰
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-slate-200 px-4 py-2 md:hidden" aria-label="Mobile">
          <div className="flex flex-col gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={linkClass(n.href)} onClick={() => setOpen(false)}>
                {t(n.key)}
              </Link>
            ))}
            <a href={docsUrl} target="_blank" rel="noreferrer" className={linkClass("/docs")}>
              {t("nav.docs")} ↗
            </a>
            {authControls(true)}
          </div>
        </nav>
      )}
    </header>
  );
}
