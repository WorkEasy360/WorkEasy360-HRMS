const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/** Fired when the session can no longer be refreshed; AuthProvider listens and signs the user out. */
export const SESSION_EXPIRED_EVENT = "workeasy:session-expired";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

export function getRefreshToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("refreshToken");
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem("accessToken", accessToken);
  localStorage.setItem("refreshToken", refreshToken);
}

export function clearTokens() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
}

// Several requests can hit a 401 at once; share a single refresh so the
// rotated refresh token isn't spent twice.
let refreshInFlight: Promise<string | null> | null = null;

function tryRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string; refreshToken?: string };
        setTokens(data.accessToken, data.refreshToken ?? refreshToken);
        return data.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const FIELD_LABELS: Record<string, string> = {
  organizationSlug: "Organization ID",
  organizationName: "Organization name",
  firstName: "First name",
  lastName: "Last name",
  startDate: "Start date",
  endDate: "End date",
  leaveTypeId: "Leave type",
};

function humanize(field: string) {
  return FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Turns the backend's error payloads (plain strings or zod `flatten()` output) into one readable sentence. */
function extractMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { formErrors = [], fieldErrors = {} } = error as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const parts = [
      ...formErrors,
      ...Object.entries(fieldErrors).flatMap(([field, msgs]) => (msgs?.length ? [`${humanize(field)}: ${msgs[0]}`] : [])),
    ];
    if (parts.length) return parts.join(" · ");
  }
  return fallback;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401 && retry && token) {
    const newToken = await tryRefresh();
    if (newToken) {
      return apiFetch<T>(path, options, false);
    }
    clearTokens();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const fallback =
      res.status === 403
        ? "You don't have permission to do that."
        : res.status >= 500
          ? "The server hit an error. Please try again."
          : res.statusText || "Request failed";
    throw new ApiError(res.status, extractMessage(body, fallback));
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
