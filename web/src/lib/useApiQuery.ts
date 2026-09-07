"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResult } from "@/lib/api/client";

interface Snapshot<T> {
  key: string;
  data?: T;
  error?: unknown;
}

export interface ApiQuery<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refetch: () => void;
}

/**
 * Minimal keyed fetch hook. `key === null` disables the query.
 * State is only updated from promise callbacks (never synchronously in the effect),
 * and stale data is kept while a new key is loading.
 */
export function useApiQuery<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>): ApiQuery<T> {
  const [snap, setSnap] = useState<Snapshot<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const fullKey = key === null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (fullKey === null) return;
    const ac = new AbortController();
    fetcher(ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setSnap({ key: fullKey, data: r.data });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setSnap({ key: fullKey, error: e });
      });
    return () => ac.abort();
  }, [fullKey, fetcher]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  const current = snap !== null && snap.key === fullKey;

  return {
    data: snap?.data ?? null,
    error: current ? snap.error ?? null : null,
    loading: fullKey !== null && !current,
    refetch,
  };
}
