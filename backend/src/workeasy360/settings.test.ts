import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { safeNext } from "./safeNext";
import { configurationProblems, isAcceptableUrl, workeasy360 } from "./settings";

const saved = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

function configure(values: Record<string, string>) {
  for (const key of Object.keys(process.env)) if (key.startsWith("WORKEASY360_")) delete process.env[key];
  Object.assign(process.env, values);
}

const complete = {
  WORKEASY360_ISSUER: "https://accounts.workeasy360.com",
  WORKEASY360_CLIENT_ID: "client",
  WORKEASY360_REDIRECT_URI: "https://hrms.example.com/api/auth/callback/workeasy360",
  WORKEASY360_KEY_ID: "kid",
  WORKEASY360_PRIVATE_KEY_FILE: "/run/secrets/workeasy360.pem",
};

describe("WorkEasy360 settings", () => {
  it("defaults the product code to workeasy_hrms and always asks for openid and email", () => {
    configure({ WORKEASY360_SCOPES: "profile organization" });
    assert.equal(workeasy360.productCode, "workeasy_hrms");
    assert.deepEqual(workeasy360.scopes, ["email", "openid", "profile", "organization"]);
    configure({ WORKEASY360_PRODUCT_CODE: "hrms_eu" });
    assert.equal(workeasy360.productCode, "hrms_eu");
  });

  it("accepts http only for a loopback host outside production", () => {
    process.env.NODE_ENV = "development";
    assert.ok(isAcceptableUrl("http://127.0.0.1:8031"));
    assert.ok(isAcceptableUrl("http://localhost:8031"));
    assert.ok(!isAcceptableUrl("http://accounts.workeasy360.com"));
    // Loopback is 127.0.0.0/8 and ::1, as the platform defines it: a local run may use 127.0.0.13.
    assert.ok(isAcceptableUrl("http://127.0.0.13:8313/api/auth/callback/workeasy360"));
    assert.ok(isAcceptableUrl("http://127.255.255.254/login"));
    assert.ok(isAcceptableUrl("http://[::1]:4000/login"));
    assert.ok(!isAcceptableUrl("http://128.0.0.1/login"));
    assert.ok(!isAcceptableUrl("http://127.0.0.1.example.com/login"));
    assert.ok(!isAcceptableUrl("http://10.0.0.1/login"));
    configure({
      ...complete,
      WORKEASY360_ISSUER: "http://127.0.0.1:8031",
      WORKEASY360_REDIRECT_URI: "http://127.0.0.13:8313/api/auth/callback/workeasy360",
      WORKEASY360_POST_LOGOUT_REDIRECT_URI: "http://127.0.0.13:3113/login",
    });
    assert.deepEqual(configurationProblems(), []);
    process.env.NODE_ENV = "production";
    assert.ok(!isAcceptableUrl("http://127.0.0.1:8031"));
    assert.ok(!isAcceptableUrl("http://127.0.0.13:8313"));
    assert.ok(isAcceptableUrl("https://accounts.workeasy360.com"));
  });

  it("refuses to start half configured, with an http issuer in production, or a trailing slash", () => {
    configure({ WORKEASY360_ISSUER: "https://accounts.workeasy360.com" });
    assert.match(configurationProblems().join(), /partly configured/);
    process.env.NODE_ENV = "production";
    configure({ ...complete, WORKEASY360_ISSUER: "http://127.0.0.1:8031" });
    assert.match(configurationProblems().join(), /WORKEASY360_ISSUER must be https/);
    configure({ ...complete, WORKEASY360_ISSUER: "https://accounts.workeasy360.com/" });
    assert.match(configurationProblems().join(), /must not end with a slash/);
    configure(complete);
    assert.deepEqual(configurationProblems(), []);
    configure({ WORKEASY360_SSO_ONLY: "true" });
    assert.match(configurationProblems().join(), /SSO_ONLY=true needs/);
    configure({});
    assert.deepEqual(configurationProblems(), []);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths and drops everything else", () => {
    assert.equal(safeNext("/employees?tab=active"), "/employees?tab=active");
    assert.equal(safeNext(undefined), "/dashboard");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "/api/auth/logout", "/x\u0000y", "dashboard"]) {
      assert.equal(safeNext(bad), "/dashboard", bad);
    }
  });
});
