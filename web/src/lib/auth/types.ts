export type Role = "customer" | "admin";
export type Plan = "payg" | "flex" | "premium";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: string;
  qcaas_customer_id?: string | null;
  api_key_prefix?: string | null;
  api_key_created_at?: string | null;
}

/** Persisted in localStorage under `qcaas.session`. */
export interface Session {
  token: string;
  expires_at: string;
  user: User;
  /** Mirrors GET /me `has_api_key`; decides whether /v2/* calls go through the proxy. */
  has_api_key: boolean;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: User;
}

export interface MeResponse {
  user: User;
  has_api_key: boolean;
}

export interface ApiKeyResponse {
  api_key: string;
  key_prefix: string;
  customer_id: string;
  plan?: Plan;
  created: boolean;
}

export interface AdminUserList {
  items: User[];
  total: number;
}

export interface AdminStats {
  users: number;
  users_with_api_key: number;
  qcaas: {
    customers: number;
    active_customers: number;
    jobs: { total: number; by_kind: Record<string, number> };
    selected_backends: Record<string, number>;
    revenue_usd: number;
    estimated_qpu_seconds: number;
  };
}

export interface AdminJob {
  job_id: string;
  customer_id: string;
  account_email: string | null;
  kind: string;
  status: string;
  target_backend: string | null;
  selected_backend: string | null;
  total_usd: number | null;
  estimated_qpu_seconds: number | null;
  created_at: string;
}

export interface AdminJobList {
  items: AdminJob[];
  total: number;
}

export interface AuditEntry {
  id: string | number;
  at: string;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  detail: string | null;
}

export interface AuditList {
  items: AuditEntry[];
}

export interface AccountsHealth {
  status: string;
  qcaas_api: string;
}
