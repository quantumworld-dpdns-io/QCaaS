"use client";

import { useEffect, useState } from "react";
import { CREDENTIALS_EVENT, getApiKey, getPayloadKey } from "@/lib/api/client";

export interface Credentials {
  apiKey: string | null;
  payloadKey: string | null;
  /** false until the first client-side read (avoids SSR/CSR mismatch). */
  ready: boolean;
}

/** Reactive view of the sessionStorage credentials. */
export function useCredentials(): Credentials {
  const [creds, setCreds] = useState<Credentials>({ apiKey: null, payloadKey: null, ready: false });

  useEffect(() => {
    const read = () => setCreds({ apiKey: getApiKey(), payloadKey: getPayloadKey(), ready: true });
    read();
    window.addEventListener(CREDENTIALS_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CREDENTIALS_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return creds;
}
