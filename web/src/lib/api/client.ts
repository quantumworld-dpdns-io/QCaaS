import type {
  InterpretRequest,
  InterpretResponse,
  JobDetail,
  JobList,
  JobsQuery,
  OptimizeRequest,
  OptimizeResponse,
  QuoteRequest,
  QuoteResponse,
} from "./types";

export const API_KEY_STORAGE = "qcaas.apiKey";
export const PAYLOAD_KEY_STORAGE = "qcaas.payloadKey";
export const DEFAULT_BASE_URL = "http://localhost:8000";
export const CREDENTIALS_EVENT = "qcaas:credentials";

export function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getApiKey(): string | null {
  return safeStorage()?.getItem(API_KEY_STORAGE) || null;
}

export function getPayloadKey(): string | null {
  return safeStorage()?.getItem(PAYLOAD_KEY_STORAGE) || null;
}

export function setCredentials(apiKey: string, payloadKey?: string): void {
  const s = safeStorage();
  if (!s) return;
  if (apiKey.trim()) s.setItem(API_KEY_STORAGE, apiKey.trim());
  else s.removeItem(API_KEY_STORAGE);
  if (payloadKey && payloadKey.trim()) s.setItem(PAYLOAD_KEY_STORAGE, payloadKey.trim());
  else s.removeItem(PAYLOAD_KEY_STORAGE);
  window.dispatchEvent(new Event(CREDENTIALS_EVENT));
}

export function clearCredentials(): void {
  const s = safeStorage();
  if (!s) return;
  s.removeItem(API_KEY_STORAGE);
  s.removeItem(PAYLOAD_KEY_STORAGE);
  window.dispatchEvent(new Event(CREDENTIALS_EVENT));
}

/** Error thrown for any non-2xx response. `code` mirrors the backend ErrorResponse.code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;

  constructor(status: number, code: string, message: string, detail: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
}

export interface ApiResult<T> {
  data: T;
  rateLimit: RateLimit;
}

function parseRateLimit(headers: Headers): RateLimit {
  const toNum = (v: string | null) =>
    v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
  return {
    limit: toNum(headers.get("X-RateLimit-Limit")),
    remaining: toNum(headers.get("X-RateLimit-Remaining")),
  };
}

function buildHeaders(hasBody: boolean): Headers {
  const h = new Headers();
  h.set("Accept", "application/json");
  if (hasBody) h.set("Content-Type", "application/json");
  const apiKey = getApiKey();
  if (apiKey) h.set("X-API-Key", apiKey);
  const payloadKey = getPayloadKey();
  if (payloadKey) h.set("X-Payload-Key", payloadKey);
  return h;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    // Backend ErrorResponse: {error, detail, code}
    if (typeof b.code === "string" && typeof b.error === "string") {
      const detail = typeof b.detail === "string" ? b.detail : null;
      return new ApiError(res.status, b.code, b.error, detail);
    }
    // FastAPI HTTPValidationError: {detail: [{loc,msg,type}]}
    if (Array.isArray(b.detail)) {
      const msgs = (b.detail as Array<{ loc?: unknown[]; msg?: string }>)
        .map((d) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? ""}`.trim())
        .join("; ");
      return new ApiError(res.status, "validation_error", "Validation error", msgs || null);
    }
    if (typeof b.detail === "string") {
      return new ApiError(res.status, `http_${res.status}`, b.detail, null);
    }
  }
  return new ApiError(res.status, `http_${res.status}`, res.statusText || `HTTP ${res.status}`, null);
}

export async function request<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: buildHeaders(hasBody),
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError(0, "network_error", "Network error", msg);
  }
  if (!res.ok) throw await toApiError(res);
  const rateLimit = parseRateLimit(res.headers);
  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { data, rateLimit };
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  healthz: () => request<Record<string, unknown>>("/healthz"),
  optimize: (body: OptimizeRequest, signal?: AbortSignal) =>
    request<OptimizeResponse>("/v2/optimize", { method: "POST", body, signal }),
  quote: (body: QuoteRequest, signal?: AbortSignal) =>
    request<QuoteResponse>("/v2/quote", { method: "POST", body, signal }),
  interpret: (body: InterpretRequest, signal?: AbortSignal) =>
    request<InterpretResponse>("/v2/interpret", { method: "POST", body, signal }),
  jobs: (query: JobsQuery = {}, signal?: AbortSignal) =>
    request<JobList>(`/v2/jobs${qs(query)}`, { signal }),
  job: (jobId: string, signal?: AbortSignal) =>
    request<JobDetail>(`/v2/jobs/${encodeURIComponent(jobId)}`, { signal }),
};
