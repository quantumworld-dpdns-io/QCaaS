"use client";

import { useSyncExternalStore } from "react";
import { CREDENTIALS_EVENT, getApiKey, getPayloadKey, type ClientMode } from "@/lib/api/client";
import { getSession, subscribeSession } from "@/lib/auth/store";

export interface Credentials {
  /** Pasted key from Settings (direct mode). */
  apiKey: string | null;
  payloadKey: string | null;
  /** false during SSR/hydration, true once browser storage has been read on the client. */
  ready: boolean;
  /** "session" when logged in with a provisioned API key (calls go through the accounts proxy), else "direct". */
  mode: ClientMode;
  /** True when a logged-in user has not provisioned an API key yet (and no direct key is set). */
  signedInWithoutKey: boolean;
  /**
   * Opaque identifier of the active credential, or null when /v2/* calls cannot be authenticated.
   * Use it to gate and key queries so they re-run when the credential changes.
   */
  credential: string | null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CREDENTIALS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  const unsubSession = subscribeSession(onChange);
  return () => {
    window.removeEventListener(CREDENTIALS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    unsubSession();
  };
}

const serverNull = () => null;
const noop = () => () => undefined;

/** Reactive view of the active credentials: direct API key (sessionStorage) or login session (localStorage). */
export function useCredentials(): Credentials {
  const apiKey = useSyncExternalStore(subscribe, getApiKey, serverNull);
  const payloadKey = useSyncExternalStore(subscribe, getPayloadKey, serverNull);
  const session = useSyncExternalStore(subscribe, getSession, serverNull);
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const mode: ClientMode = session && session.has_api_key ? "session" : "direct";
  const credential = mode === "session" && session ? `session:${session.user.id}` : apiKey;
  return {
    apiKey,
    payloadKey,
    ready,
    mode,
    signedInWithoutKey: !!session && !session.has_api_key && !apiKey,
    credential,
  };
}
