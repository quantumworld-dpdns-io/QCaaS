"use client";

import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/dictionaries";
import { ApiError } from "@/lib/api/client";

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  if (!error) return null;

  let message = error instanceof Error ? error.message : String(error);
  let code: string | null = null;
  let detail: string | null = null;
  let status: number | null = null;
  let hintKey: MessageKey | null = null;

  if (error instanceof ApiError) {
    code = error.code;
    detail = error.detail;
    status = error.status;
    if (error.code === "network_error") hintKey = "error.hint.network";
    else if (error.code === "no_api_key") hintKey = "error.hint.no_api_key";
    else if ([401, 404, 422, 429, 503].includes(error.status)) hintKey = `error.hint.${error.status}` as MessageKey;
    if (!message) message = t("error.title");
  }

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {t("error.title")}
            {status ? <span className="ml-2 font-normal text-red-600">({t("error.status")} {status})</span> : null}
          </p>
          <p className="mt-1 break-words">{message}</p>
          {detail && <p className="mt-1 break-words text-red-700">{detail}</p>}
          {code && (
            <p className="mt-2 text-xs">
              {t("error.code")}: <code className="rounded bg-red-100 px-1 py-0.5 font-mono">{code}</code>
            </p>
          )}
          {hintKey && <p className="mt-2 text-xs text-red-700">{t(hintKey)}</p>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            {t("common.retry")}
          </button>
        )}
      </div>
    </div>
  );
}
