import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, API_KEY_STORAGE, PAYLOAD_KEY_STORAGE, api, getBaseUrl, setCredentials } from "@/lib/api/client";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults the base URL to localhost:8000", () => {
    expect(getBaseUrl()).toBe("http://localhost:8000");
  });

  it("attaches X-API-Key and X-Payload-Key from sessionStorage and parses rate-limit headers", async () => {
    setCredentials("key-123", "secret-xyz");
    expect(sessionStorage.getItem(API_KEY_STORAGE)).toBe("key-123");
    expect(sessionStorage.getItem(PAYLOAD_KEY_STORAGE)).toBe("secret-xyz");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0 }, { headers: { "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "59" } }),
    );

    const r = await api.jobs({ kind: "quote", limit: 1 });
    expect(r.data).toEqual({ items: [], total: 0 });
    expect(r.rateLimit).toEqual({ limit: 60, remaining: 59 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8000/v2/jobs?kind=quote&limit=1");
    const headers = init!.headers as Headers;
    expect(headers.get("X-API-Key")).toBe("key-123");
    expect(headers.get("X-Payload-Key")).toBe("secret-xyz");
    expect(init!.method).toBe("GET");
  });

  it("sends JSON bodies for POST and omits absent keys", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.quote({ circuit_format: "openqasm2", circuit_payload: "OPENQASM 2.0;" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8000/v2/quote");
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("X-API-Key")).toBe(false);
    expect(JSON.parse(String(init!.body))).toEqual({ circuit_format: "openqasm2", circuit_payload: "OPENQASM 2.0;" });
  });

  it("maps backend error JSON to ApiError with code/detail/status", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Invalid API key", detail: "header X-API-Key missing", code: "unauthorized" }, { status: 401 }),
    );
    const err = await api.healthz().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(401);
    expect(apiErr.code).toBe("unauthorized");
    expect(apiErr.message).toBe("Invalid API key");
    expect(apiErr.detail).toBe("header X-API-Key missing");
  });

  it("maps FastAPI validation errors (422) to a validation_error ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: [{ loc: ["body", "shots"], msg: "must be >= 1", type: "value_error" }] }, { status: 422 }),
    );
    const err = (await api.healthz().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("validation_error");
    expect(err.status).toBe(422);
    expect(err.detail).toContain("shots: must be >= 1");
  });

  it("wraps network failures as network_error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = (await api.healthz().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("network_error");
    expect(err.status).toBe(0);
  });
});
