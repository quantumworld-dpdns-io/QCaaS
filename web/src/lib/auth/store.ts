import type { Session, User } from "./types";

export const SESSION_STORAGE = "qcaas.session";
export const SESSION_EVENT = "qcaas:session";
export const DEFAULT_ACCOUNTS_URL = "http://localhost:8080";

export function getAccountsUrl(): string {
  const raw = process.env.NEXT_PUBLIC_ACCOUNTS_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_ACCOUNTS_URL).replace(/\/+$/, "");
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSession(v: unknown): v is Session {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.token === "string" && s.token.length > 0 && !!s.user && typeof s.user === "object";
}

let cache: { raw: string | null; session: Session | null } = { raw: null, session: null };

/** Current session (null when logged out). Returns a stable object for a given stored value. */
export function getSession(): Session | null {
  const raw = safeStorage()?.getItem(SESSION_STORAGE) ?? null;
  if (raw === cache.raw) return cache.session;
  let session: Session | null = null;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSession(parsed)) session = { ...parsed, has_api_key: parsed.has_api_key === true };
    } catch {
      session = null;
    }
  }
  cache = { raw, session };
  return session;
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
}

export function setSession(session: Session): void {
  const s = safeStorage();
  if (!s) return;
  s.setItem(SESSION_STORAGE, JSON.stringify(session));
  notify();
}

/** Update the user / has_api_key of the current session without touching the token. */
export function patchSession(patch: { user?: User; has_api_key?: boolean }): void {
  const current = getSession();
  if (!current) return;
  setSession({ ...current, ...patch });
}

export function clearSession(): void {
  const s = safeStorage();
  if (!s) return;
  s.removeItem(SESSION_STORAGE);
  notify();
}

export function subscribeSession(onChange: () => void): () => void {
  window.addEventListener(SESSION_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SESSION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
