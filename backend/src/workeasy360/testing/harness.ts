import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * End-to-end test support: a PostgreSQL schema of its own (migrated with `prisma migrate
 * deploy`), real API processes (`src/index.ts`, as in production, each with its own memory)
 * sharing it, and a browser with a cookie jar. Tests only.
 *
 * HRMS_TEST_DATABASE_URL names the server to use, e.g.
 * postgresql://hrms:hrms_local_only@127.0.0.1:15561/hrms - each test file creates and drops
 * its own schema in it, so nothing else in that database is touched.
 */

export const TEST_DATABASE_URL = process.env.HRMS_TEST_DATABASE_URL ?? "";
const BACKEND = resolve(__dirname, "..", "..", "..");

export interface TestSchema {
  url: string;
  prisma: PrismaClient;
  drop(): Promise<void>;
}

export async function createTestSchema(): Promise<TestSchema> {
  const name = `sso_e2e_${process.pid}_${randomBytes(3).toString("hex")}`;
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("schema", name);
  const migrated = spawnSync(process.execPath, [join(BACKEND, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: "utf8",
  });
  if (migrated.status !== 0) throw new Error(`prisma migrate deploy failed:\n${migrated.stdout}\n${migrated.stderr}`);
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  return {
    url: url.toString(),
    prisma,
    async drop() {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      await prisma.$disconnect();
    },
  };
}

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

export interface Api {
  url: string;
  port: number;
  logs(): string;
  stop(): Promise<void>;
}

/** One API instance: `node --import tsx src/index.ts`, as a separate process. */
export async function startApi(env: Record<string, string>, port?: number): Promise<Api> {
  const chosen = port ?? (await freePort());
  let output = "";
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: BACKEND,
    env: { ...process.env, ...env, PORT: String(chosen) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));
  const url = `http://127.0.0.1:${chosen}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the API exited (${child.exitCode}):\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the API did not become healthy:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    url,
    port: chosen,
    logs: () => output,
    stop: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) return done();
        child.once("exit", () => done());
        child.kill();
      }),
  };
}

/** A private key written where WORKEASY360_PRIVATE_KEY_FILE can point, removed afterwards. */
export function writeKeyFile(pem: string): { path: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), "hrms-w360-"));
  const path = join(dir, "private-key.pem");
  writeFileSync(path, pem, { mode: 0o600 });
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Reply {
  status: number;
  headers: Headers;
  location: string;
  body: unknown;
  setCookies: string[];
}

/** A browser: a cookie jar (name -> value; paths are left to the test) and fetch without following redirects. */
export class Browser {
  readonly cookies = new Map<string, string>();

  async request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; form?: Record<string, string> } = {}): Promise<Reply> {
    const headers: Record<string, string> = { ...init.headers };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined = init.body;
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.form).toString();
    } else if (body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(url, { method: init.method ?? "GET", headers, body, redirect: "manual" });
    const setCookies = response.headers.getSetCookie();
    for (const line of setCookies) {
      const [pair, ...attributes] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((a) => {
        const [key, val] = a.trim().split("=");
        if (key.toLowerCase() === "max-age") return Number(val) <= 0;
        if (key.toLowerCase() === "expires") return Date.parse(val) <= Date.now();
        return false;
      });
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: response.status, headers: response.headers, location: response.headers.get("location") ?? "", body: parsed, setCookies };
  }
}

/** Calls the API with a bearer access token. */
export async function call(api: Api, token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Reply> {
  return new Browser().request(`${api.url}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}` },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
