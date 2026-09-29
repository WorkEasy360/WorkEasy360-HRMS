"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, clearTokens, getRefreshToken, SESSION_EXPIRED_EVENT, setTokens } from "./api";
import { CurrentUser, Organization } from "./types";

type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false };

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (organizationSlug: string, email: string, password: string) => Promise<LoginResult>;
  completeMfaLogin: (mfaToken: string, token: string) => Promise<void>;
  register: (input: {
    organizationName: string;
    organizationSlug: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<Organization>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refetchUser = useCallback(async () => {
    try {
      const me = await apiFetch<CurrentUser>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const hasToken = typeof window !== "undefined" && localStorage.getItem("accessToken");
    if (hasToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring session on mount
      refetchUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refetchUser]);

  // apiFetch signals when the refresh token is no longer valid.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(
    async (organizationSlug: string, email: string, password: string): Promise<LoginResult> => {
      const data = await apiFetch<
        { accessToken: string; refreshToken: string } | { mfaRequired: true; mfaToken: string }
      >("/auth/login", {
        method: "POST",
        body: JSON.stringify({ organizationSlug, email, password }),
      });
      if ("mfaRequired" in data) {
        return { mfaRequired: true, mfaToken: data.mfaToken };
      }
      setTokens(data.accessToken, data.refreshToken);
      await refetchUser();
      return { mfaRequired: false };
    },
    [refetchUser],
  );

  const completeMfaLogin = useCallback(
    async (mfaToken: string, token: string) => {
      const data = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/2fa/login-verify", {
        method: "POST",
        body: JSON.stringify({ mfaToken, token }),
      });
      setTokens(data.accessToken, data.refreshToken);
      await refetchUser();
    },
    [refetchUser],
  );

  const register = useCallback(
    async (input: {
      organizationName: string;
      organizationSlug: string;
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }) => {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        organization: Organization;
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setTokens(data.accessToken, data.refreshToken);
      await refetchUser();
      return data.organization;
    },
    [refetchUser],
  );

  const logout = useCallback(() => {
    // Revoke the refresh token server-side; sign out locally regardless of the result.
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => {});
    }
    clearTokens();
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, login, completeMfaLogin, register, logout, hasPermission, refetchUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
