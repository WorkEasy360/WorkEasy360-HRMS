"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export type AppConfig = { emailEnabled: boolean };

// Fetched once per page load and shared by every caller.
let cached: Promise<AppConfig> | null = null;

/** Server capabilities (e.g. whether email is configured). `null` while loading. */
export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    cached ??= apiFetch<AppConfig>("/auth/config").catch(() => {
      cached = null;
      return { emailEnabled: false };
    });
    let active = true;
    cached.then((c) => active && setConfig(c));
    return () => {
      active = false;
    };
  }, []);
  return config;
}
