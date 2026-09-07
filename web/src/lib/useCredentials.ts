"use client";

import { useSyncExternalStore } from "react";
import { CREDENTIALS_EVENT, getApiKey, getPayloadKey } from "@/lib/api/client";

export interface Credentials {
  apiKey: string | null;
  payloadKey: string | null;
  /** false during SSR/hydration, true once sessionStorage has been read on the client. */
  ready: boolean;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CREDENTIALS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CREDENTIALS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const serverNull = () => null;
const noop = () => () => undefined;

/** Reactive view of the sessionStorage credentials (safe for SSR). */
export function useCredentials(): Credentials {
  const apiKey = useSyncExternalStore(subscribe, getApiKey, serverNull);
  const payloadKey = useSyncExternalStore(subscribe, getPayloadKey, serverNull);
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return { apiKey, payloadKey, ready };
}
