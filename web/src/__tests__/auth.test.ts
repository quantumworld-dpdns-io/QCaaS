import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsError, accounts, accountsFetch } from "@/lib/auth/client";
import { SESSION_EVENT, SESSION_STORAGE, clearSession, getAccountsUrl, getSession, setSession } from "@/lib/auth/store";
import type { User } from "@/lib/auth/types";

const user: User = { id: "u1", email: "a@example.com", name: "A", role: "customer", active: true, created_at: "2026-01-01T00:00:00Z" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("auth store", () => {
  beforeEach(() => localStorage.clear());

  it("defaults the accounts URL to localhost:8080", () => {
    expect(getAccountsUrl()).toBe("http://localhost:8080");
  });

  it("persists the session under qcaas.session and notifies subscribers", () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_EVENT, listener);
    setSession({ token: "t1", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: false });
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE)!).token).toBe("t1");
    expect(getSession()?.user.email).toBe("a@example.com");
    expect(getSession()).toBe(getSession()); // stable reference for useSyncExternalStore
    clearSession();
    expect(getSession()).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(SESSION_EVENT, listener);
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem(SESSION_STORAGE, "{not json");
    expect(getSession()).toBeNull();
  });
});

describe("accountsFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("login stores the session and logout clears it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user }));
    await accounts.login({ email: user.email, password: "password1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/auth/login");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Headers).has("Authorization")).toBe(false);
    expect(getSession()?.token).toBe("jwt");
    expect(getSession()?.has_api_key).toBe(false);
    clearSession();
    expect(getSession()).toBeNull();
  });

  it("adds the bearer token and maps {error, code} to AccountsError", async () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: false });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "no api key", code: "no_api_key" }, 404));
    const err = await accountsFetch("/me/api-key").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountsError);
    expect((err as AccountsError).code).toBe("no_api_key");
    expect((err as AccountsError).status).toBe(404);
    expect((err as AccountsError).message).toBe("no api key");
    expect((fetchMock.mock.calls[0]![1]!.headers as Headers).get("Authorization")).toBe("Bearer jwt");
    expect(getSession()).not.toBeNull(); // 404 does not log out
  });

  it("auto-logs out on 401 for authenticated calls only", async () => {
    setSession({ token: "expired", expires_at: "2000-01-01T00:00:00Z", user, has_api_key: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "token expired", code: "unauthorized" }, 401));
    await expect(accounts.me()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(getSession()).toBeNull();

    // A failed login (401 invalid_credentials) must not touch an existing session.
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad", code: "invalid_credentials" }, 401));
    await expect(accounts.login({ email: "x@example.com", password: "wrong-pass" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(getSession()?.token).toBe("jwt");
  });

  it("wraps network failures and non-JSON errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(accountsFetch("/healthz", { auth: false })).rejects.toMatchObject({ code: "network_error", status: 0 });
    fetchMock.mockResolvedValueOnce(new Response("gateway", { status: 502, statusText: "Bad Gateway" }));
    await expect(accountsFetch("/healthz", { auth: false })).rejects.toMatchObject({ code: "http_502", status: 502 });
  });

  it("syncs has_api_key from GET /me and after provisioning", async () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: false });
    fetchMock.mockResolvedValueOnce(jsonResponse({ api_key: "qc_live_abc", key_prefix: "qc_live_a", customer_id: "c1", plan: "payg", created: true }, 201));
    const r = await accounts.provisionApiKey({ plan: "payg" });
    expect(r.created).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ plan: "payg" });
    expect(getSession()?.has_api_key).toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse({ user: { ...user, api_key_prefix: "qc_live_a" }, has_api_key: false }));
    await accounts.me();
    expect(getSession()?.has_api_key).toBe(false);
    expect(getSession()?.user.api_key_prefix).toBe("qc_live_a");
  });
});
