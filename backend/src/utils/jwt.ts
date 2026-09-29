import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string; // userId
  organizationId: string;
  employeeId: string | null;
  roles: string[];
  permissions: string[];
}

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to a random string of at least 32 characters`);
  }
  return value;
}

const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");
const REFRESH_SECRET = requireSecret("JWT_REFRESH_SECRET");

// Every token carries an audience so one kind can never be replayed as another
// (e.g. an MFA challenge token used as an access token).
const AUD = { access: "access", refresh: "refresh", mfa: "mfa" } as const;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m", audience: AUD.access });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, ACCESS_SECRET, { audience: AUD.access }) as Partial<AccessTokenPayload>;
  if (typeof payload.sub !== "string" || typeof payload.organizationId !== "string" || !Array.isArray(payload.permissions)) {
    throw new Error("Malformed access token");
  }
  return payload as AccessTokenPayload;
}

export function signRefreshToken(userId: string, tokenId: string, familyId: string): string {
  return jwt.sign({ sub: userId, fam: familyId }, REFRESH_SECRET, { expiresIn: "7d", audience: AUD.refresh, jwtid: tokenId });
}

export function verifyRefreshToken(token: string): { sub: string; jti: string; fam: string } {
  const payload = jwt.verify(token, REFRESH_SECRET, { audience: AUD.refresh }) as { sub?: string; jti?: string; fam?: string };
  if (!payload.sub || !payload.jti || !payload.fam) {
    throw new Error("Malformed refresh token");
  }
  return payload as { sub: string; jti: string; fam: string };
}

// Short-lived token issued after password check when 2FA is enabled,
// exchanged for real tokens via /auth/2fa/login-verify.
export function signMfaToken(userId: string): string {
  return jwt.sign({ sub: userId }, ACCESS_SECRET, { expiresIn: "5m", audience: AUD.mfa });
}

export function verifyMfaToken(token: string): { sub: string } {
  return jwt.verify(token, ACCESS_SECRET, { audience: AUD.mfa }) as { sub: string };
}
