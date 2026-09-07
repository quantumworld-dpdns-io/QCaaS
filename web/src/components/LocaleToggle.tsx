"use client";

import { useI18n } from "@/i18n/context";
import { LOCALES } from "@/i18n/config";
import type { MessageKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/utils";

export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("locale.switch")} className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cn(
            "rounded-md px-2 py-1 font-medium transition",
            locale === l ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {t(`locale.${l}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}
