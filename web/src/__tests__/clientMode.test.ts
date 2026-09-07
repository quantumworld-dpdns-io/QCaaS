import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getClientMode, resolveRequest, setCredentials } from "@/lib/api/client";
import { getSession, setSession } from "@/lib/auth/store";
import type { User } from "@/lib/auth/types";

const user: User = { id: "u1", email: "a@example.com", name: "A", role: "customer", active: true, created_at: "2026-01-01T00:00:00Z" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api client mode selection", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses direct mode with X-API-Key when not logged in", () => {
    setCredentials("key-123", "pk");
    expect(getClientMode()).toBe("direct");
    const r = resolveRequest("/v2/jobs", false);
    expect(r.mode).toBe("direct");
    expect(r.url).toBe("http://localhost:8000/v2/jobs");
    expect(r.headers.get("X-API-Key")).toBe("key-123");
    expect(r.headers.get("X-Payload-Key")).toBe("pk");
    expect(r.headers.has("Authorization")).toBe(false);
  });

  it("stays in direct mode when logged in without a provisioned key", () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: false });
    setCredentials("key-123");
    expect(getClientMode()).toBe("direct");
    const r = resolveRequest("/v2/quote", true);
    expect(r.url).toBe("http://localhost:8000/v2/quote");
    expect(r.headers.get("X-API-Key")).toBe("key-123");
  });

  it("routes /v2/* through the accounts proxy with the bearer token in session mode (precedence over pasted key)", async () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: true });
    setCredentials("key-123", "pk");
    expect(getClientMode()).toBe("session");

    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));
    await api.jobs({ limit: 5 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/proxy/v2/jobs?limit=5");
    const headers = init!.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt");
    expect(headers.has("X-API-Key")).toBe(false);
    expect(headers.get("X-Payload-Key")).toBe("pk"); // passes through the proxy

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.quote({ circuit_format: "openqasm2", circuit_payload: "OPENQASM 2.0;" });
    expect(String(fetchMock.mock.calls[1]![0])).toBe("http://localhost:8080/proxy/v2/quote");
  });

  it("never proxies non-/v2 paths such as /healthz", () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: true });
    const r = resolveRequest("/healthz", false);
    expect(r.mode).toBe("direct");
    expect(r.url).toBe("http://localhost:8000/healthz");
    expect(r.headers.has("Authorization")).toBe(false);
  });

  it("clears the session when the proxy rejects the token (401) and surfaces proxy error codes", async () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "token expired", code: "unauthorized" }, 401));
    await expect(api.jobs()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(getSession()).toBeNull();
    expect(getClientMode()).toBe("direct");

    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user, has_api_key: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "no api key", code: "no_api_key" }, 409));
    await expect(api.jobs()).rejects.toMatchObject({ code: "no_api_key", status: 409 });
    expect(getSession()).not.toBeNull();
  });
});
