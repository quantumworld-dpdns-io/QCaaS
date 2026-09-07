import { clearSession, getAccountsUrl, getToken, patchSession, setSession } from "./store";
import type {
  AccountsHealth,
  AdminJobList,
  AdminStats,
  AdminUserList,
  ApiKeyResponse,
  AuditList,
  AuthResponse,
  MeResponse,
  Plan,
  Role,
  User,
} from "./types";

/** Error thrown for any non-2xx accounts response. `code` mirrors the service's `{error, code}` body. */
export class AccountsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AccountsError";
    this.status = status;
    this.code = code;
  }
}

export interface AccountsFetchInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Send the bearer token (default true). False for /auth/* so a stale token cannot leak or trigger a logout. */
  auth?: boolean;
}

export async function toAccountsError(res: Response): Promise<AccountsError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const code = typeof b.code === "string" ? b.code : `http_${res.status}`;
    const message = typeof b.error === "string" ? b.error : res.statusText || `HTTP ${res.status}`;
    return new AccountsError(res.status, code, message);
  }
  return new AccountsError(res.status, `http_${res.status}`, res.statusText || `HTTP ${res.status}`);
}

/**
 * fetch() against the accounts service: adds `Authorization: Bearer`, maps `{error, code}` to AccountsError
 * and clears the stored session when an authenticated call is rejected with 401.
 */
export async function accountsFetch<T>(path: string, init: AccountsFetchInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const hasBody = init.body !== undefined;
  const useAuth = init.auth ?? true;
  const headers = new Headers({ Accept: "application/json" });
  if (hasBody) headers.set("Content-Type", "application/json");
  const token = useAuth ? getToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${getAccountsUrl()}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AccountsError(0, "network_error", msg || "Network error");
  }
  if (!res.ok) {
    if (res.status === 401 && token) clearSession();
    throw await toAccountsError(res);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function storeAuth(r: AuthResponse): AuthResponse {
  setSession({ token: r.token, expires_at: r.expires_at, user: r.user, has_api_key: !!r.user.api_key_prefix });
  return r;
}

export const accounts = {
  healthz: (signal?: AbortSignal) => accountsFetch<AccountsHealth>("/healthz", { signal, auth: false }),

  register: (body: { email: string; password: string; name: string }) =>
    accountsFetch<AuthResponse>("/auth/register", { method: "POST", body, auth: false }).then(storeAuth),
  login: (body: { email: string; password: string }) =>
    accountsFetch<AuthResponse>("/auth/login", { method: "POST", body, auth: false }).then(storeAuth),

  /** GET /me and sync the stored session (user + has_api_key). */
  me: async (signal?: AbortSignal) => {
    const r = await accountsFetch<MeResponse>("/me", { signal });
    patchSession({ user: r.user, has_api_key: r.has_api_key });
    return r;
  },
  updateMe: async (body: { name: string }) => {
    const user = await accountsFetch<User>("/me", { method: "PATCH", body });
    patchSession({ user });
    return user;
  },
  provisionApiKey: async (body: { plan?: Plan; retention_days?: number }) => {
    const r = await accountsFetch<ApiKeyResponse>("/me/api-key", { method: "POST", body });
    patchSession({ has_api_key: true });
    return r;
  },
  revealApiKey: (signal?: AbortSignal) => accountsFetch<ApiKeyResponse>("/me/api-key", { signal }),

  admin: {
    users: (signal?: AbortSignal) => accountsFetch<AdminUserList>("/admin/users", { signal }),
    patchUser: (id: string, body: { role?: Role; active?: boolean; name?: string }) =>
      accountsFetch<User>(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    stats: (signal?: AbortSignal) => accountsFetch<AdminStats>("/admin/stats", { signal }),
    jobs: (query: { limit?: number; offset?: number; kind?: string; customer_id?: string } = {}, signal?: AbortSignal) =>
      accountsFetch<AdminJobList>(`/admin/jobs${qs(query)}`, { signal }),
    audit: (signal?: AbortSignal) => accountsFetch<AuditList>("/admin/audit", { signal }),
  },
};
