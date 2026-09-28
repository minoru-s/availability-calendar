const PARTS = ["am", "pm", "night"];
const STATUSES = ["available", "tentative", "busy"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_MS = 86400000;
const noCache = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function response(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...noCache, "Content-Type": "application/json; charset=utf-8", ...extra } });
}
function dateValue(iso) {
  if (!ISO.test(iso)) return NaN;
  const value = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === iso ? value : NaN;
}
function dates(from, to, max = 366) {
  const first = dateValue(from), last = dateValue(to);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first >= max * WEEK_MS) throw new Error("日付範囲が正しくありません");
  const result = [];
  for (let time = first; time <= last; time += WEEK_MS) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}
function validate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("データ形式が正しくありません");
  const { rules, overrides, locations } = data;
  if (!Array.isArray(rules) || rules.length > 300 || !overrides || typeof overrides !== "object" || Array.isArray(overrides) || !locations || typeof locations !== "object" || Array.isArray(locations)) throw new Error("データ数または形式が正しくありません");
  for (const rule of rules) {
    dates(rule.from, rule.to);
    if (!Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.some(x => !Number.isInteger(x) || x < 0 || x > 6) || !Array.isArray(rule.parts) || !rule.parts.length || rule.parts.some(x => !PARTS.includes(x)) || !STATUSES.includes(rule.status)) throw new Error("一括設定が正しくありません");
  }
  if (Object.keys(overrides).length > 5000 || Object.keys(locations).length > 5000) throw new Error("登録数が多すぎます");
  for (const [day, slots] of Object.entries(overrides)) {
    if (!Number.isFinite(dateValue(day)) || !slots || typeof slots !== "object" || Array.isArray(slots) || Object.entries(slots).some(([part, status]) => !PARTS.includes(part) || !STATUSES.includes(status))) throw new Error("個別指定が正しくありません");
  }
  for (const [day, label] of Object.entries(locations)) {
    if (!Number.isFinite(dateValue(day)) || typeof label !== "string" || !label.trim() || label.length > 40 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error("滞在場所が正しくありません");
  }
  return { rules, overrides, locations };
}
function status(data, day, part) {
  if (data.overrides[day]?.[part]) return data.overrides[day][part];
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  let value = "tentative";
  for (const rule of data.rules) if (day >= rule.from && day <= rule.to && rule.weekdays.includes(weekday) && rule.parts.includes(part)) value = rule.status;
  return value;
}
function changedSlots(before, after) {
  const days = new Set([...Object.keys(before.overrides), ...Object.keys(after.overrides), ...Object.keys(before.locations), ...Object.keys(after.locations)]);
  for (const rule of [...before.rules, ...after.rules]) for (const day of dates(rule.from, rule.to)) days.add(day);
  let count = 0;
  for (const day of days) {
    for (const part of PARTS) if (status(before, day, part) !== status(after, day, part)) count++;
    if ((before.locations[day] || "") !== (after.locations[day] || "")) count++;
  }
  return count;
}
function b64url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), x => x.charCodeAt(0));
}
function encode(value) { return btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
const sessionName = "__Host-availability_session";
let cachedKeys;
async function verifyGoogleToken(token, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.OWNER_EMAIL || !token) return false;
  if (!token) return false;
  try {
    const [head, body, signature, rest] = token.split(".");
    if (!head || !body || !signature || rest) return false;
    const header = JSON.parse(new TextDecoder().decode(b64url(head)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(body)));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const now = Math.floor(Date.now() / 1000);
    if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) || payload.aud !== env.GOOGLE_CLIENT_ID || payload.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase() || payload.email_verified !== true || typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= now || typeof payload.iat !== "number" || payload.iat > now + 60) return false;
    if (!cachedKeys || cachedKeys.until < Date.now()) {
      const certs = await fetch("https://www.googleapis.com/oauth2/v3/certs");
      if (!certs.ok) return false;
      cachedKeys = { keys: (await certs.json()).keys, until: Date.now() + 300000 };
    }
    const jwk = cachedKeys.keys.find(key => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(signature), new TextEncoder().encode(`${head}.${body}`));
  } catch { return false; }
}
async function hmac(value, env) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function authorized(request, env) {
  if (!env.SESSION_SECRET || !env.OWNER_EMAIL) return false;
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${sessionName}=`))?.slice(sessionName.length + 1);
  if (!cookie) return false;
  const [body, signature, extra] = cookie.split(".");
  if (!body || !signature || extra) return false;
  try {
    const expected = await hmac(body, env);
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    if (mismatch) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64url(body)));
    return payload.email === env.OWNER_EMAIL.toLowerCase() && Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
async function current(env) {
  const row = await env.DB.prepare("SELECT * FROM calendar WHERE id=1").first();
  if (!row) throw new Error("初期データがまだ登録されていません");
  return row;
}
const adminHtml = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>空き状況を編集</title><link rel="stylesheet" href="/admin/styles.css"></head><body><main id="app"></main><script type="module" src="/admin/app.js"></script></body></html>`;
const loginHtml = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>管理者ログイン</title><link rel="stylesheet" href="/admin/styles.css"><script src="https://accounts.google.com/gsi/client" async defer></script><script src="/admin/login.js" defer></script></head><body><main class="login"><h1>空き状況を編集</h1><p>本人のGoogleアカウントでログインしてください。</p><div id="google-button"></div><p id="login-error" role="alert"></p></main></body></html>`;
const loginJs = `window.addEventListener('load',()=>{google.accounts.id.initialize({client_id:__GOOGLE_CLIENT_ID__,callback:async({credential})=>{try{const response=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential})});if(!response.ok)throw Error('ログインできませんでした');location.replace('/admin')}catch(error){document.getElementById('login-error').textContent=error.message}}});google.accounts.id.renderButton(document.getElementById('google-button'),{theme:'outline',size:'large',text:'signin_with'});});`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.pathname === "/api/public" && request.method === "OPTIONS") {
      return origin === env.PUBLIC_ORIGIN ? new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET", ...noCache } }) : response({ error: "許可されていません" }, 403);
    }
    try {
      if (url.pathname === "/api/public" && request.method === "GET") {
        const days = dates(url.searchParams.get("from"), url.searchParams.get("to"));
        const row = await current(env), data = JSON.parse(row.data);
        const result = days.map(day => ({ date: day, am: status(data, day, "am"), pm: status(data, day, "pm"), night: status(data, day, "night"), ...(data.locations[day] ? { location: data.locations[day] } : {}) }));
        return response({ version: row.version, publishedAt: row.published_at, legacyCheckedAt: row.legacy_checked_at, days: result }, 200, origin === env.PUBLIC_ORIGIN ? { "Access-Control-Allow-Origin": origin } : {});
      }
      if (url.pathname === "/admin/login" && request.method === "GET") return new Response(loginHtml, { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache, "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; img-src 'self' https://accounts.google.com data:; base-uri 'none'; frame-ancestors 'none'" } });
      if (url.pathname === "/admin/styles.css" && request.method === "GET") return new Response(ADMIN_CSS, { headers: { "Content-Type": "text/css; charset=utf-8", ...noCache } });
      if (url.pathname === "/admin/login.js" && request.method === "GET") return new Response(loginJs.replace("__GOOGLE_CLIENT_ID__", JSON.stringify(env.GOOGLE_CLIENT_ID || "")), { headers: { "Content-Type": "text/javascript; charset=utf-8", ...noCache } });
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        if (origin !== url.origin || request.headers.get("content-type")?.split(";")[0] !== "application/json" || !env.SESSION_SECRET) return response({ error: "ログインできませんでした" }, 403);
        const raw = await request.text();
        if (raw.length > 10000) return response({ error: "ログインできませんでした" }, 403);
        if (!await verifyGoogleToken(JSON.parse(raw).credential, env)) return response({ error: "このアカウントではログインできません" }, 403);
        const body = encode(JSON.stringify({ email: env.OWNER_EMAIL.toLowerCase(), exp: Math.floor(Date.now() / 1000) + 86400 }));
        const signature = await hmac(body, env);
        return response({ ok: true }, 200, { "Set-Cookie": `${sessionName}=${body}.${signature}; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax` });
      }
      if (url.pathname === "/api/admin/logout" && request.method === "POST") {
        if (origin !== url.origin) return response({ error: "許可されていません" }, 403);
        return response({ ok: true }, 200, { "Set-Cookie": `${sessionName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax` });
      }
      if (!url.pathname.startsWith("/admin") && !url.pathname.startsWith("/api/admin")) return response({ error: "見つかりません" }, 404);
      if (!await authorized(request, env)) return url.pathname === "/admin" ? Response.redirect(`${url.origin}/admin/login`, 302) : response({ error: "ログインが必要です" }, 403);
      if (url.pathname === "/admin" && request.method === "GET") return new Response(adminHtml, { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache, "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });
      if (url.pathname === "/admin/app.js" && request.method === "GET") return new Response(ADMIN_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", ...noCache } });
      if (url.pathname === "/api/admin/state" && request.method === "GET") {
        const row = await current(env);
        return response({ version: row.version, publishedAt: row.published_at, legacyCheckedAt: row.legacy_checked_at, data: JSON.parse(row.data), canRestore: !!row.previous });
      }
      if (url.pathname === "/api/admin/restore-preview" && request.method === "GET") {
        const row = await current(env);
        if (!row.previous) return response({ error: "復元できる公開版がありません" }, 404);
        return response({ version: row.version, previousPublishedAt: row.previous_published_at, changeCount: changedSlots(JSON.parse(row.data), JSON.parse(row.previous)) });
      }
      if (url.pathname === "/api/admin/publish" && request.method === "POST") {
        if (origin !== url.origin || request.headers.get("content-type")?.split(";")[0] !== "application/json") return response({ error: "送信元が正しくありません" }, 403);
        const raw = await request.text();
        if (raw.length > 500000) return response({ error: "データが大きすぎます" }, 413);
        const input = JSON.parse(raw), data = validate(input.data);
        if (!Number.isSafeInteger(input.version)) return response({ error: "版番号が正しくありません" }, 400);
        const saved = await env.DB.prepare("UPDATE calendar SET previous=data, previous_published_at=published_at, data=?, version=version+1, published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND version=? RETURNING version,published_at").bind(JSON.stringify(data), input.version).first();
        return saved ? response({ version: saved.version, publishedAt: saved.published_at }) : response({ error: "別の画面で更新されています。再読み込みして確認してください" }, 409);
      }
      if (url.pathname === "/api/admin/restore" && request.method === "POST") {
        if (origin !== url.origin || request.headers.get("content-type")?.split(";")[0] !== "application/json") return response({ error: "送信元が正しくありません" }, 403);
        const input = await request.json();
        if (!Number.isSafeInteger(input.version)) return response({ error: "版番号が正しくありません" }, 400);
        const saved = await env.DB.prepare("UPDATE calendar SET data=previous, previous=data, previous_published_at=published_at, version=version+1, published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND version=? AND previous IS NOT NULL RETURNING version,published_at").bind(input.version).first();
        return saved ? response({ version: saved.version, publishedAt: saved.published_at }) : response({ error: "復元できません。公開状態を確認してください" }, 409);
      }
      return response({ error: "見つかりません" }, 404);
    } catch (error) {
      if (error instanceof SyntaxError || error.message?.includes("正しくありません") || error.message?.includes("多すぎます")) return response({ error: error.message }, 400);
      return response({ error: "処理に失敗しました" }, 503);
    }
  }
};

// Replaced by the local build script with literal strings for the protected editor.
const ADMIN_JS = __ADMIN_JS__;
const ADMIN_CSS = __ADMIN_CSS__;
