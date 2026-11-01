import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../worker/dist/index.js";

const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await webcrypto.subtle.exportKey("jwk", publicKey), kid: "unreflected-test-key" };
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => String(url).includes("www.googleapis.com/oauth2/v3/certs") ? Response.json({ keys: [jwk] }) : originalFetch(url);
const b64 = value => Buffer.from(value).toString("base64url");
async function credential() {
  const header = b64(JSON.stringify({ alg: "RS256", kid: jwk.kid }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({ iss: "https://accounts.google.com", aud: "test-client", email: "owner@example.com", email_verified: true, sub: "test-owner", iat: now, exp: now + 300 }));
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, Buffer.from(`${header}.${payload}`));
  return `${header}.${payload}.${b64(Buffer.from(signature))}`;
}

const legacy = {
  rules: [{ from: "2026-11-30", to: "2026-12-31", weekdays: [0, 1, 2, 3, 4, 5, 6], parts: ["night"], status: "tentative" }],
  overrides: {
    "2026-12-30": { am: "tentative", pm: "busy", night: "available" },
    "2026-12-31": { am: "busy" }
  },
  locations: { "2026-12-30": "三重県" }
};
let row = { id: 1, version: 25, data: JSON.stringify(legacy), previous: null, published_at: "2026-11-01T10:51:12.181Z", previous_published_at: null, legacy_checked_at: "2026-09-25" };
const env = {
  PUBLIC_ORIGIN: "https://minoru-s.github.io", GOOGLE_CLIENT_ID: "test-client", SESSION_SECRET: "long-local-test-secret-xxxxxxxxxxxxxxxx", OWNER_EMAIL: "owner@example.com",
  DB: { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() {
    if (sql.startsWith("SELECT")) return row;
    if (row.version !== args[1]) return null;
    row.previous = row.data; row.data = args[0]; row.version++; row.published_at = new Date().toISOString();
    return { version: row.version, published_at: row.published_at };
  } }; } }
};
const req = (path, options = {}) => new Request(`https://api.example.com${path}`, options);
const publicDays = async (from, to) => {
  const response = await worker.fetch(req(`/api/public?from=${from}&to=${to}`), env);
  assert.equal(response.status, 200);
  return (await response.json()).days;
};

test("旧データの12月以降の△を未反映にし、×・○・滞在場所を保つ", async () => {
  const [nov30, dec1] = await publicDays("2026-11-30", "2026-12-01");
  assert.equal(nov30.night, "tentative", "11月側の一括設定は△のまま");
  assert.equal(dec1.night, "unreflected", "同じ一括設定でも12月側は未反映");
  const [dec30, dec31] = await publicDays("2026-12-30", "2026-12-31");
  assert.deepEqual(dec30, { date: "2026-12-30", am: "unreflected", pm: "busy", night: "available", location: "三重県" });
  assert.deepEqual(dec31, { date: "2026-12-31", am: "busy", pm: "unreflected", night: "unreflected" });
  const [jan1] = await publicDays("2027-01-01", "2027-01-01");
  assert.deepEqual(jan1, { date: "2027-01-01", am: "unreflected", pm: "unreflected", night: "unreflected" });
});

test("未反映を保存でき、保存後に選んだ△は調整中として公開される", async () => {
  const loggedIn = await worker.fetch(req("/api/admin/login", { method: "POST", headers: { Origin: "https://api.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ credential: await credential() }) }), env);
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get("Set-Cookie").split(";")[0];
  const headers = { Cookie: cookie, Origin: "https://api.example.com", "Content-Type": "application/json" };
  const stateResponse = await worker.fetch(req("/api/admin/state", { headers: { Cookie: cookie } }), env);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.data.statusVersion, 2);
  const draft = structuredClone(state.data);
  draft.overrides["2026-12-30"].am = "unreflected";
  draft.overrides["2027-01-01"] = { am: "tentative", pm: "unreflected" };
  let response = await worker.fetch(req("/api/admin/publish", { method: "POST", headers, body: JSON.stringify({ version: state.version, data: draft }) }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await publicDays("2027-01-01", "2027-01-01"))[0], { date: "2027-01-01", am: "tentative", pm: "unreflected", night: "unreflected" });
  const invalid = structuredClone(draft);
  invalid.overrides["2027-01-02"] = { am: "unknown" };
  response = await worker.fetch(req("/api/admin/publish", { method: "POST", headers, body: JSON.stringify({ version: row.version, data: invalid }) }), env);
  assert.equal(response.status, 400);
});
