"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { accounts } from "./client";
import { clearSession, getSession, subscribeSession } from "./store";
import type { Role, Session, User } from "./types";

export interface Auth {
  session: Session | null;
  user: User | null;
  role: Role | null;
  isAdmin: boolean;
  /** True until localStorage has been read on the client (SSR/hydration). */
  loading: boolean;
  /** True while GET /me is re-validating the cached session. */
  refreshing: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
  /** Re-sync user + has_api_key from GET /me. A 401 clears the session (auto-logout). */
  refresh: () => Promise<void>;
}

const serverNull = () => null;
const noop = () => () => undefined;

export function useAuth(): Auth {
  const session = useSyncExternalStore(subscribeSession, getSession, serverNull);
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const [refreshing, setRefreshing] = useState(false);
  const refreshedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getSession()) return;
    setRefreshing(true);
    try {
      await accounts.me();
    } catch {
      // 401 already cleared the session; other errors keep the cached user.
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Validate the cached session once per token.
  const token = session?.token ?? null;
  useEffect(() => {
    if (!hydrated || !token || refreshedFor.current === token) return;
    refreshedFor.current = token;
    void refresh();
  }, [hydrated, token, refresh]);

  const login = useCallback(async (email: string, password: string) => (await accounts.login({ email, password })).user, []);
  const register = useCallback(
    async (name: string, email: string, password: string) => (await accounts.register({ name, email, password })).user,
    [],
  );
  const logout = useCallback(() => clearSession(), []);

  const user = session?.user ?? null;
  return {
    session,
    user,
    role: user?.role ?? null,
    isAdmin: user?.role === "admin",
    loading: !hydrated,
    refreshing,
    login,
    register,
    logout,
    refresh,
  };
}
