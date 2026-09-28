import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import worker from "../worker/dist/index.js";

const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await webcrypto.subtle.exportKey("jwk", publicKey), kid: "test-key" };
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => String(url).includes("www.googleapis.com/oauth2/v3/certs") ? Response.json({ keys: [jwk] }) : originalFetch(url);
const b64 = value => Buffer.from(value).toString("base64url");
async function jwt(email) {
  const header = b64(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  const payload = b64(JSON.stringify({ iss: "https://accounts.google.com", aud: "test-client", email, email_verified: true, sub: "test-owner", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 }));
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, Buffer.from(`${header}.${payload}`));
  return `${header}.${payload}.${b64(Buffer.from(signature))}`;
}
const sql = await readFile(new URL("../worker/seed.sql", import.meta.url), "utf8");
const seed = JSON.parse(sql.match(/VALUES \(1,1,'(.*)','2026-09-25'\)/)[1]);
const legacyContext = { window: {} };
runInNewContext(await readFile(new URL("../data.js", import.meta.url), "utf8"), legacyContext);
const legacy = legacyContext.window.availabilityData;
let row = { id: 1, version: 1, data: JSON.stringify(seed), previous: null, published_at: null, previous_published_at: null, legacy_checked_at: "2026-09-25" };
const env = {
  PUBLIC_ORIGIN: "https://minoru-s.github.io", GOOGLE_CLIENT_ID: "test-client", SESSION_SECRET: "long-local-test-secret-xxxxxxxxxxxxxxxx", OWNER_EMAIL: "owner@example.com",
  DB: { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() {
    if (sql.startsWith("SELECT")) return row;
    if (sql.includes("data=previous")) {
      if (row.version !== args[0] || !row.previous) return null;
      [row.data, row.previous] = [row.previous, row.data]; row.version++; row.published_at = new Date().toISOString(); return { version: row.version, published_at: row.published_at };
    }
    if (row.version !== args[1]) return null;
    row.previous = row.data; row.data = args[0]; row.version++; row.published_at = new Date().toISOString(); return { version: row.version, published_at: row.published_at };
  } }; } }
};
const req = (path, options = {}) => new Request(`https://api.example.com${path}`, options);
async function login(email = "owner@example.com") {
  return worker.fetch(req("/api/admin/login", { method: "POST", headers: { Origin: "https://api.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ credential: await jwt(email) }) }), env);
}

test("移行後の84枠、未来の未入力△、管理APIの本人限定、版競合、復元", async () => {
  const publicPath = "/api/public?from=2026-09-25&to=2026-10-22";
  let result = await (await worker.fetch(req(publicPath), env)).json();
  assert.equal(result.days.length, 28);
  for (const day of result.days) for (const part of ["am", "pm", "night"]) {
    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    const rule = legacy.rules.find(item => day.date >= item.from && day.date <= item.to && item.weekdays.includes(weekday) && item.parts.includes(part));
    assert.equal(day[part], legacy.slots[day.date]?.[part] || rule?.status || "available", `${day.date} ${part}`);
  }
  assert.deepEqual(result.days.find(day => day.date === "2026-09-26"), { date: "2026-09-26", am: "busy", pm: "busy", night: "available" });
  assert.deepEqual(result.days.find(day => day.date === "2026-10-11"), { date: "2026-10-11", am: "tentative", pm: "busy", night: "available" });
  result = await (await worker.fetch(req("/api/public?from=2026-10-23&to=2026-10-23"), env)).json();
  assert.equal(result.days[0].am, "tentative");
  assert.equal((await worker.fetch(req("/api/admin/state"), env)).status, 403);
  assert.equal((await login("other@example.com")).status, 403);
  const validToken = await jwt("owner@example.com");
  const tokenParts = validToken.split(".");
  tokenParts[2] = (tokenParts[2][0] === "A" ? "B" : "A") + tokenParts[2].slice(1);
  const forged = tokenParts.join(".");
  assert.equal((await worker.fetch(req("/api/admin/login", { method: "POST", headers: { Origin: "https://api.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ credential: forged }) }), env)).status, 403);
  const loggedIn = await login(); assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await worker.fetch(req("/api/admin/state", { headers: { Cookie: cookie } }), env)).status, 200);
  assert.equal((await worker.fetch(req("/api/admin/state", { headers: { Cookie: cookie.slice(0, -1) + (cookie.endsWith("x") ? "y" : "x") } }), env)).status, 403);
  assert.equal((await worker.fetch(req("/api/admin/login", { method: "POST", headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" }, body: JSON.stringify({ credential: await jwt("owner@example.com") }) }), env)).status, 403);
  const headers = { Cookie: cookie, Origin: "https://api.example.com", "Content-Type": "application/json" };
  const draft = structuredClone(seed); draft.overrides["2026-09-28"].night = "busy";
  assert.equal((await worker.fetch(req("/api/admin/publish", { method: "POST", headers: { ...headers, Origin: "https://elsewhere.example" }, body: JSON.stringify({ version: 1, data: draft }) }), env)).status, 403);
  const invalid = structuredClone(draft); invalid.locations["2026-09-28"] = "x".repeat(41);
  assert.equal((await worker.fetch(req("/api/admin/publish", { method: "POST", headers, body: JSON.stringify({ version: 1, data: invalid }) }), env)).status, 400);
  let response = await worker.fetch(req("/api/admin/publish", { method: "POST", headers, body: JSON.stringify({ version: 1, data: draft }) }), env);
  assert.equal(response.status, 200);
  result = await (await worker.fetch(req("/api/public?from=2026-09-28&to=2026-09-28"), env)).json();
  assert.equal(result.days[0].night, "busy");
  response = await worker.fetch(req("/api/admin/publish", { method: "POST", headers, body: JSON.stringify({ version: 1, data: seed }) }), env);
  assert.equal(response.status, 409);
  response = await worker.fetch(req("/api/admin/restore-preview", { headers }), env);
  assert.equal((await response.json()).changeCount, 1);
  response = await worker.fetch(req("/api/admin/restore", { method: "POST", headers, body: JSON.stringify({ version: 2 }) }), env);
  assert.equal(response.status, 200);
  result = await (await worker.fetch(req("/api/public?from=2026-09-28&to=2026-09-28"), env)).json();
  assert.equal(result.days[0].night, "available");
});
