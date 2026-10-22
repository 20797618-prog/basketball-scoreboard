var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// account/api/auth/request-code.js
var request_code_exports = {};
__export(request_code_exports, {
  onRequest: () => onRequest
});

// account/_account_lib.js
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}
__name(json, "json");
function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
__name(handleOptions, "handleOptions");
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
__name(b64ToBytes, "b64ToBytes");
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
__name(safeEqual, "safeEqual");
function validEmail(email) {
  return typeof email === "string" && email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
__name(validEmail, "validEmail");
function normEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
__name(normEmail, "normEmail");
function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomHex, "randomHex");
function randomCode() {
  return String(Math.floor(1e5 + Math.random() * 9e5));
}
__name(randomCode, "randomCode");
var PBKDF2_ITER = 1e5;
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
__name(bufToB64, "bufToB64");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
    key,
    256
  );
  return { s: bufToB64(salt), h: bufToB64(hash), i: PBKDF2_ITER };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, record) {
  if (!record || !record.s || !record.h) return false;
  const salt = b64ToBytes(record.s);
  const iterations = record.i || PBKDF2_ITER;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return safeEqual(bufToB64(hash), record.h);
}
__name(verifyPassword, "verifyPassword");
function validPassword(pwd) {
  return typeof pwd === "string" && /^\d{6}$/.test(pwd);
}
__name(validPassword, "validPassword");
async function resolveSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+([A-Za-z0-9]+)$/);
  if (!m) return null;
  const token = m[1];
  const raw = await env.ACCOUNTS_KV.get("session:" + token);
  if (!raw) return null;
  try {
    const sess = JSON.parse(raw);
    if (!sess.email || sess.exp && sess.exp < Date.now()) return null;
    return { token, email: sess.email };
  } catch (e) {
    return null;
  }
}
__name(resolveSession, "resolveSession");
var SESSION_TTL = 60 * 60 * 24 * 30;
var CODE_TTL = 10 * 60;
var RATE_TTL = 60;
var PWD_LOCK_MAX = 5;
var PWD_LOCK_TTL = 15 * 60;

// account/_mail.js
import { connect } from "cloudflare:sockets";
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
__name(b64utf8, "b64utf8");
function wrapB64(b64, width = 76) {
  const out = [];
  for (let i = 0; i < b64.length; i += width) out.push(b64.slice(i, i + width));
  return out.join("\r\n");
}
__name(wrapB64, "wrapB64");
function encodeWord(str) {
  return "=?UTF-8?B?" + b64utf8(str) + "?=";
}
__name(encodeWord, "encodeWord");
async function readLine(reader, buf) {
  while (buf.s.indexOf("\r\n") === -1) {
    const { value, done } = await reader.read();
    if (done) break;
    buf.s += new TextDecoder().decode(value);
  }
  const idx = buf.s.indexOf("\r\n");
  if (idx === -1) return { line: buf.s, closed: true };
  const line = buf.s.slice(0, idx);
  buf.s = buf.s.slice(idx + 2);
  return { line, closed: false };
}
__name(readLine, "readLine");
async function readResponse(reader, buf) {
  let lastCode = 0;
  for (; ; ) {
    const { line, closed } = await readLine(reader, buf);
    if (closed) break;
    if (line.length >= 3 && /^\d{3}/.test(line)) lastCode = parseInt(line.slice(0, 3), 10);
    if (line.length > 3 && line[3] === " ") break;
  }
  return lastCode;
}
__name(readResponse, "readResponse");
async function cmd(writer, str) {
  await writer.write(new TextEncoder().encode(str + "\r\n"));
}
__name(cmd, "cmd");
function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + " \u8D85\u65F6")), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
__name(withTimeout, "withTimeout");
async function sendCode(env, to, code) {
  const host = env.MAIL_HOST || "smtp.qq.com";
  const port = parseInt(env.MAIL_PORT || "465", 10);
  const user = env.MAIL_USER || "";
  const pass = env.MAIL_PASS || "";
  const fromAddr = env.MAIL_FROM || user;
  const appName = env.MAIL_FROM_NAME || "\u6211\u7684\u5E94\u7528";
  if (!user || !pass) throw new Error("SMTP \u672A\u914D\u7F6E");
  const isStartTls = port === 587;
  const socket = connect(
    { hostname: host, port },
    { secureTransport: isStartTls ? "starttls" : "on" }
  );
  await withTimeout(socket.opened, 15e3, "TCP/TLS \u8FDE\u63A5");
  const buf = { s: "" };
  let writer = socket.writable.getWriter();
  let reader = socket.readable.getReader();
  let closed = socket;
  try {
    const greet = await withTimeout(readResponse(reader, buf), 15e3, "\u8BFB\u53D6\u95EE\u5019");
    if (greet !== 220) {
      throw new Error("SMTP \u8FDE\u63A5\u5931\u8D25(greet=" + greet + ', recv="' + buf.s.slice(0, 120).replace(/\r|\n/g, " ") + '")');
    }
    await withTimeout(cmd(writer, "EHLO nav.pages.dev"), 1e4, "EHLO");
    await withTimeout(readResponse(reader, buf), 1e4, "EHLO\u54CD\u5E94");
    if (isStartTls) {
      await withTimeout(cmd(writer, "STARTTLS"), 1e4, "STARTTLS");
      const st = await withTimeout(readResponse(reader, buf), 1e4, "STARTTLS\u54CD\u5E94");
      if (st !== 220) throw new Error("STARTTLS \u88AB\u62D2(code " + st + ")");
      const tls = await withTimeout(socket.startTls(), 15e3, "TLS \u5347\u7EA7");
      try {
        await writer.close();
      } catch (e) {
      }
      closed = tls;
      writer = tls.writable.getWriter();
      reader = tls.readable.getReader();
      buf.s = "";
      await withTimeout(cmd(writer, "EHLO nav.pages.dev"), 1e4, "EHLO(2)");
      await withTimeout(readResponse(reader, buf), 1e4, "EHLO\u54CD\u5E94(2)");
    }
    await withTimeout(cmd(writer, "AUTH PLAIN " + b64utf8("\0" + user + "\0" + pass)), 1e4, "AUTH");
    const authCode = await withTimeout(readResponse(reader, buf), 15e3, "AUTH\u54CD\u5E94");
    if (authCode !== 235) throw new Error("SMTP \u8BA4\u8BC1\u5931\u8D25(code " + authCode + ")");
    await withTimeout(cmd(writer, "MAIL FROM:<" + fromAddr + ">"), 1e4, "MAIL FROM");
    if (await withTimeout(readResponse(reader, buf), 1e4, "MAIL FROM\u54CD\u5E94") !== 250) throw new Error("MAIL FROM \u88AB\u62D2");
    await withTimeout(cmd(writer, "RCPT TO:<" + to + ">"), 1e4, "RCPT TO");
    if (await withTimeout(readResponse(reader, buf), 1e4, "RCPT TO\u54CD\u5E94") !== 250) throw new Error("RCPT TO \u88AB\u62D2");
    await withTimeout(cmd(writer, "DATA"), 1e4, "DATA");
    if (await withTimeout(readResponse(reader, buf), 1e4, "DATA\u54CD\u5E94") !== 354) throw new Error("DATA \u88AB\u62D2");
    const subject = "\u3010" + appName + "\u3011\u60A8\u7684\u767B\u5F55\u9A8C\u8BC1\u7801\uFF1A" + code;
    const text = "\u60A8\u7684\u767B\u5F55\u9A8C\u8BC1\u7801\u662F\uFF1A" + code + "\r\n\u9A8C\u8BC1\u7801 10 \u5206\u949F\u5185\u6709\u6548\u3002\u82E5\u975E\u672C\u4EBA\u64CD\u4F5C\u8BF7\u5FFD\u7565\u672C\u90AE\u4EF6\u3002";
    const headers = "From: " + encodeWord(appName) + " <" + fromAddr + ">\r\nTo: <" + to + ">\r\nSubject: " + encodeWord(subject) + "\r\nDate: " + (/* @__PURE__ */ new Date()).toUTCString() + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + wrapB64(b64utf8(text)) + "\r\n.\r\n";
    await withTimeout(writer.write(new TextEncoder().encode(headers)), 15e3, "\u5199\u5165\u90AE\u4EF6");
    if (await withTimeout(readResponse(reader, buf), 2e4, "\u53D1\u9001\u54CD\u5E94") !== 250) throw new Error("\u53D1\u9001\u88AB\u62D2");
    await cmd(writer, "QUIT").catch(() => {
    });
    return { ok: true };
  } finally {
    try {
      await writer.close();
    } catch (e) {
    }
    try {
      socket.close();
    } catch (e) {
    }
    if (closed !== socket) {
      try {
        closed.close();
      } catch (e) {
      }
    }
  }
}
__name(sendCode, "sendCode");

// account/api/auth/request-code.js
async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await request.json();
    const email = normEmail(body && body.email);
    if (!validEmail(email)) {
      return json({ error: "invalid_email", message: "\u90AE\u7BB1\u683C\u5F0F\u4E0D\u6B63\u786E" }, 400);
    }
    const last = await env.ACCOUNTS_KV.get("sent:" + email);
    if (last) {
      return json({ error: "rate_limited", message: "\u53D1\u9001\u592A\u9891\u7E41\uFF0C\u8BF7 60 \u79D2\u540E\u518D\u8BD5" }, 429);
    }
    const code = randomCode();
    await env.ACCOUNTS_KV.put("code:" + email, code, { expirationTtl: CODE_TTL });
    await env.ACCOUNTS_KV.put("sent:" + email, "1", { expirationTtl: RATE_TTL });
    const mailEnabled = env.MAIL_ENABLED === "true" && !!(env.MAIL_PASS && env.MAIL_USER);
    if (mailEnabled) {
      try {
        await sendCode(env, email, code);
        return json({ ok: true, dev: false });
      } catch (e) {
        await env.ACCOUNTS_KV.delete("sent:" + email);
        console.error("send mail failed", String(e));
        const detail = String(e && e.message ? e.message : e).slice(0, 160);
        return json({ error: "mail_failed", message: "\u90AE\u4EF6\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u68C0\u67E5\u90AE\u7BB1", detail }, 500);
      }
    }
    console.warn("[dev] \u90AE\u4EF6\u672A\u914D\u7F6E\uFF0C\u9A8C\u8BC1\u7801\u76F4\u63A5\u8FD4\u56DE:", email, code);
    return json({ ok: true, dev: true, code });
  } catch (e) {
    return json({ error: "bad_request", message: "\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF" }, 400);
  }
}
__name(onRequest, "onRequest");

// account/api/auth/verify-code.js
var verify_code_exports = {};
__export(verify_code_exports, {
  onRequest: () => onRequest2
});
async function onRequest2(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await request.json();
    const email = normEmail(body && body.email);
    const code = String(body && body.code || "").trim();
    if (!validEmail(email) || !/^\d{6}$/.test(code)) {
      return json({ error: "invalid_input", message: "\u90AE\u7BB1\u6216\u9A8C\u8BC1\u7801\u683C\u5F0F\u4E0D\u6B63\u786E" }, 400);
    }
    const stored = await env.ACCOUNTS_KV.get("code:" + email);
    if (!stored || !safeEqual(stored, code)) {
      return json({ error: "bad_code", message: "\u9A8C\u8BC1\u7801\u9519\u8BEF\u6216\u5DF2\u8FC7\u671F" }, 401);
    }
    await env.ACCOUNTS_KV.delete("code:" + email);
    await env.ACCOUNTS_KV.delete("sent:" + email);
    const existing = await env.ACCOUNTS_KV.get("user:" + email);
    const isNewUser = !existing;
    let user = null;
    if (existing) {
      try {
        user = JSON.parse(existing);
      } catch (e) {
      }
    }
    if (!user || !user.email) {
      user = { email, created_at: (/* @__PURE__ */ new Date()).toISOString() };
      await env.ACCOUNTS_KV.put("user:" + email, JSON.stringify(user));
    }
    const token = randomHex(32);
    const exp = Date.now() + SESSION_TTL * 1e3;
    await env.ACCOUNTS_KV.put("session:" + token, JSON.stringify({ email, exp }), {
      expirationTtl: SESSION_TTL
    });
    const hasPassword = !!(user.pwd && user.pwd.h);
    return json({ ok: true, token, email, isNewUser, hasPassword });
  } catch (e) {
    return json({ error: "bad_request", message: "\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF" }, 400);
  }
}
__name(onRequest2, "onRequest");

// account/api/auth/login-password.js
var login_password_exports = {};
__export(login_password_exports, {
  onRequest: () => onRequest3
});
async function onRequest3(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await request.json();
    const email = normEmail(body && body.email);
    const password = String(body && body.password || "");
    if (!validEmail(email) || !validPassword(password)) {
      return json({ error: "invalid_input", message: "\u8BF7\u8F93\u5165\u90AE\u7BB1\u548C 6 \u4F4D\u6570\u5B57\u5BC6\u7801" }, 400);
    }
    const lockRaw = await env.ACCOUNTS_KV.get("pwfail:" + email);
    const fails = lockRaw ? parseInt(lockRaw, 10) || 0 : 0;
    if (fails >= PWD_LOCK_MAX) {
      return json({ error: "locked", message: "\u9519\u8BEF\u6B21\u6570\u8FC7\u591A\u5DF2\u4E34\u65F6\u9501\u5B9A\uFF0C\u8BF7 15 \u5206\u949F\u540E\u518D\u8BD5\uFF0C\u6216\u6539\u7528\u9A8C\u8BC1\u7801\u767B\u5F55" }, 429);
    }
    const raw = await env.ACCOUNTS_KV.get("user:" + email);
    let user = null;
    if (raw) {
      try {
        user = JSON.parse(raw);
      } catch (e) {
      }
    }
    if (!user || !user.email) {
      return json({ error: "user_not_found", message: "\u8BE5\u90AE\u7BB1\u5C1A\u672A\u6CE8\u518C\uFF0C\u8BF7\u5148\u7528\u9A8C\u8BC1\u7801\u767B\u5F55" }, 400);
    }
    if (!(user.pwd && user.pwd.h)) {
      return json({ error: "no_password", message: "\u8BE5\u8D26\u53F7\u5C1A\u672A\u8BBE\u7F6E\u5BC6\u7801\uFF0C\u8BF7\u5148\u7528\u9A8C\u8BC1\u7801\u767B\u5F55" }, 400);
    }
    const ok = await verifyPassword(password, user.pwd);
    if (!ok) {
      const next = fails + 1;
      await env.ACCOUNTS_KV.put("pwfail:" + email, String(next), { expirationTtl: PWD_LOCK_TTL });
      const remain = PWD_LOCK_MAX - next;
      return json({
        error: "bad_password",
        message: remain > 0 ? "\u5BC6\u7801\u9519\u8BEF\uFF0C\u8FD8\u53EF\u5C1D\u8BD5 " + remain + " \u6B21" : "\u9519\u8BEF\u6B21\u6570\u8FC7\u591A\u5DF2\u4E34\u65F6\u9501\u5B9A\uFF0C\u8BF7 15 \u5206\u949F\u540E\u518D\u8BD5",
        attemptsLeft: Math.max(remain, 0)
      }, 401);
    }
    await env.ACCOUNTS_KV.delete("pwfail:" + email);
    const token = randomHex(32);
    const exp = Date.now() + SESSION_TTL * 1e3;
    await env.ACCOUNTS_KV.put("session:" + token, JSON.stringify({ email, exp }), {
      expirationTtl: SESSION_TTL
    });
    return json({ ok: true, token, email, hasPassword: true });
  } catch (e) {
    return json({ error: "bad_request", message: "\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF" }, 400);
  }
}
__name(onRequest3, "onRequest");

// account/api/auth/set-password.js
var set_password_exports = {};
__export(set_password_exports, {
  onRequest: () => onRequest4
});
async function onRequest4(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const sess = await resolveSession(request, env);
  if (!sess) {
    return json({ error: "unauthorized", message: "\u8BF7\u5148\u767B\u5F55" }, 401);
  }
  const email = sess.email;
  try {
    const body = await request.json();
    const password = String(body && body.password || "");
    if (!validPassword(password)) {
      return json({ error: "invalid_password", message: "\u5BC6\u7801\u9700\u4E3A 6 \u4F4D\u6570\u5B57" }, 400);
    }
    const raw = await env.ACCOUNTS_KV.get("user:" + email);
    let user = null;
    if (raw) {
      try {
        user = JSON.parse(raw);
      } catch (e) {
      }
    }
    if (!user || !user.email) {
      user = { email, created_at: (/* @__PURE__ */ new Date()).toISOString() };
    }
    user.pwd = await hashPassword(password);
    user.pwd_set_at = (/* @__PURE__ */ new Date()).toISOString();
    await env.ACCOUNTS_KV.put("user:" + email, JSON.stringify(user));
    return json({ ok: true, hasPassword: true });
  } catch (e) {
    console.error("set-password error", String(e));
    return json({ error: "bad_request", message: "\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF", detail: String(e && e.message ? e.message : e).slice(0, 160) }, 400);
  }
}
__name(onRequest4, "onRequest");

// account/api/auth/me.js
var me_exports = {};
__export(me_exports, {
  onRequest: () => onRequest5
});
async function onRequest5(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  const sess = await resolveSession(request, env);
  if (!sess) return json({ error: "unauthorized" }, 401);
  const raw = await env.ACCOUNTS_KV.get("user:" + sess.email);
  let user = { email: sess.email, hasPassword: false };
  if (raw) {
    try {
      const u = JSON.parse(raw);
      user = Object.assign({}, u, { email: u.email || sess.email, hasPassword: !!(u.pwd && u.pwd.h) });
    } catch (e) {
    }
  }
  return json({ ok: true, user });
}
__name(onRequest5, "onRequest");

// src/index.ts
var json2 = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    // 跨域时必须允许 authorization，否则从 WorkBuddy 托管域名发起的请求会在预检阶段被浏览器拦掉
    "access-control-allow-headers": "content-type, authorization"
  }
}), "json");
var asBoolInt = /* @__PURE__ */ __name((value) => value ? 1 : 0, "asBoolInt");
var SHARED_SPACE_CODE = "team";
var resolveSyncCode = /* @__PURE__ */ __name((_session) => SHARED_SPACE_CODE, "resolveSyncCode");
var chunks = /* @__PURE__ */ __name((arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}, "chunks");
async function runBatches(db, statements) {
  for (const batch of chunks(statements, 100)) {
    await db.batch(batch);
  }
}
__name(runBatches, "runBatches");
async function upsertAthletes(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO athletes (sync_code, id, name, is_deleted, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       name = excluded.name,
       is_deleted = excluded.is_deleted,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id),
        String(r.name ?? ""),
        asBoolInt(r.isDeleted),
        Number(r.createdAt ?? 0),
        Number(r.updatedAt ?? 0)
      )
    )
  );
}
__name(upsertAthletes, "upsertAthletes");
async function upsertMatches(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO matches (sync_code, id, title, status, created_at, finished_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       created_at = excluded.created_at,
       finished_at = excluded.finished_at`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id),
        String(r.title ?? ""),
        String(r.status ?? "active"),
        Number(r.createdAt ?? 0),
        r.finishedAt == null ? null : Number(r.finishedAt)
      )
    )
  );
}
__name(upsertMatches, "upsertMatches");
async function upsertMatchPlayers(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO match_players (sync_code, id, match_id, athlete_id, join_order)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       match_id = excluded.match_id,
       athlete_id = excluded.athlete_id,
       join_order = excluded.join_order`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id),
        String(r.matchId ?? ""),
        String(r.athleteId ?? ""),
        Number(r.joinOrder ?? 0)
      )
    )
  );
}
__name(upsertMatchPlayers, "upsertMatchPlayers");
async function upsertRounds(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO rounds (sync_code, id, match_id, round_no, phase, overtime_seq, parent_round_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       match_id = excluded.match_id,
       round_no = excluded.round_no,
       phase = excluded.phase,
       overtime_seq = excluded.overtime_seq,
       parent_round_id = excluded.parent_round_id,
       created_at = excluded.created_at`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id),
        String(r.matchId ?? ""),
        Number(r.roundNo ?? 0),
        String(r.phase ?? "regular"),
        Number(r.overtimeSeq ?? 0),
        r.parentRoundId == null ? null : String(r.parentRoundId),
        Number(r.createdAt ?? 0)
      )
    )
  );
}
__name(upsertRounds, "upsertRounds");
async function upsertRoundStats(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO round_stats (sync_code, id, round_id, match_id, athlete_id, attempts, hits, hit_rate, rank_group, point_delta, cola_delta, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       round_id = excluded.round_id,
       match_id = excluded.match_id,
       athlete_id = excluded.athlete_id,
       attempts = excluded.attempts,
       hits = excluded.hits,
       hit_rate = excluded.hit_rate,
       rank_group = excluded.rank_group,
       point_delta = excluded.point_delta,
       cola_delta = excluded.cola_delta,
       created_at = excluded.created_at`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id),
        String(r.roundId ?? ""),
        String(r.matchId ?? ""),
        String(r.athleteId ?? ""),
        Number(r.attempts ?? 0),
        Number(r.hits ?? 0),
        Number(r.hitRate ?? 0),
        String(r.rankGroup ?? "pending"),
        Number(r.pointDelta ?? 0),
        Number(r.colaDelta ?? 0),
        Number(r.createdAt ?? 0)
      )
    )
  );
}
__name(upsertRoundStats, "upsertRoundStats");
async function upsertColaLedger(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO cola_ledger (sync_code, id, type, from_athlete_id, to_athlete_id, amount, match_id, round_id, note, created_at, operator)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       type = excluded.type,
       from_athlete_id = excluded.from_athlete_id,
       to_athlete_id = excluded.to_athlete_id,
       amount = excluded.amount,
       match_id = excluded.match_id,
       round_id = excluded.round_id,
       note = excluded.note,
       created_at = excluded.created_at,
       operator = excluded.operator`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id),
        String(r.type ?? "transfer"),
        r.fromAthleteId == null ? null : String(r.fromAthleteId),
        r.toAthleteId == null ? null : String(r.toAthleteId),
        Number(r.amount ?? 0),
        r.matchId == null ? null : String(r.matchId),
        r.roundId == null ? null : String(r.roundId),
        r.note == null ? null : String(r.note),
        Number(r.createdAt ?? 0),
        String(r.operator ?? "system")
      )
    )
  );
}
__name(upsertColaLedger, "upsertColaLedger");
var mapAthlete = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  name: r.name,
  isDeleted: !!r.is_deleted,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at)
}), "mapAthlete");
var mapMatch = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  title: r.title,
  status: r.status,
  createdAt: Number(r.created_at),
  finishedAt: r.finished_at == null ? null : Number(r.finished_at)
}), "mapMatch");
var mapMatchPlayer = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  matchId: r.match_id,
  athleteId: r.athlete_id,
  joinOrder: Number(r.join_order)
}), "mapMatchPlayer");
var mapRound = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  matchId: r.match_id,
  roundNo: Number(r.round_no),
  phase: r.phase,
  overtimeSeq: Number(r.overtime_seq),
  parentRoundId: r.parent_round_id,
  createdAt: Number(r.created_at)
}), "mapRound");
var mapRoundStat = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  roundId: r.round_id,
  matchId: r.match_id,
  athleteId: r.athlete_id,
  attempts: Number(r.attempts),
  hits: Number(r.hits),
  hitRate: Number(r.hit_rate),
  rankGroup: r.rank_group,
  pointDelta: Number(r.point_delta),
  colaDelta: Number(r.cola_delta),
  createdAt: Number(r.created_at)
}), "mapRoundStat");
var mapColaLedger = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  type: r.type,
  fromAthleteId: r.from_athlete_id,
  toAthleteId: r.to_athlete_id,
  amount: Number(r.amount),
  matchId: r.match_id,
  roundId: r.round_id,
  note: r.note,
  createdAt: Number(r.created_at),
  operator: r.operator
}), "mapColaLedger");
async function upsertAthleteClaims(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO athlete_claims (sync_code, athlete_id, claim_code, claimed_by, claimed_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(sync_code, athlete_id) DO UPDATE SET
       claim_code = excluded.claim_code,
       claimed_by = excluded.claimed_by,
       claimed_at = excluded.claimed_at,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.athleteId ?? ""),
        String(r.claimCode ?? ""),
        r.claimedBy == null ? null : String(r.claimedBy),
        r.claimedAt == null ? null : Number(r.claimedAt),
        Number(r.createdAt ?? 0),
        Number(r.updatedAt ?? 0)
      )
    )
  );
}
__name(upsertAthleteClaims, "upsertAthleteClaims");
async function upsertColaTransfers(db, syncCode, rows) {
  const stmt = db.prepare(
    `INSERT INTO cola_transfers (sync_code, id, from_athlete_id, to_athlete_id, amount, note, status, created_by_email, decided_by_email, created_at, decided_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       from_athlete_id = excluded.from_athlete_id,
       to_athlete_id = excluded.to_athlete_id,
       amount = excluded.amount,
       note = excluded.note,
       status = excluded.status,
       created_by_email = excluded.created_by_email,
       decided_by_email = excluded.decided_by_email,
       created_at = excluded.created_at,
       decided_at = excluded.decided_at`
  );
  await runBatches(
    db,
    rows.map(
      (r) => stmt.bind(
        syncCode,
        String(r.id ?? ""),
        String(r.fromAthleteId ?? ""),
        String(r.toAthleteId ?? ""),
        Number(r.amount ?? 0),
        r.note == null ? null : String(r.note),
        String(r.status ?? "pending"),
        String(r.createdByEmail ?? ""),
        r.decidedByEmail == null ? null : String(r.decidedByEmail),
        Number(r.createdAt ?? 0),
        r.decidedAt == null ? null : Number(r.decidedAt)
      )
    )
  );
}
__name(upsertColaTransfers, "upsertColaTransfers");
var mapAthleteClaim = /* @__PURE__ */ __name((r) => ({
  athleteId: r.athlete_id,
  claimCode: r.claim_code,
  claimedBy: r.claimed_by,
  claimedAt: r.claimed_at == null ? null : Number(r.claimed_at),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at)
}), "mapAthleteClaim");
var mapColaTransfer = /* @__PURE__ */ __name((r) => ({
  id: r.id,
  fromAthleteId: r.from_athlete_id,
  toAthleteId: r.to_athlete_id,
  amount: Number(r.amount),
  note: r.note,
  status: r.status,
  createdByEmail: r.created_by_email,
  decidedByEmail: r.decided_by_email,
  createdAt: Number(r.created_at),
  decidedAt: r.decided_at == null ? null : Number(r.decided_at)
}), "mapColaTransfer");
async function verifyWorkBuddyToken(env, wbToken) {
  if (!env.WB_AUTH_ENDPOINT || !env.WB_PUBLISHABLE_KEY) {
    return { error: "\u670D\u52A1\u7AEF\u5C1A\u672A\u914D\u7F6E WorkBuddy \u6821\u9A8C\u53C2\u6570\uFF08WB_AUTH_ENDPOINT / WB_PUBLISHABLE_KEY\uFF09" };
  }
  if (!wbToken) return { error: "\u7F3A\u5C11 WorkBuddy \u4EE4\u724C" };
  try {
    const res = await fetch(`${env.WB_AUTH_ENDPOINT}/.cloud/auth/v1/user/me`, {
      headers: {
        "x-wb-webapp-access-key": env.WB_PUBLISHABLE_KEY,
        Authorization: `Bearer ${wbToken}`,
        // 数据面按精确 Origin 匹配，服务端调用时显式带上应用自身的 Origin
        Origin: env.WB_AUTH_ENDPOINT
      }
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
      }
      return { error: `WorkBuddy \u8EAB\u4EFD\u6821\u9A8C\u5931\u8D25\uFF08HTTP ${res.status}\uFF09\uFF1A${detail}` };
    }
    const data = await res.json();
    const uid = data?.user?.id ?? data?.id ?? data?.user_id ?? "";
    if (!uid) return { error: "\u8EAB\u4EFD\u6821\u9A8C\u54CD\u5E94\u4E2D\u7F3A\u5C11 uid" };
    return { uid: String(uid) };
  } catch (err) {
    return { error: `WorkBuddy \u8EAB\u4EFD\u6821\u9A8C\u5F02\u5E38\uFF1A${String(err)}` };
  }
}
__name(verifyWorkBuddyToken, "verifyWorkBuddyToken");
async function issueSession(env, email) {
  const token = randomHex(32);
  const exp = Date.now() + SESSION_TTL * 1e3;
  await env.ACCOUNTS_KV.put("session:" + token, JSON.stringify({ email, exp }), {
    expirationTtl: SESSION_TTL
  });
  return token;
}
__name(issueSession, "issueSession");
async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
__name(readJsonBody, "readJsonBody");
async function workbuddyExchange(request, env) {
  if (request.method === "OPTIONS") return json2({ ok: true });
  if (request.method !== "POST") return json2({ error: "Method Not Allowed" }, 405);
  const body = await readJsonBody(request);
  const wbToken = String(body?.wbToken ?? "").trim();
  const verified = await verifyWorkBuddyToken(env, wbToken);
  if (verified.error) {
    return json2({ error: "wb_verify_failed", message: verified.error }, 401);
  }
  const row = await env.SYNC_DB.prepare("SELECT email FROM wb_bindings WHERE wb_uid = ?1").bind(verified.uid).first();
  if (!row?.email) {
    return json2(
      {
        error: "need_bind",
        message: "\u8BE5\u5FAE\u4FE1\u5C1A\u672A\u7ED1\u5B9A\u8D26\u53F7\uFF0C\u8BF7\u5148\u7528\u90AE\u7BB1\u9A8C\u8BC1\u7801\u767B\u5F55\u5B8C\u6210\u4E00\u6B21\u7ED1\u5B9A\u3002"
      },
      409
    );
  }
  const token = await issueSession(env, row.email);
  return json2({ ok: true, token, email: row.email, wbUid: verified.uid });
}
__name(workbuddyExchange, "workbuddyExchange");
async function workbuddyBind(request, env) {
  if (request.method === "OPTIONS") return json2({ ok: true });
  if (request.method !== "POST") return json2({ error: "Method Not Allowed" }, 405);
  const sess = await resolveSession(request, env);
  if (!sess) {
    return json2({ error: "unauthorized", message: "\u8BF7\u5148\u7528\u90AE\u7BB1\u9A8C\u8BC1\u7801\u767B\u5F55\u540E\u518D\u7ED1\u5B9A" }, 401);
  }
  const body = await readJsonBody(request);
  const wbToken = String(body?.wbToken ?? "").trim();
  const verified = await verifyWorkBuddyToken(env, wbToken);
  if (verified.error) {
    return json2({ error: "wb_verify_failed", message: verified.error }, 401);
  }
  const email = normEmail(sess.email);
  const existing = await env.SYNC_DB.prepare("SELECT email FROM wb_bindings WHERE wb_uid = ?1").bind(verified.uid).first();
  if (existing?.email && normEmail(existing.email) !== email) {
    return json2(
      { error: "already_bound", message: "\u8BE5\u5FAE\u4FE1\u5DF2\u7ED1\u5B9A\u5176\u4ED6\u8D26\u53F7\uFF0C\u8BF7\u5148\u7528\u539F\u8D26\u53F7\u89E3\u7ED1\u3002" },
      409
    );
  }
  const now = Date.now();
  await env.SYNC_DB.prepare(
    `INSERT INTO wb_bindings (wb_uid, email, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(wb_uid) DO UPDATE SET
         email = excluded.email,
         updated_at = excluded.updated_at`
  ).bind(verified.uid, email, now, now).run();
  return json2({ ok: true, email, wbUid: verified.uid });
}
__name(workbuddyBind, "workbuddyBind");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/")) {
      const route = url.pathname.slice("/api/auth/".length);
      if (route === "workbuddy-exchange") {
        return workbuddyExchange(request, env);
      }
      if (route === "workbuddy-bind") {
        return workbuddyBind(request, env);
      }
      const handler = route === "request-code" ? request_code_exports : route === "verify-code" ? verify_code_exports : route === "login-password" ? login_password_exports : route === "set-password" ? set_password_exports : route === "me" ? me_exports : null;
      if (handler) {
        return handler.onRequest({ request, env });
      }
      return json2({ error: "Not Found" }, 404);
    }
    if (request.method === "OPTIONS") {
      return json2({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json2({ ok: true, service: "scoreboard-sync-worker" });
    }
    if (request.method !== "POST") {
      return json2({ error: "Method Not Allowed" }, 405);
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json2({ error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON" }, 400);
    }
    if (url.pathname === "/sync/push") {
      const sess = await resolveSession(request, env);
      if (!sess) {
        return json2({ error: "\u672A\u767B\u5F55\uFF0C\u8BF7\u5148\u767B\u5F55" }, 401);
      }
      const syncCode = resolveSyncCode(sess);
      const data = payload?.data ?? {};
      const athletes = Array.isArray(data.athletes) ? data.athletes : [];
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const matchPlayers = Array.isArray(data.matchPlayers) ? data.matchPlayers : [];
      const rounds = Array.isArray(data.rounds) ? data.rounds : [];
      const roundStats = Array.isArray(data.roundStats) ? data.roundStats : [];
      const colaLedger = Array.isArray(data.colaLedger) ? data.colaLedger : [];
      const athleteClaims = Array.isArray(data.athleteClaims) ? data.athleteClaims : [];
      const colaTransfers = Array.isArray(data.colaTransfers) ? data.colaTransfers : [];
      try {
        await upsertAthletes(env.SYNC_DB, syncCode, athletes);
        await upsertMatches(env.SYNC_DB, syncCode, matches);
        await upsertMatchPlayers(env.SYNC_DB, syncCode, matchPlayers);
        await upsertRounds(env.SYNC_DB, syncCode, rounds);
        await upsertRoundStats(env.SYNC_DB, syncCode, roundStats);
        await upsertColaLedger(env.SYNC_DB, syncCode, colaLedger);
        await upsertAthleteClaims(env.SYNC_DB, syncCode, athleteClaims);
        await upsertColaTransfers(env.SYNC_DB, syncCode, colaTransfers);
      } catch (err) {
        return json2({ error: `\u5199\u5165 D1 \u5931\u8D25\uFF1A${String(err)}` }, 500);
      }
      return json2({
        ok: true,
        counts: {
          athletes: athletes.length,
          matches: matches.length,
          matchPlayers: matchPlayers.length,
          rounds: rounds.length,
          roundStats: roundStats.length,
          colaLedger: colaLedger.length,
          athleteClaims: athleteClaims.length,
          colaTransfers: colaTransfers.length
        }
      });
    }
    if (url.pathname === "/sync/pull") {
      const sess = await resolveSession(request, env);
      if (!sess) {
        return json2({ error: "\u672A\u767B\u5F55\uFF0C\u8BF7\u5148\u767B\u5F55" }, 401);
      }
      const syncCode = resolveSyncCode(sess);
      try {
        const [athletes, matches, matchPlayers, rounds, roundStats, colaLedger, athleteClaims, colaTransfers] = await Promise.all([
          env.SYNC_DB.prepare("SELECT id, name, is_deleted, created_at, updated_at FROM athletes WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT id, title, status, created_at, finished_at FROM matches WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT id, match_id, athlete_id, join_order FROM match_players WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT id, match_id, round_no, phase, overtime_seq, parent_round_id, created_at FROM rounds WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT id, round_id, match_id, athlete_id, attempts, hits, hit_rate, rank_group, point_delta, cola_delta, created_at FROM round_stats WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT id, type, from_athlete_id, to_athlete_id, amount, match_id, round_id, note, created_at, operator FROM cola_ledger WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT athlete_id, claim_code, claimed_by, claimed_at, created_at, updated_at FROM athlete_claims WHERE sync_code = ?1").bind(syncCode).all(),
          env.SYNC_DB.prepare("SELECT id, from_athlete_id, to_athlete_id, amount, note, status, created_by_email, decided_by_email, created_at, decided_at FROM cola_transfers WHERE sync_code = ?1").bind(syncCode).all()
        ]);
        return json2({
          ok: true,
          data: {
            athletes: (athletes.results || []).map(mapAthlete),
            matches: (matches.results || []).map(mapMatch),
            matchPlayers: (matchPlayers.results || []).map(mapMatchPlayer),
            rounds: (rounds.results || []).map(mapRound),
            roundStats: (roundStats.results || []).map(mapRoundStat),
            colaLedger: (colaLedger.results || []).map(mapColaLedger),
            athleteClaims: (athleteClaims.results || []).map(mapAthleteClaim),
            colaTransfers: (colaTransfers.results || []).map(mapColaTransfer)
          }
        });
      } catch (err) {
        return json2({ error: `\u8BFB\u53D6 D1 \u5931\u8D25\uFF1A${String(err)}` }, 500);
      }
    }
    return json2({ error: "Not Found" }, 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
