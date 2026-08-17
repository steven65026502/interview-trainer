const PROGRESS_FILE = "rong-data-interview-progress.json";
const PROGRESS_APP = "rong-data-interview-learning-console";
const PROGRESS_VERSION = 4;
const GITHUB_API = "https://api.github.com";
const RESEND_API = "https://api.resend.com/emails";
const APP_PATH = "/interview-trainer/";
const MAX_REDIRECT_LENGTH = 2048;
const EMAIL_BODY_LIMIT_BYTES = 4 * 1024;
const PROGRESS_BODY_LIMIT_BYTES = 1024 * 1024;
const EMAIL_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_RATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RATE_LIMIT = 3;
const EMAIL_IP_RATE_LIMIT = 10;
const OAUTH_IP_RATE_LIMIT = 30;
const EMAIL_COOLDOWN_MS = 60 * 1000;
const MAX_EMAIL_ATTEMPTS = 5;
const OAUTH_COOKIE = "interview_oauth_state";
const AUTH_OBJECT_NAME = "global-auth-v1";

class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.expose = options.expose !== false;
    this.headers = options.headers || {};
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function configuredAppUrl(env) {
  let url;
  try {
    url = new URL(String(env.APP_ORIGIN || ""));
  } catch {
    throw new HttpError(500, "Server configuration error", { expose: false });
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new HttpError(500, "Server configuration error", { expose: false });
  }
  return url;
}

function validateRuntimeConfig(env) {
  configuredAppUrl(env);
  const secretBytes = new TextEncoder().encode(typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "");
  if (secretBytes.byteLength < 32) {
    throw new HttpError(500, "Server configuration error", { expose: false });
  }
  if (!env.AUTH_COORDINATOR || typeof env.AUTH_COORDINATOR.get !== "function" || typeof env.AUTH_COORDINATOR.idFromName !== "function") {
    throw new HttpError(500, "Server configuration error", { expose: false });
  }
}

function corsHeaders(env) {
  try {
    return {
      "Access-Control-Allow-Origin": configuredAppUrl(env).origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    };
  } catch {
    return {};
  }
}

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  };
}

function json(data, init = {}, env) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(env),
      ...(init.headers || {})
    }
  });
}

function internalJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function redirectResponse(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      "Location": location,
      ...securityHeaders(),
      ...headers
    }
  });
}

function errorResponse(error, env) {
  const known = error instanceof HttpError;
  const status = known ? error.status : 500;
  const message = known && error.expose ? error.message : "Worker error";
  const headers = known ? error.headers : {};
  if (status === 401 && !headers["WWW-Authenticate"]) headers["WWW-Authenticate"] = "Bearer";
  return json({ error: message }, { status, headers }, env);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text) || text.length > 16384) {
    throw new HttpError(401, "Invalid session");
  }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    throw new HttpError(401, "Invalid session");
  }
}

function randomCode() {
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  const numbers = new Uint32Array(1);
  do crypto.getRandomValues(numbers); while (numbers[0] >= limit);
  return String(numbers[0] % 1000000).padStart(6, "0");
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Email 格式不正確");
  }
  return email;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

async function aesKey(env) {
  const keyBytes = await sha256(`session-encryption:${env.SESSION_SECRET}`);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`session-signing:${env.SESSION_SECRET}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmacDigestText(text, env) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(text));
  return base64Url(new Uint8Array(signature));
}

async function emailUserId(email, env) {
  // Keep the original raw-secret derivation so existing PROGRESS_KV keys remain readable.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`email-user:${email}`));
  return base64Url(new Uint8Array(signature));
}

async function signPayload(payload, env) {
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

async function verifySignedPayload(token, env) {
  if (typeof token !== "string" || token.length > 4096) throw new HttpError(400, "Invalid OAuth state");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new HttpError(400, "Invalid OAuth state");
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(env),
      fromBase64Url(parts[1]),
      new TextEncoder().encode(parts[0])
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(400, "Invalid OAuth state");
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
  } catch {
    throw new HttpError(400, "Invalid OAuth state");
  }
}

async function encryptSession(payload, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(env),
    new TextEncoder().encode(JSON.stringify(payload))
  );
  return `v2.${base64Url(iv)}.${base64Url(new Uint8Array(cipher))}`;
}

async function decryptSession(token, env) {
  if (typeof token !== "string" || token.length > 16384) throw new HttpError(401, "Invalid session");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v2" || !parts[1] || !parts[2]) {
    throw new HttpError(401, "Invalid session");
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parts[1]) },
      await aesKey(env),
      fromBase64Url(parts[2])
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Invalid session");
  }
}

function validatedRedirect(rawRedirect, env) {
  const app = configuredAppUrl(env);
  const fallback = `${app.origin}${APP_PATH}`;
  if (rawRedirect === undefined || rawRedirect === null || rawRedirect === "") return fallback;
  if (typeof rawRedirect !== "string" || rawRedirect.length > MAX_REDIRECT_LENGTH || /[\u0000-\u001F\u007F]/.test(rawRedirect)) {
    throw new HttpError(400, "Invalid redirect URL");
  }
  let redirect;
  try {
    redirect = new URL(rawRedirect);
  } catch {
    throw new HttpError(400, "Invalid redirect URL");
  }
  if (
    redirect.protocol !== "https:"
    || redirect.origin !== app.origin
    || redirect.username
    || redirect.password
    || redirect.pathname !== APP_PATH
    || redirect.search
    || redirect.hash
  ) {
    throw new HttpError(400, "Invalid redirect URL");
  }
  return redirect.toString();
}

function withHashParam(urlText, key, value) {
  const url = new URL(urlText);
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  params.set(key, value);
  url.hash = params.toString();
  return url.toString();
}

function withHashParams(urlText, values) {
  const url = new URL(urlText);
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });
  url.hash = params.toString();
  return url.toString();
}

function oauthCookie(value, maxAge) {
  return `${OAUTH_COOKIE}=${value}; Max-Age=${maxAge}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax`;
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

function clientIp(request) {
  const value = request.headers.get("CF-Connecting-IP") || "unknown";
  return value.slice(0, 64);
}

async function coordinatorCall(env, path, payload) {
  return coordinatorCallNamed(env, AUTH_OBJECT_NAME, path, payload);
}

async function coordinatorCallNamed(env, objectName, path, payload) {
  let response;
  try {
    const stub = env.AUTH_COORDINATOR.get(env.AUTH_COORDINATOR.idFromName(objectName));
    response = await stub.fetch(`https://auth.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "Authentication service unavailable", { expose: false });
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new HttpError(500, "Authentication service unavailable", { expose: false });
  }
  if (!response.ok) {
    throw new HttpError(response.status >= 400 && response.status <= 599 ? response.status : 500, data.error || "Authentication service unavailable", {
      expose: response.status < 500,
      headers: data.retryAfter ? { "Retry-After": String(data.retryAfter) } : {}
    });
  }
  return data;
}

async function issueSession(claims, env, now = Date.now()) {
  const payload = {
    ...claims,
    iat: now,
    exp: now + SESSION_TTL_MS,
    jti: crypto.randomUUID()
  };
  await coordinatorCall(env, "/session/activate", { jti: payload.jti, exp: payload.exp });
  return encryptSession(payload, env);
}

async function sessionFromRequest(request, env, now = Date.now()) {
  const header = request.headers.get("Authorization") || "";
  if (header.length > 20000) throw new HttpError(401, "Invalid session");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Not signed in");
  const session = await decryptSession(match[1], env);
  if (
    !isPlainObject(session)
    || !Number.isInteger(session.iat)
    || !Number.isInteger(session.exp)
    || typeof session.jti !== "string"
    || session.jti.length > 80
    || session.iat > now + 60 * 1000
    || session.exp <= now
    || session.exp - session.iat !== SESSION_TTL_MS
  ) {
    throw new HttpError(401, "Session expired or invalid");
  }
  const active = await coordinatorCall(env, "/session/check", { jti: session.jti, now });
  if (!active.active) throw new HttpError(401, "Session expired or revoked");
  if (session.provider === "email") {
    if (typeof session.email !== "string" || typeof session.user_id !== "string") {
      throw new HttpError(401, "Invalid email session");
    }
    return session;
  }
  if (
    session.provider !== "github"
    || typeof session.access_token !== "string"
    || !session.access_token
    || typeof session.user_id !== "string"
    || !/^\d{1,20}$/.test(session.user_id)
  ) {
    throw new HttpError(401, "Invalid GitHub session");
  }
  return session;
}

function requireKv(env) {
  if (!env.PROGRESS_KV) throw new HttpError(500, "Progress storage is not configured", { expose: false });
  return env.PROGRESS_KV;
}

async function readJsonKv(env, key) {
  const text = await requireKv(env).get(key);
  return text ? JSON.parse(text) : null;
}

function emailProgressKey(userId) {
  return `progress:email:${userId}`;
}

async function readBodyBytes(request, maxBytes) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0) throw new HttpError(400, "Invalid Content-Length");
    if (length > maxBytes) throw new HttpError(413, "Request body too large");
  }
  if (!request.body) throw new HttpError(400, "JSON body is required");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readJsonBody(request, maxBytes) {
  const contentType = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isPlainObject(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function validateProgressEnvelope(payload) {
  if (
    !isPlainObject(payload)
    || payload.app !== PROGRESS_APP
    || !Number.isInteger(payload.version)
    || payload.version < 1
    || payload.version > PROGRESS_VERSION
    || !isPlainObject(payload.state)
  ) {
    throw new HttpError(400, "Invalid progress payload");
  }
  if (payload.exportedAt !== undefined && (typeof payload.exportedAt !== "string" || payload.exportedAt.length > 40)) {
    throw new HttpError(400, "Invalid progress payload");
  }
  return payload;
}

function progressRevision(payload) {
  const revision = payload && payload.state && payload.state.revision;
  return Number.isSafeInteger(revision) && revision >= 0 && revision <= 10_000_000 ? revision : 0;
}

function validateProgressWrite(payload) {
  validateProgressEnvelope(payload);
  if (!Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0 || payload.baseRevision > 10_000_000) {
    throw new HttpError(400, "Invalid base revision");
  }
  if (typeof payload.baseExists !== "boolean") throw new HttpError(400, "Invalid base existence marker");
  const revision = progressRevision(payload);
  if (revision <= payload.baseRevision) {
    throw new HttpError(400, "Progress revision must increase");
  }
  const stored = { ...payload };
  delete stored.baseRevision;
  delete stored.baseExists;
  return { baseRevision: payload.baseRevision, baseExists: payload.baseExists, revision, payload: stored };
}

function progressSizeBytes(payload) {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

async function githubFetch(path, token, init = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "rong-interview-trainer",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new HttpError(502, "GitHub API returned invalid JSON");
  }
  if (!response.ok) throw new HttpError(502, (data && data.message) || `GitHub API ${response.status}`);
  return data;
}

async function findProgressGist(token) {
  const gists = await githubFetch("/gists?per_page=100", token);
  return gists.find(gist => gist.files && gist.files[PROGRESS_FILE]) || null;
}

async function readGithubProgress(token) {
  const gist = await findProgressGist(token);
  if (!gist) return null;
  const full = await githubFetch(`/gists/${gist.id}`, token);
  const file = full.files[PROGRESS_FILE];
  if (!file || !file.content) return null;
  if (new TextEncoder().encode(file.content).byteLength > PROGRESS_BODY_LIMIT_BYTES) {
    throw new HttpError(413, "Stored progress is too large");
  }
  let payload;
  try {
    payload = JSON.parse(file.content);
  } catch {
    throw new HttpError(500, "Stored progress is invalid", { expose: false });
  }
  return validateProgressEnvelope(payload);
}

async function writeGithubProgress(token, payload) {
  const content = JSON.stringify(validateProgressEnvelope(payload), null, 2);
  if (new TextEncoder().encode(content).byteLength > PROGRESS_BODY_LIMIT_BYTES) {
    throw new HttpError(413, "Progress payload is too large");
  }
  const gist = await findProgressGist(token);
  const body = {
    description: "Rong data interview learning progress",
    public: false,
    files: { [PROGRESS_FILE]: { content } }
  };
  if (gist) {
    return githubFetch(`/gists/${gist.id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  return githubFetch("/gists", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function legacyEmailProgress(session, env) {
  if (!env.PROGRESS_KV) return null;
  const payload = await readJsonKv(env, emailProgressKey(session.user_id));
  if (!payload) return null;
  if (progressSizeBytes(payload) > PROGRESS_BODY_LIMIT_BYTES) throw new HttpError(413, "Stored progress is too large");
  return validateProgressEnvelope(payload);
}

function progressObjectName(session) {
  if (session.provider === "email") return `progress-email-v1:${session.user_id}`;
  return `progress-github-v1:${session.user_id}`;
}

async function progressCoordinatorCall(session, env, path, body = {}) {
  return coordinatorCallNamed(env, progressObjectName(session), path, {
    ...body,
    provider: session.provider,
    token: session.provider === "github" ? session.access_token : undefined
  });
}

async function readProgressForSession(session, env) {
  if (session.provider === "email") {
    const fallbackPayload = await legacyEmailProgress(session, env);
    const result = await progressCoordinatorCall(session, env, "/progress/read", { fallbackPayload });
    return result.payload || null;
  }
  const result = await progressCoordinatorCall(session, env, "/progress/read");
  return result.payload || null;
}

async function writeProgressForSession(session, payload, env) {
  const write = validateProgressWrite(payload);
  if (progressSizeBytes(payload) > PROGRESS_BODY_LIMIT_BYTES) throw new HttpError(413, "Progress payload is too large");
  const fallbackPayload = session.provider === "email" ? await legacyEmailProgress(session, env) : null;
  return progressCoordinatorCall(session, env, "/progress/write", { ...write, fallbackPayload });
}

async function handleAuthStart(request, env) {
  if (!env.GITHUB_CLIENT_ID || typeof env.GITHUB_CLIENT_ID !== "string") {
    throw new HttpError(500, "GitHub OAuth is not configured", { expose: false });
  }
  const url = new URL(request.url);
  const redirect = validatedRedirect(url.searchParams.get("redirect"), env);
  const stateId = crypto.randomUUID();
  const cookieNonce = randomToken();
  const codeVerifier = randomToken();
  const bindingHash = await hmacDigestText(`oauth-cookie:${cookieNonce}`, env);
  const ipKey = await hmacDigestText(`oauth-ip:${clientIp(request)}`, env);
  const now = Date.now();
  await coordinatorCall(env, "/oauth/create", {
    stateId,
    bindingHash,
    ipKey,
    redirect,
    codeVerifier,
    now,
    expiresAt: now + OAUTH_STATE_TTL_MS
  });
  const state = await signPayload({ id: stateId, createdAt: now }, env);
  const challenge = base64Url(new Uint8Array(await sha256(codeVerifier)));
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("scope", "gist read:user");
  github.searchParams.set("state", state);
  github.searchParams.set("code_challenge", challenge);
  github.searchParams.set("code_challenge_method", "S256");
  return redirectResponse(github.toString(), { "Set-Cookie": oauthCookie(cookieNonce, Math.ceil(OAUTH_STATE_TTL_MS / 1000)) });
}

async function handleAuthCallback(request, env) {
  const clearCookie = oauthCookie("", 0);
  try {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      throw new HttpError(500, "GitHub OAuth is not configured", { expose: false });
    }
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateText = url.searchParams.get("state");
    if (!code || code.length > 2048 || !stateText) throw new HttpError(400, "Missing OAuth code or state");
    const state = await verifySignedPayload(stateText, env);
    const now = Date.now();
    if (!isPlainObject(state) || typeof state.id !== "string" || !Number.isInteger(state.createdAt) || now - state.createdAt > OAUTH_STATE_TTL_MS || state.createdAt > now + 60000) {
      throw new HttpError(400, "OAuth state expired or invalid");
    }
    const nonce = cookieValue(request, OAUTH_COOKIE);
    if (!nonce || nonce.length > 128) throw new HttpError(400, "OAuth browser binding missing");
    const bindingHash = await hmacDigestText(`oauth-cookie:${nonce}`, env);
    const pending = await coordinatorCall(env, "/oauth/consume", { stateId: state.id, bindingHash, now });
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier: pending.codeVerifier
      })
    });
    let tokenData;
    try {
      tokenData = await response.json();
    } catch {
      throw new HttpError(502, "GitHub OAuth returned invalid JSON");
    }
    if (!response.ok || typeof tokenData.access_token !== "string" || !tokenData.access_token || tokenData.access_token.length > 4096) {
      throw new HttpError(400, tokenData.error_description || "GitHub OAuth exchange failed");
    }
    const githubUser = await githubFetch("/user", tokenData.access_token);
    if (!githubUser || !Number.isSafeInteger(githubUser.id) || githubUser.id <= 0) {
      throw new HttpError(502, "GitHub user identity was invalid");
    }
    const session = await issueSession({
      provider: "github",
      access_token: tokenData.access_token,
      user_id: String(githubUser.id),
      scope: typeof tokenData.scope === "string" ? tokenData.scope.slice(0, 500) : ""
    }, env);
    return redirectResponse(withHashParam(pending.redirect, "github_sync", session), { "Set-Cookie": clearCookie });
  } catch (error) {
    const response = errorResponse(error, env);
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", clearCookie);
    return new Response(response.body, { status: response.status, headers });
  }
}

function emailBody(email, code, magicLink) {
  const safeEmail = escapeHtml(email);
  const safeCode = escapeHtml(code);
  const safeLink = escapeHtml(magicLink);
  return {
    subject: "Rong AI 應用與資料整合求職工作台登入驗證碼",
    text: [
      "你的 Rong AI 應用與資料整合求職工作台登入驗證碼是：",
      "",
      code,
      "",
      "也可以直接開啟以下一次性登入連結：",
      magicLink,
      "",
      "驗證碼與連結將在 10 分鐘後失效。如果不是你提出的要求，請忽略這封信。"
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#17201d;">
        <h2 style="margin:0 0 12px;">Rong AI 應用與資料整合求職工作台登入</h2>
        <p>這是寄給 <strong>${safeEmail}</strong> 的登入驗證碼：</p>
        <p style="font-size:26px;letter-spacing:6px;font-weight:700;margin:18px 0;">${safeCode}</p>
        <p><a href="${safeLink}" style="display:inline-block;padding:10px 14px;border-radius:6px;background:#1f6f5b;color:#fff;text-decoration:none;">直接登入學習系統</a></p>
        <p style="color:#5e6b66;font-size:13px;">驗證碼與連結將在 10 分鐘後失效。如果不是你提出的要求，請忽略這封信。</p>
      </div>
    `
  };
}

async function sendVerificationEmail({ email, code, magicLink, challengeId }, env) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new HttpError(500, "Email service is not configured", { expose: false });
  }
  const message = emailBody(email, code, magicLink);
  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "rong-interview-trainer-worker/2.0",
      "Idempotency-Key": `email-login-${challengeId}`
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], ...message })
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new HttpError(502, "Email service returned invalid JSON");
  }
  if (!response.ok) {
    throw new HttpError(502, (data && data.message) || (data && data.error && data.error.message) || `Email service ${response.status}`);
  }
  return data;
}

async function handleEmailStart(request, env) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new HttpError(500, "Email service is not configured", { expose: false });
  }
  const body = await readJsonBody(request, EMAIL_BODY_LIMIT_BYTES);
  const email = normalizeEmail(body.email);
  const redirect = validatedRedirect(body.redirect, env);
  const now = Date.now();
  const userId = await emailUserId(email, env);
  const emailKey = await hmacDigestText(`email-rate:${email}`, env);
  const ipKey = await hmacDigestText(`ip-rate:${clientIp(request)}`, env);
  const challengeId = crypto.randomUUID();
  const code = randomCode();
  const token = randomToken();
  await coordinatorCall(env, "/email/start", {
    emailKey,
    ipKey,
    challengeId,
    now,
    challenge: {
      email,
      userId,
      redirect,
      codeHash: await hmacDigestText(`email-code:${challengeId}:${code}`, env),
      tokenHash: await hmacDigestText(`email-token:${challengeId}:${token}`, env),
      attempts: 0,
      expiresAt: now + EMAIL_CHALLENGE_TTL_MS
    }
  });
  const callback = new URL("/email/callback", request.url);
  callback.searchParams.set("challenge", challengeId);
  callback.searchParams.set("token", token);
  try {
    await sendVerificationEmail({ email, code, magicLink: callback.toString(), challengeId }, env);
  } catch (error) {
    await coordinatorCall(env, "/email/delete", { challengeId }).catch(() => undefined);
    throw error;
  }
  return json({ ok: true, challengeId, email, expiresIn: Math.floor(EMAIL_CHALLENGE_TTL_MS / 1000) }, {}, env);
}

async function completeEmailChallenge({ challengeId, email, code, token }, env) {
  if (typeof challengeId !== "string" || challengeId.length > 80) throw new HttpError(400, "缺少或不正確的驗證 ID");
  let kind;
  let candidateHash;
  let normalizedEmail = "";
  if (token) {
    if (typeof token !== "string" || token.length > 128) throw new HttpError(400, "登入連結不正確");
    kind = "token";
    candidateHash = await hmacDigestText(`email-token:${challengeId}:${token}`, env);
  } else {
    normalizedEmail = normalizeEmail(email);
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new HttpError(400, "驗證碼必須是六位數字");
    kind = "code";
    candidateHash = await hmacDigestText(`email-code:${challengeId}:${code}`, env);
  }
  const result = await coordinatorCall(env, "/email/consume", {
    challengeId,
    kind,
    candidateHash,
    email: normalizedEmail,
    now: Date.now()
  });
  const session = await issueSession({
    provider: "email",
    email: result.email,
    user_id: result.userId
  }, env);
  return { session, email: result.email, redirect: result.redirect };
}

async function handleEmailVerify(request, env) {
  const body = await readJsonBody(request, EMAIL_BODY_LIMIT_BYTES);
  const result = await completeEmailChallenge({
    challengeId: body.challengeId,
    email: body.email,
    code: body.code
  }, env);
  return json({ ok: true, provider: "email", session: result.session, email: result.email }, {}, env);
}

async function handleEmailCallback(request, env) {
  const url = new URL(request.url);
  try {
    const result = await completeEmailChallenge({
      challengeId: url.searchParams.get("challenge"),
      token: url.searchParams.get("token")
    }, env);
    return redirectResponse(withHashParams(result.redirect, {
      email_sync: result.session,
      email_account: result.email,
      sync_worker: url.origin
    }));
  } catch (error) {
    const message = error instanceof HttpError && error.status < 500 ? error.message : "Email login failed";
    return redirectResponse(withHashParam(`${configuredAppUrl(env).origin}${APP_PATH}`, "email_sync_error", message));
  }
}

async function handleLogout(request, env) {
  const session = await sessionFromRequest(request, env);
  await coordinatorCall(env, "/session/revoke", { jti: session.jti });
  return json({ ok: true }, {}, env);
}

async function handleOptions(request, env) {
  let expected;
  try {
    expected = configuredAppUrl(env).origin;
  } catch (error) {
    return errorResponse(error, env);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== expected) return json({ error: "Origin not allowed" }, { status: 403 }, env);
  return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(env) } });
}

async function handleApi(request, env) {
  if (request.method === "OPTIONS") return await handleOptions(request, env);
  try {
    validateRuntimeConfig(env);
    const expectedOrigin = configuredAppUrl(env).origin;
    const origin = request.headers.get("Origin");
    if (origin && origin !== expectedOrigin) throw new HttpError(403, "Origin not allowed");
    const url = new URL(request.url);
    if (url.pathname === "/auth/start" && request.method === "GET") return await handleAuthStart(request, env);
    if (url.pathname === "/auth/callback" && request.method === "GET") return await handleAuthCallback(request, env);
    if (url.pathname === "/email/start" && request.method === "POST") return await handleEmailStart(request, env);
    if (url.pathname === "/email/verify" && request.method === "POST") return await handleEmailVerify(request, env);
    if (url.pathname === "/email/callback" && request.method === "GET") return await handleEmailCallback(request, env);
    if (url.pathname === "/logout" && request.method === "POST") return await handleLogout(request, env);

    const session = await sessionFromRequest(request, env);
    if (url.pathname === "/me" && request.method === "GET") {
      if (session.provider === "email") return json({ provider: "email", email: session.email }, {}, env);
      const user = await githubFetch("/user", session.access_token);
      return json({ provider: "github", login: user.login, avatar_url: user.avatar_url }, {}, env);
    }
    if (url.pathname === "/progress" && request.method === "GET") {
      const payload = await readProgressForSession(session, env);
      if (!payload) throw new HttpError(404, "No cloud progress found");
      return json(payload, {}, env);
    }
    if (url.pathname === "/progress" && request.method === "PUT") {
      const payload = validateProgressEnvelope(await readJsonBody(request, PROGRESS_BODY_LIMIT_BYTES));
      const result = await writeProgressForSession(session, payload, env);
      return json(result, {}, env);
    }
    throw new HttpError(404, "Not found");
  } catch (error) {
    return errorResponse(error, env);
  }
}

function rateState(value, now) {
  const timestamps = isPlainObject(value) && Array.isArray(value.timestamps)
    ? value.timestamps.filter(item => Number.isInteger(item) && item > now - EMAIL_RATE_WINDOW_MS && item <= now)
    : [];
  return { timestamps };
}

export class AuthCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.progressQueue = Promise.resolve();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return internalJson({ error: "Method not allowed" }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return internalJson({ error: "Invalid internal request" }, 400);
    }
    if (!isPlainObject(body)) return internalJson({ error: "Invalid internal request" }, 400);
    try {
      if (url.pathname === "/oauth/create") return await this.oauthCreate(body);
      if (url.pathname === "/oauth/consume") return await this.oauthConsume(body);
      if (url.pathname === "/email/start") return await this.emailStart(body);
      if (url.pathname === "/email/consume") return await this.emailConsume(body);
      if (url.pathname === "/email/delete") return await this.emailDelete(body);
      if (url.pathname === "/session/activate") return await this.sessionActivate(body);
      if (url.pathname === "/session/check") return await this.sessionCheck(body);
      if (url.pathname === "/session/revoke") return await this.sessionRevoke(body);
      if (url.pathname === "/progress/read") return await this.progressRead(body);
      if (url.pathname === "/progress/write") return await this.progressWrite(body);
      return internalJson({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return internalJson({ error: error.expose ? error.message : "Progress state failure" }, error.status);
      }
      return internalJson({ error: "Authentication state failure" }, 500);
    }
  }

  async scheduleCleanup(timestamp) {
    if (!Number.isInteger(timestamp) || timestamp <= Date.now()) return;
    const current = await this.state.storage.getAlarm();
    if (current === null || current === undefined || timestamp < current) {
      await this.state.storage.setAlarm(timestamp);
    }
  }

  async alarm() {
    const now = Date.now();
    let nextAlarm = null;
    let startAfter;
    while (true) {
      const options = { limit: 128 };
      if (startAfter !== undefined) options.startAfter = startAfter;
      const records = await this.state.storage.list(options);
      if (!records.size) break;
      const expiredKeys = [];
      for (const [key, value] of records) {
        let expiresAt = null;
        if (key.startsWith("oauth:") || key.startsWith("challenge:")) {
          expiresAt = isPlainObject(value) && Number.isInteger(value.expiresAt) ? value.expiresAt : now;
        } else if (key.startsWith("session:")) {
          expiresAt = isPlainObject(value) && Number.isInteger(value.exp) ? value.exp : now;
        } else if (key.startsWith("rate:")) {
          const timestamps = isPlainObject(value) && Array.isArray(value.timestamps)
            ? value.timestamps.filter(item => Number.isInteger(item))
            : [];
          expiresAt = timestamps.length ? Math.max(...timestamps) + EMAIL_RATE_WINDOW_MS : now;
        }
        if (expiresAt === null) continue;
        if (expiresAt <= now) expiredKeys.push(key);
        else nextAlarm = nextAlarm === null ? expiresAt : Math.min(nextAlarm, expiresAt);
      }
      if (expiredKeys.length) await this.state.storage.delete(expiredKeys);
      const keys = Array.from(records.keys());
      startAfter = keys[keys.length - 1];
      if (records.size < 128) break;
    }
    if (nextAlarm === null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(nextAlarm);
  }

  async oauthCreate(body) {
    if (!body.stateId || !body.bindingHash || !body.ipKey || !body.redirect || !body.codeVerifier || !Number.isInteger(body.now) || !Number.isInteger(body.expiresAt)) {
      return internalJson({ error: "Invalid OAuth state" }, 400);
    }
    const response = await this.state.storage.transaction(async transaction => {
      const rateKey = `rate:oauth-ip:${body.ipKey}`;
      const ipRate = rateState(await transaction.get(rateKey), body.now);
      if (ipRate.timestamps.length >= OAUTH_IP_RATE_LIMIT) {
        const retryAfter = Math.max(1, Math.ceil((ipRate.timestamps[0] + EMAIL_RATE_WINDOW_MS - body.now) / 1000));
        return internalJson({ error: "Too many OAuth attempts", retryAfter }, 429);
      }
      ipRate.timestamps.push(body.now);
      await transaction.put(rateKey, ipRate);
      await transaction.put(`oauth:${body.stateId}`, {
        bindingHash: body.bindingHash,
        redirect: body.redirect,
        codeVerifier: body.codeVerifier,
        expiresAt: body.expiresAt
      });
      return internalJson({ ok: true });
    });
    if (response.ok) await this.scheduleCleanup(Math.min(body.expiresAt, body.now + EMAIL_RATE_WINDOW_MS));
    return response;
  }

  async oauthConsume(body) {
    return this.state.storage.transaction(async transaction => {
      const key = `oauth:${body.stateId || ""}`;
      const record = await transaction.get(key);
      if (record) await transaction.delete(key);
      if (!record || !Number.isInteger(body.now) || record.expiresAt <= body.now || record.bindingHash !== body.bindingHash) {
        return internalJson({ error: "OAuth state expired, replayed, or browser binding did not match" }, 400);
      }
      return internalJson({ redirect: record.redirect, codeVerifier: record.codeVerifier });
    });
  }

  async emailStart(body) {
    const response = await this.state.storage.transaction(async transaction => {
      if (!body.emailKey || !body.ipKey || !body.challengeId || !Number.isInteger(body.now) || !isPlainObject(body.challenge)) {
        return internalJson({ error: "Invalid email challenge" }, 400);
      }
      const emailStorageKey = `rate:email:${body.emailKey}`;
      const ipStorageKey = `rate:ip:${body.ipKey}`;
      const emailRate = rateState(await transaction.get(emailStorageKey), body.now);
      const ipRate = rateState(await transaction.get(ipStorageKey), body.now);
      const cooldown = emailRate.timestamps.length ? body.now - emailRate.timestamps[emailRate.timestamps.length - 1] : EMAIL_COOLDOWN_MS;
      if (cooldown < EMAIL_COOLDOWN_MS || emailRate.timestamps.length >= EMAIL_RATE_LIMIT || ipRate.timestamps.length >= EMAIL_IP_RATE_LIMIT) {
        const waits = [];
        if (cooldown < EMAIL_COOLDOWN_MS) waits.push(EMAIL_COOLDOWN_MS - cooldown);
        if (emailRate.timestamps.length >= EMAIL_RATE_LIMIT) waits.push(emailRate.timestamps[0] + EMAIL_RATE_WINDOW_MS - body.now);
        if (ipRate.timestamps.length >= EMAIL_IP_RATE_LIMIT) waits.push(ipRate.timestamps[0] + EMAIL_RATE_WINDOW_MS - body.now);
        const retryAfter = Math.max(1, Math.ceil(Math.max(...waits) / 1000));
        return internalJson({ error: "登入郵件要求過於頻繁，請稍後再試", retryAfter }, 429);
      }
      emailRate.timestamps.push(body.now);
      ipRate.timestamps.push(body.now);
      await transaction.put(emailStorageKey, emailRate);
      await transaction.put(ipStorageKey, ipRate);
      await transaction.put(`challenge:${body.challengeId}`, body.challenge);
      return internalJson({ ok: true });
    });
    if (response.ok) await this.scheduleCleanup(Math.min(body.challenge.expiresAt, body.now + EMAIL_RATE_WINDOW_MS));
    return response;
  }

  async emailConsume(body) {
    return this.state.storage.transaction(async transaction => {
      const key = `challenge:${body.challengeId || ""}`;
      const challenge = await transaction.get(key);
      if (!challenge || !Number.isInteger(body.now) || challenge.expiresAt <= body.now) {
        if (challenge) await transaction.delete(key);
        return internalJson({ error: "驗證資料已失效，請重新要求驗證碼" }, 400);
      }
      if (challenge.attempts >= MAX_EMAIL_ATTEMPTS) {
        await transaction.delete(key);
        return internalJson({ error: "驗證失敗次數過多，請重新要求驗證碼" }, 429);
      }
      const emailMatches = body.kind === "token" || body.email === challenge.email;
      const expectedHash = body.kind === "token" ? challenge.tokenHash : challenge.codeHash;
      if (!emailMatches || typeof body.candidateHash !== "string" || body.candidateHash !== expectedHash) {
        challenge.attempts += 1;
        if (challenge.attempts >= MAX_EMAIL_ATTEMPTS) await transaction.delete(key);
        else await transaction.put(key, challenge);
        return internalJson({ error: "驗證資料不正確" }, challenge.attempts >= MAX_EMAIL_ATTEMPTS ? 429 : 400);
      }
      await transaction.delete(key);
      return internalJson({ email: challenge.email, userId: challenge.userId, redirect: challenge.redirect });
    });
  }

  async emailDelete(body) {
    if (body.challengeId) await this.state.storage.delete(`challenge:${body.challengeId}`);
    return internalJson({ ok: true });
  }

  async sessionActivate(body) {
    if (!body.jti || !Number.isInteger(body.exp)) return internalJson({ error: "Invalid session" }, 400);
    await this.state.storage.put(`session:${body.jti}`, { exp: body.exp });
    await this.scheduleCleanup(body.exp);
    return internalJson({ ok: true });
  }

  async sessionCheck(body) {
    return this.state.storage.transaction(async transaction => {
      const key = `session:${body.jti || ""}`;
      const record = await transaction.get(key);
      const active = Boolean(record && Number.isInteger(body.now) && record.exp > body.now);
      if (record && !active) await transaction.delete(key);
      return internalJson({ active });
    });
  }

  async sessionRevoke(body) {
    if (body.jti) await this.state.storage.delete(`session:${body.jti}`);
    return internalJson({ ok: true });
  }

  runProgressExclusive(operation) {
    const result = this.progressQueue.catch(() => undefined).then(operation);
    this.progressQueue = result.catch(() => undefined);
    return result;
  }

  async progressRead(body) {
    if (body.provider === "email") {
      return this.state.storage.transaction(async transaction => {
        let payload = await transaction.get("progress");
        if (!payload && body.fallbackPayload) {
          payload = validateProgressEnvelope(body.fallbackPayload);
          await transaction.put("progress", payload);
        }
        return internalJson({ payload: payload || null, revision: progressRevision(payload) });
      });
    }
    if (body.provider !== "github" || typeof body.token !== "string" || !body.token) {
      return internalJson({ error: "Invalid progress identity" }, 400);
    }
    return this.runProgressExclusive(async () => {
      const payload = await readGithubProgress(body.token);
      return internalJson({ payload, revision: progressRevision(payload) });
    });
  }

  async progressWrite(body) {
    if (
      !Number.isSafeInteger(body.baseRevision)
      || body.baseRevision < 0
      || body.baseRevision > 10_000_000
      || !Number.isSafeInteger(body.revision)
      || body.revision <= body.baseRevision
      || body.revision > 10_000_000
      || typeof body.baseExists !== "boolean"
    ) {
      return internalJson({ error: "Invalid progress revision" }, 400);
    }
    const payload = validateProgressEnvelope(body.payload);
    if (progressRevision(payload) !== body.revision) {
      return internalJson({ error: "Progress revision did not match payload" }, 400);
    }
    if (body.provider === "email") {
      return this.state.storage.transaction(async transaction => {
        let current = await transaction.get("progress");
        if (!current && body.fallbackPayload) {
          current = validateProgressEnvelope(body.fallbackPayload);
          await transaction.put("progress", current);
        }
        const currentRevision = progressRevision(current);
        if (body.baseExists !== Boolean(current) || body.baseRevision !== currentRevision) {
          return internalJson({ error: "Progress conflict", currentRevision }, 409);
        }
        await transaction.put("progress", payload);
        return internalJson({ ok: true, revision: body.revision });
      });
    }
    if (body.provider !== "github" || typeof body.token !== "string" || !body.token) {
      return internalJson({ error: "Invalid progress identity" }, 400);
    }
    return this.runProgressExclusive(async () => {
      const current = await readGithubProgress(body.token);
      const currentRevision = progressRevision(current);
      if (body.baseExists !== Boolean(current) || body.baseRevision !== currentRevision) {
        return internalJson({ error: "Progress conflict", currentRevision }, 409);
      }
      await writeGithubProgress(body.token, payload);
      return internalJson({ ok: true, revision: body.revision });
    });
  }
}

export const __test = {
  APP_PATH,
  EMAIL_BODY_LIMIT_BYTES,
  PROGRESS_BODY_LIMIT_BYTES,
  SESSION_TTL_MS,
  emailUserId,
  issueSession,
  validatedRedirect
};

export default {
  fetch: handleApi
};
