"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  apiFetch,
  clearTokens,
  discardStoredSession,
  endCookieSession,
  endSession,
  restoreCookieSession,
  SESSION_EXPIRED_EVENT,
  setTokens,
  workeasy360SignOutUrl,
} from "./api";
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
  /** Signs out of HRMS; with `workeasy360`, then goes on to WorkEasy360's own sign-out. */
  logout: (options?: { workeasy360?: boolean }) => void;
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
    // A WorkEasy360 sign-in keeps its session in an httpOnly cookie: renew the in-memory access
    // token from it (this is also how the page picks up a sign-in that just landed). It wins over
    // a password session stored in this browser, which a WorkEasy360 sign-in replaces; a password
    // sign-in ends the cookie session in turn (endCookieSession below).
    restoreCookieSession()
      .then(async (restored) => {
        if (restored) {
          discardStoredSession();
          await refetchUser();
        } else if (localStorage.getItem("accessToken")) {
          await refetchUser();
        }
      })
      .finally(() => setLoading(false));
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
      await endCookieSession();
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
      await endCookieSession();
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
      await endCookieSession();
      setTokens(data.accessToken, data.refreshToken);
      await refetchUser();
      return data.organization;
    },
    [refetchUser],
  );

  const logout = useCallback((options?: { workeasy360?: boolean }) => {
    // End the session server-side (its access tokens stop working at once); sign out locally
    // regardless of the result. WorkEasy360 sign-out, if asked for, comes after: it is a page
    // of WorkEasy360's that asks the person to confirm.
    const ended = endSession();
    clearTokens();
    setUser(null);
    if (options?.workeasy360) {
      ended.finally(() => window.location.assign(workeasy360SignOutUrl()));
    }
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
