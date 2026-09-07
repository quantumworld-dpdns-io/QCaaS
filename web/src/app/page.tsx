"use client";

import Link from "next/link";
import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { getBaseUrl } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/useAuth";
import { CLASSIQ_PLATFORM_FEE_USD, PLANS, QPU_USD_PER_MIN, SERVICE_FEE_FROM_USD, estimate, formatUsd } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const EXAMPLE_RUNTIME_SEC = 5; // "Small experiment (5q, 50 gates)" from docs/pricing.csv
const TIERS = ["visitor", "customer", "admin"] as const;

const primaryBtn = "rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700";
const secondaryBtn = "rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50";

export default function WelcomePage() {
  const t = useT();
  const { user, loading } = useAuth();
  const homePath = user?.role === "admin" ? "/admin" : "/dashboard";
  const docsUrl = `${getBaseUrl()}/docs`;

  return (
    <div className="space-y-16">
      {!loading && user && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900" role="status">
          <span>{t("welcome.signedIn", { email: user.email })}</span>
          <Link href={homePath} className="font-semibold underline">
            {t(user.role === "admin" ? "welcome.goAdmin" : "welcome.goDashboard")} →
          </Link>
        </div>
      )}

      <section className="pt-2 text-center">
        <p className="mb-3 inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{t("app.name")}</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{t("landing.hero.title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600">{t("landing.hero.subtitle")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {user ? (
            <>
              <Link href={homePath} className={primaryBtn}>
                {t(user.role === "admin" ? "welcome.goAdmin" : "welcome.goDashboard")}
              </Link>
              <Link href="/quote" className={secondaryBtn}>
                {t("landing.hero.ctaQuote")}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={primaryBtn}>
                {t("welcome.hero.ctaLogin")}
              </Link>
              <Link href="/register" className={secondaryBtn}>
                {t("welcome.hero.ctaRegister")}
              </Link>
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-6 text-center text-2xl font-bold text-slate-900">{t("welcome.tiers.title")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div key={tier} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">{t(`welcome.tiers.${tier}.title` as MessageKey)}</h3>
              <p className="mt-2 text-sm text-slate-600">{t(`welcome.tiers.${tier}.desc` as MessageKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-6 text-center text-2xl font-bold text-slate-900">{t("landing.modules.title")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {([1, 2, 3] as const).map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">{i}</div>
              <h3 className="text-lg font-semibold text-slate-900">{t(`landing.modules.${i}.title` as MessageKey)}</h3>
              <p className="mt-2 text-sm text-slate-600">{t(`landing.modules.${i}.desc` as MessageKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-6 text-center text-2xl font-bold text-slate-900">{t("landing.how.title")}</h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {([1, 2, 3, 4] as const).map((i) => (
            <li key={i} className="relative rounded-xl border border-slate-200 bg-white p-5">
              <span className="text-xs font-semibold text-indigo-600">0{i}</span>
              <h3 className="mt-1 font-semibold text-slate-900">{t(`landing.how.${i}.title` as MessageKey)}</h3>
              <p className="mt-1 text-sm text-slate-600">{t(`landing.how.${i}.desc` as MessageKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing">
        <h2 className="mb-2 text-center text-2xl font-bold text-slate-900">{t("landing.pricing.title")}</h2>
        <p className="mx-auto mb-6 max-w-2xl text-center text-sm text-slate-600">{t("landing.pricing.subtitle")}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan, idx) => {
            const ex = estimate(EXAMPLE_RUNTIME_SEC, plan);
            const highlight = idx === 1;
            return (
              <div key={plan} className={cn("flex flex-col rounded-xl border bg-white p-6 shadow-sm", highlight ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200")}>
                <h3 className="text-lg font-semibold text-slate-900">{t(`plan.${plan}` as MessageKey)}</h3>
                <p className="mt-1 text-sm text-slate-600">{t(`landing.pricing.${plan}.desc` as MessageKey)}</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold text-slate-900">{formatUsd(QPU_USD_PER_MIN[plan], 0)}</span>
                  <span className="ml-1 text-sm text-slate-500">{t("landing.pricing.perMin")}</span>
                </div>
                <dl className="mt-4 space-y-1 text-sm text-slate-600">
                  <div className="flex justify-between">
                    <dt>{t("landing.pricing.serviceFee")}</dt>
                    <dd>{t("landing.pricing.serviceFeeFrom", { amount: formatUsd(SERVICE_FEE_FROM_USD) })}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{t("landing.pricing.classiqFee")}</dt>
                    <dd className="text-right">{t("landing.pricing.classiqFeeNote", { amount: formatUsd(CLASSIQ_PLATFORM_FEE_USD) })}</dd>
                  </div>
                </dl>
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="text-xs text-slate-500">{t("landing.pricing.example", { label: "5q · 50 gates · 1024 shots" })}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-slate-600">{t("landing.pricing.exampleNote", { sec: EXAMPLE_RUNTIME_SEC })}</span>
                    <span className="font-semibold text-slate-900">{formatUsd(ex.totalUsd)}</span>
                  </div>
                </div>
                <Link href={user ? "/quote" : "/register"} className={cn("mt-6 rounded-lg px-4 py-2 text-center text-sm font-semibold", highlight ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-slate-300 text-slate-800 hover:bg-slate-50")}>
                  {t("landing.pricing.cta")}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("welcome.machine.title")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("welcome.machine.desc")}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/settings" className={secondaryBtn}>
              {t("welcome.machine.settings")}
            </Link>
            <a href={docsUrl} target="_blank" rel="noreferrer" className={secondaryBtn}>
              {t("welcome.machine.docs")} ↗
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
