import type { MessageKey } from "@/i18n/dictionaries";
import type { TFunction } from "@/i18n/context";
import { AccountsError } from "./client";

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "invalid_credentials",
  "account_disabled",
  "email_taken",
  "invalid_email",
  "weak_password",
  "network_error",
  "unauthorized",
  "forbidden",
  "no_api_key",
  "self_lockout",
]);

/** Human-readable, localised message for an accounts-service error. */
export function accountsErrorMessage(t: TFunction, err: unknown): string {
  if (err instanceof AccountsError) {
    if (KNOWN_CODES.has(err.code)) return t(`auth.err.${err.code}` as MessageKey);
    if (err.status === 401) return t("auth.err.unauthorized");
    if (err.status === 403) return t("auth.err.forbidden");
    return err.message ? `${err.message} (${err.code})` : t("auth.err.unknown", { code: err.code });
  }
  if (err instanceof Error && err.message) return err.message;
  return t("auth.err.unknown", { code: "unknown" });
}
