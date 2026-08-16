import assert from "node:assert/strict";
import test from "node:test";

import worker, { AuthCoordinator, __test } from "../src/index.js";

const APP_ORIGIN = "https://steven65026502.github.io";
const APP_URL = `${APP_ORIGIN}/interview-trainer/`;

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.alarmTime = null;
    this.deleteBatches = [];
    this.listCalls = 0;
    this.transactionQueue = Promise.resolve();
  }

  async get(key) {
    return this.values.has(key) ? structuredClone(this.values.get(key)) : undefined;
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }

  async delete(key) {
    if (Array.isArray(key)) {
      if (key.length > 128) throw new RangeError("Durable Object delete batch exceeded 128 keys");
      this.deleteBatches.push(key.length);
      let deleted = 0;
      for (const item of key) deleted += this.values.delete(item) ? 1 : 0;
      return deleted;
    }
    return this.values.delete(key);
  }

  async list(options = {}) {
    this.listCalls += 1;
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const entries = Array.from(this.values.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([key]) => options.startAfter === undefined || key > options.startAfter)
      .slice(0, limit)
      .map(([key, value]) => [key, structuredClone(value)]);
    return new Map(entries);
  }

  async getAlarm() {
    return this.alarmTime;
  }

  async setAlarm(timestamp) {
    this.alarmTime = timestamp;
  }

  async deleteAlarm() {
    this.alarmTime = null;
  }

  async transaction(callback) {
    const result = this.transactionQueue.catch(() => undefined).then(() => callback(this));
    this.transactionQueue = result.catch(() => undefined);
    return result;
  }
}

class MemoryCoordinatorNamespace {
  constructor() {
    this.instances = new Map();
  }

  idFromName(name) {
    return name;
  }

  get(id) {
    if (!this.instances.has(id)) {
      const storage = new MemoryStorage();
      this.instances.set(id, new AuthCoordinator({ storage }, {}));
    }
    const instance = this.instances.get(id);
    return {
      fetch: (input, init) => instance.fetch(input instanceof Request ? input : new Request(input, init))
    };
  }
}

function makeEnv(overrides = {}) {
  return {
    APP_ORIGIN,
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Interview Trainer <login@example.com>",
    AUTH_COORDINATOR: new MemoryCoordinatorNamespace(),
    PROGRESS_KV: {
      values: new Map(),
      async get(key) { return this.values.get(key) ?? null; },
      async put(key, value) { this.values.set(key, value); }
    },
    ...overrides
  };
}

function jsonRequest(url, body, options = {}) {
  return new Request(url, {
    method: options.method || "POST",
    headers: {
      "Content-Type": options.contentType || "application/json",
      "Origin": APP_ORIGIN,
      "CF-Connecting-IP": options.ip || "203.0.113.10",
      ...(options.headers || {})
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("validatedRedirect only accepts the exact app origin and canonical path", () => {
  const env = makeEnv();
  assert.equal(__test.validatedRedirect(undefined, env), APP_URL);
  assert.equal(__test.validatedRedirect(APP_URL, env), APP_URL);
  assert.throws(() => __test.validatedRedirect("https://steven65026502.github.io.attacker.example/interview-trainer/", env));
  assert.throws(() => __test.validatedRedirect(`${APP_ORIGIN}/interview-trainer/index.html`, env));
  assert.throws(() => __test.validatedRedirect(`${APP_URL}?next=https://attacker.example`, env));
  assert.throws(() => __test.validatedRedirect(`https://user@steven65026502.github.io/interview-trainer/`, env));
  assert.throws(() => __test.validatedRedirect(`${APP_URL}${"x".repeat(2100)}`, env));
});

test("Email progress user IDs retain the legacy KV key derivation", async () => {
  const env = makeEnv();
  const email = "student@example.com";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`email-user:${email}`));
  const expected = Buffer.from(signature).toString("base64url");
  assert.equal(await __test.emailUserId(email, env), expected);
});

test("missing or short SESSION_SECRET fails closed with hardened JSON", async () => {
  for (const secret of [undefined, "too-short"]) {
    const env = makeEnv({ SESSION_SECRET: secret });
    const response = await worker.fetch(new Request("https://worker.example/me"), env);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(await response.json(), { error: "Worker error" });
  }
  const missingCoordinator = await worker.fetch(
    new Request("https://worker.example/me"),
    makeEnv({ AUTH_COORDINATOR: undefined })
  );
  assert.equal(missingCoordinator.status, 500);
  assert.deepEqual(await missingCoordinator.json(), { error: "Worker error" });
});

test("EMAIL_DEBUG cannot expose a code or magic link in the public response", async t => {
  const env = makeEnv({ EMAIL_DEBUG: "true" });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    assert.equal(String(input), "https://api.resend.com/emails");
    return new Response(JSON.stringify({ id: "email-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const response = await worker.fetch(jsonRequest("https://worker.example/email/start", {
    email: "student@example.com",
    redirect: APP_URL
  }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(Object.hasOwn(data, "debugCode"), false);
  assert.equal(Object.hasOwn(data, "debugLink"), false);
  assert.deepEqual(Object.keys(data).sort(), ["challengeId", "email", "expiresIn", "ok"]);
});

test("OAuth state is cookie-bound, single-use, and clears its cookie", async t => {
  const env = makeEnv();
  const start = await worker.fetch(new Request(`https://worker.example/auth/start?redirect=${encodeURIComponent(APP_URL)}`), env);
  assert.equal(start.status, 302);
  const setCookie = start.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookiePair = setCookie.split(";", 1)[0];
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  assert.ok(state);

  const missingCookie = await worker.fetch(new Request(`https://worker.example/auth/callback?code=code-1&state=${encodeURIComponent(state)}`), env);
  assert.equal(missingCookie.status, 400);
  assert.match(missingCookie.headers.get("set-cookie"), /Max-Age=0/);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let exchanges = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      exchanges += 1;
      return new Response(JSON.stringify({ access_token: "github-access-token", scope: "gist read:user" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    assert.equal(url, "https://api.github.com/user");
    return new Response(JSON.stringify({ id: 12345, login: "student" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const callbackUrl = `https://worker.example/auth/callback?code=code-1&state=${encodeURIComponent(state)}`;
  const callback = await worker.fetch(new Request(callbackUrl, { headers: { Cookie: cookiePair } }), env);
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get("set-cookie"), /Max-Age=0/);
  assert.match(callback.headers.get("location"), /^https:\/\/steven65026502\.github\.io\/interview-trainer\/#github_sync=/);
  assert.equal(exchanges, 1);

  const replay = await worker.fetch(new Request(callbackUrl, { headers: { Cookie: cookiePair } }), env);
  assert.equal(replay.status, 400);
  assert.equal(exchanges, 1);
});

test("OAuth start is rate-limited per IP before pending state can grow without bound", async () => {
  const env = makeEnv();
  const headers = { "CF-Connecting-IP": "198.51.100.20" };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await worker.fetch(new Request("https://worker.example/auth/start", { headers }), env);
    assert.equal(response.status, 302);
  }
  const limited = await worker.fetch(new Request("https://worker.example/auth/start", { headers }), env);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal(limited.headers.get("set-cookie"), null);
});

test("Durable Object alarm paginates and deletes more than 128 expired records safely", async () => {
  const storage = new MemoryStorage();
  const coordinator = new AuthCoordinator({ storage }, {});
  const now = Date.now();
  for (let index = 0; index < 300; index += 1) {
    await storage.put(`oauth:expired-${String(index).padStart(3, "0")}`, {
      bindingHash: "binding",
      redirect: APP_URL,
      codeVerifier: "verifier",
      expiresAt: now - 1
    });
  }
  await storage.put("session:future", { exp: now + 60000 });

  await coordinator.alarm();

  assert.equal(Array.from(storage.values.keys()).filter(key => key.startsWith("oauth:expired-")).length, 0);
  assert.equal(storage.values.has("session:future"), true);
  assert.ok(storage.listCalls >= 3);
  assert.ok(Math.max(...storage.deleteBatches) <= 128);
  assert.equal(storage.alarmTime, now + 60000);
});

test("Durable Object enforces Email cooldown and an atomic attempt ceiling", async t => {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "email-id" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  const startBody = { email: "limited@example.com", redirect: APP_URL };
  const first = await worker.fetch(jsonRequest("https://worker.example/email/start", startBody), env);
  assert.equal(first.status, 200);
  const challengeId = (await first.json()).challengeId;

  const second = await worker.fetch(jsonRequest("https://worker.example/email/start", startBody), env);
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get("retry-after")) >= 1);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await worker.fetch(jsonRequest("https://worker.example/email/verify", {
      challengeId,
      email: "limited@example.com",
      code: String(attempt).padStart(6, "0")
    }), env);
    assert.equal(response.status, attempt === 5 ? 429 : 400);
  }
});

test("sessions expire after 24 hours and logout revokes an active jti", async () => {
  const env = makeEnv();
  const now = Date.now();
  const claims = { provider: "email", email: "student@example.com", user_id: "user-id" };
  const expired = await __test.issueSession(claims, env, now - __test.SESSION_TTL_MS - 1);
  const expiredResponse = await worker.fetch(new Request("https://worker.example/me", {
    headers: { Authorization: `Bearer ${expired}` }
  }), env);
  assert.equal(expiredResponse.status, 401);

  const active = await __test.issueSession(claims, env, now);
  const beforeLogout = await worker.fetch(new Request("https://worker.example/me", {
    headers: { Authorization: `Bearer ${active}` }
  }), env);
  assert.equal(beforeLogout.status, 200);

  const logout = await worker.fetch(new Request("https://worker.example/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${active}` }
  }), env);
  assert.equal(logout.status, 200);

  const afterLogout = await worker.fetch(new Request("https://worker.example/me", {
    headers: { Authorization: `Bearer ${active}` }
  }), env);
  assert.equal(afterLogout.status, 401);
});

test("JSON endpoints enforce Content-Type, byte limits, and progress envelope schema", async () => {
  const env = makeEnv();
  const wrongType = await worker.fetch(jsonRequest("https://worker.example/email/start", "{}", {
    contentType: "text/plain"
  }), env);
  assert.equal(wrongType.status, 415);

  const oversizedEmail = JSON.stringify({
    email: "student@example.com",
    redirect: APP_URL,
    padding: "x".repeat(__test.EMAIL_BODY_LIMIT_BYTES)
  });
  const emailTooLarge = await worker.fetch(jsonRequest("https://worker.example/email/start", oversizedEmail), env);
  assert.equal(emailTooLarge.status, 413);

  const token = await __test.issueSession({ provider: "email", email: "student@example.com", user_id: "user-id" }, env);
  const invalidEnvelope = await worker.fetch(jsonRequest("https://worker.example/progress", {}, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  assert.equal(invalidEnvelope.status, 400);

  const oversizedProgress = JSON.stringify({
    app: "rong-data-interview-learning-console",
    version: 3,
    state: { padding: "x".repeat(__test.PROGRESS_BODY_LIMIT_BYTES) }
  });
  const progressTooLarge = await worker.fetch(jsonRequest("https://worker.example/progress", oversizedProgress, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  assert.equal(progressTooLarge.status, 413);
});

function progressPayload(revision, answer = `answer-${revision}`) {
  return {
    app: "rong-data-interview-learning-console",
    version: 4,
    exportedAt: new Date().toISOString(),
    state: { revision, answers: [answer], learnedLessons: [true] }
  };
}

async function putProgress(env, token, payload, baseRevision, baseExists = baseRevision > 0) {
  return worker.fetch(jsonRequest("https://worker.example/progress", { ...payload, baseRevision, baseExists }, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` }
  }), env);
}

test("Email progress uses per-user Durable Object CAS: stale writes fail and fresh writes win", async () => {
  const env = makeEnv();
  const token = await __test.issueSession({ provider: "email", email: "student@example.com", user_id: "user-id" }, env);
  const first = progressPayload(1, "first");
  const upload = await putProgress(env, token, first, 0);
  assert.equal(upload.status, 200);
  assert.deepEqual(await upload.json(), { ok: true, revision: 1 });

  const stale = await putProgress(env, token, progressPayload(2, "stale"), 0);
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: "Progress conflict" });

  let download = await worker.fetch(new Request("https://worker.example/progress", {
    headers: { Authorization: `Bearer ${token}`, Origin: APP_ORIGIN }
  }), env);
  assert.equal(download.status, 200);
  assert.deepEqual(await download.json(), first);

  const second = progressPayload(2, "merged-and-retried");
  const fresh = await putProgress(env, token, second, 1);
  assert.equal(fresh.status, 200);
  assert.deepEqual(await fresh.json(), { ok: true, revision: 2 });

  download = await worker.fetch(new Request("https://worker.example/progress", {
    headers: { Authorization: `Bearer ${token}`, Origin: APP_ORIGIN }
  }), env);
  assert.deepEqual(await download.json(), second);
});

test("legacy Email KV progress migrates into the Durable Object without stale overwrite", async () => {
  const env = makeEnv();
  const legacy = progressPayload(0, "legacy-without-trusted-revision");
  env.PROGRESS_KV.values.set("progress:email:user-id", JSON.stringify(legacy));
  const token = await __test.issueSession({ provider: "email", email: "student@example.com", user_id: "user-id" }, env);

  const stale = await putProgress(env, token, progressPayload(2, "old-device"), 0);
  assert.equal(stale.status, 409);

  const download = await worker.fetch(new Request("https://worker.example/progress", {
    headers: { Authorization: `Bearer ${token}`, Origin: APP_ORIGIN }
  }), env);
  assert.deepEqual(await download.json(), legacy);

  const fresh = progressPayload(1, "merged");
  assert.equal((await putProgress(env, token, fresh, 0, true)).status, 200);
  assert.equal(JSON.parse(env.PROGRESS_KV.values.get("progress:email:user-id")).state.revision, 0);
});

test("GitHub Gist progress is serialized in a per-user Durable Object", async t => {
  const env = makeEnv();
  const token = await __test.issueSession({
    provider: "github",
    access_token: "github-access-token",
    user_id: "12345"
  }, env);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let remote = null;
  let writes = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/gists" && (!init.method || init.method === "GET")) {
      return Response.json(remote ? [{ id: "gist-1", files: { "rong-data-interview-progress.json": {} } }] : []);
    }
    if (url.pathname === "/gists/gist-1" && (!init.method || init.method === "GET")) {
      return Response.json({ files: { "rong-data-interview-progress.json": { content: JSON.stringify(remote) } } });
    }
    if ((url.pathname === "/gists" && init.method === "POST") || (url.pathname === "/gists/gist-1" && init.method === "PATCH")) {
      const requestBody = JSON.parse(init.body);
      remote = JSON.parse(requestBody.files["rong-data-interview-progress.json"].content);
      writes += 1;
      return Response.json({ id: "gist-1" });
    }
    throw new Error(`Unexpected GitHub request: ${init.method || "GET"} ${url}`);
  };

  assert.equal((await putProgress(env, token, progressPayload(1, "first"), 0)).status, 200);
  const concurrent = await Promise.all([
    putProgress(env, token, progressPayload(2, "winner-a"), 1),
    putProgress(env, token, progressPayload(3, "winner-b"), 1)
  ]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  assert.equal(writes, 2);

  const download = await worker.fetch(new Request("https://worker.example/progress", {
    headers: { Authorization: `Bearer ${token}`, Origin: APP_ORIGIN }
  }), env);
  assert.equal(download.status, 200);
  assert.ok([2, 3].includes((await download.json()).state.revision));
});
