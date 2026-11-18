"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export type AppConfig = {
  emailEnabled: boolean;
  registrationEnabled: boolean;
  /** False when WorkEasy360 is the only way in (WORKEASY360_SSO_ONLY). */
  passwordSignIn?: boolean;
  /** "Continue with WorkEasy360", and whether WorkEasy360 sign-out is offered. */
  workeasy360?: { enabled: boolean; signOut: boolean };
};

// Fetched once per page load and shared by every caller.
let cached: Promise<AppConfig> | null = null;

/** Server capabilities (e.g. whether email is configured). `null` while loading. */
export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    cached ??= apiFetch<AppConfig>("/auth/config").catch(() => {
      cached = null;
      return { emailEnabled: false, registrationEnabled: true, passwordSignIn: true };
    });
    let active = true;
    cached.then((c) => active && setConfig(c));
    return () => {
      active = false;
    };
  }, []);
  return config;
}
