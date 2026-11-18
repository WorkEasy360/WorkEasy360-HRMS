import type * as Oidc from "openid-client" with { "resolution-mode": "import" };
import type * as Jose from "jose" with { "resolution-mode": "import" };

/**
 * openid-client 6 and jose 6 are ECMAScript modules and this backend compiles to CommonJS,
 * so they are loaded with a dynamic import() (which TypeScript's node16 mode keeps as a
 * real import) once, on first use.
 */
let loaded: Promise<{ oidc: typeof Oidc; jose: typeof Jose }> | null = null;

export function libraries(): Promise<{ oidc: typeof Oidc; jose: typeof Jose }> {
  loaded ??= Promise.all([import("openid-client"), import("jose")]).then(([oidc, jose]) => ({ oidc, jose }));
  return loaded;
}

export type { Oidc, Jose };
