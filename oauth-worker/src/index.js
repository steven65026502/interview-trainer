const PROGRESS_FILE = "rong-data-interview-progress.json";
const GITHUB_API = "https://api.github.com";
const RESEND_API = "https://api.resend.com/emails";
const EMAIL_CHALLENGE_TTL_SECONDS = 10 * 60;
const EMAIL_RATE_LIMIT_SECONDS = 60;
const MAX_EMAIL_ATTEMPTS = 5;

function json(data, init = {}, env) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(env),
      ...(init.headers || {})
    }
  });
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.APP_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type"
  };
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function randomCode() {
  const numbers = new Uint32Array(1);
  crypto.getRandomValues(numbers);
  return String(numbers[0] % 1000000).padStart(6, "0");
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email 格式不正確");
  return email;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

async function aesKey(env) {
  const keyBytes = await sha256(env.SESSION_SECRET);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmacDigestText(text, env) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(text));
  return base64Url(new Uint8Array(sig));
}

async function signPayload(payload, env) {
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(sig))}`;
}

async function verifySignedPayload(token, env) {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("Invalid state");
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(env),
    fromBase64Url(signature),
    new TextEncoder().encode(body)
  );
  if (!ok) throw new Error("Invalid state signature");
  return JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
}

async function encryptSession(payload, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(env),
    new TextEncoder().encode(JSON.stringify(payload))
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(cipher))}`;
}

async function decryptSession(token, env) {
  const [version, ivText, cipherText] = token.split(".");
  if (version !== "v1" || !ivText || !cipherText) throw new Error("Invalid session");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivText) },
    await aesKey(env),
    fromBase64Url(cipherText)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function validatedRedirect(rawRedirect, env) {
  const fallback = `${env.APP_ORIGIN}/interview-trainer/`;
  const redirect = rawRedirect || fallback;
  if (!redirect.startsWith(env.APP_ORIGIN)) return fallback;
  return redirect;
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

function requireKv(env) {
  if (!env.PROGRESS_KV) throw new Error("Cloudflare KV 尚未綁定 PROGRESS_KV");
  return env.PROGRESS_KV;
}

async function readJsonKv(env, key) {
  const text = await requireKv(env).get(key);
  return text ? JSON.parse(text) : null;
}

async function writeJsonKv(env, key, value, options = {}) {
  await requireKv(env).put(key, JSON.stringify(value), options);
}

async function deleteKv(env, key) {
  await requireKv(env).delete(key);
}

async function emailUserId(email, env) {
  return hmacDigestText(`email-user:${email}`, env);
}

function emailChallengeKey(challengeId) {
  return `email-challenge:${challengeId}`;
}

function emailRateKey(userId) {
  return `email-rate:${userId}`;
}

function emailProgressKey(userId) {
  return `progress:email:${userId}`;
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error((data && data.message) || `GitHub API ${response.status}`);
  }
  return data;
}

async function sessionFromRequest(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Not signed in");
  const session = await decryptSession(match[1], env);
  if (session.provider === "email") {
    if (!session.email || !session.user_id) throw new Error("Invalid email session");
    return session;
  }
  if (!session.access_token) throw new Error("Invalid GitHub session");
  return {
    provider: "github",
    access_token: session.access_token,
    scope: session.scope,
    createdAt: session.createdAt
  };
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
  return JSON.parse(file.content);
}

async function writeGithubProgress(token, payload) {
  const content = JSON.stringify(payload, null, 2);
  const gist = await findProgressGist(token);
  const body = {
    description: "Rong data interview learning progress",
    public: false,
    files: {
      [PROGRESS_FILE]: { content }
    }
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

async function readProgressForSession(session, env) {
  if (session.provider === "email") {
    return readJsonKv(env, emailProgressKey(session.user_id));
  }
  return readGithubProgress(session.access_token);
}

async function writeProgressForSession(session, payload, env) {
  if (session.provider === "email") {
    await writeJsonKv(env, emailProgressKey(session.user_id), payload, {
      metadata: {
        provider: "email",
        email: session.email,
        updatedAt: new Date().toISOString()
      }
    });
    return { ok: true };
  }
  return writeGithubProgress(session.access_token, payload);
}

async function handleAuthStart(request, env) {
  const url = new URL(request.url);
  const redirect = validatedRedirect(url.searchParams.get("redirect"), env);
  const state = await signPayload({ redirect, nonce: crypto.randomUUID(), createdAt: Date.now() }, env);
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("scope", "gist read:user");
  github.searchParams.set("state", state);
  return Response.redirect(github.toString(), 302);
}

async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateText = url.searchParams.get("state");
  if (!code || !stateText) return json({ error: "Missing OAuth code or state" }, { status: 400 }, env);
  const state = await verifySignedPayload(stateText, env);
  if (Date.now() - Number(state.createdAt || 0) > 10 * 60 * 1000) {
    return json({ error: "OAuth state expired" }, { status: 400 }, env);
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code
    })
  });
  const tokenData = await response.json();
  if (!response.ok || !tokenData.access_token) {
    return json({ error: tokenData.error_description || "GitHub OAuth exchange failed" }, { status: 400 }, env);
  }
  const session = await encryptSession({
    provider: "github",
    access_token: tokenData.access_token,
    scope: tokenData.scope,
    createdAt: Date.now()
  }, env);
  return Response.redirect(withHashParam(state.redirect, "github_sync", session), 302);
}

function emailBody(email, code, magicLink) {
  const safeEmail = escapeHtml(email);
  const safeCode = escapeHtml(code);
  const safeLink = escapeHtml(magicLink);
  return {
    subject: "資料工程面試訓練台登入驗證碼",
    text: [
      "你的資料工程面試訓練台登入驗證碼：",
      "",
      code,
      "",
      "你也可以直接打開這個登入連結：",
      magicLink,
      "",
      "這個驗證碼 10 分鐘後失效。如果不是你本人操作，可以忽略這封信。"
    ].join("\n"),
    html: `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.6; color:#17201d;">
        <h2 style="margin:0 0 12px;">資料工程面試訓練台登入</h2>
        <p>這封信是寄給 <strong>${safeEmail}</strong> 的登入驗證。</p>
        <p style="font-size:26px; letter-spacing:6px; font-weight:700; margin:18px 0;">${safeCode}</p>
        <p><a href="${safeLink}" style="display:inline-block; padding:10px 14px; border-radius:6px; background:#1f6f5b; color:#fff; text-decoration:none;">直接登入並同步進度</a></p>
        <p style="color:#5e6b66; font-size:13px;">驗證碼 10 分鐘後失效。如果不是你本人操作，可以忽略這封信。</p>
      </div>
    `
  };
}

async function sendVerificationEmail({ email, code, magicLink, challengeId }, env) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (env.EMAIL_DEBUG === "true") return { debug: true };
    throw new Error("Email 寄送尚未設定 RESEND_API_KEY / EMAIL_FROM");
  }
  const message = emailBody(email, code, magicLink);
  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "rong-interview-trainer-worker/1.0",
      "Idempotency-Key": `email-login-${challengeId}`
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: message.subject,
      text: message.text,
      html: message.html
    })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error((data && data.message) || (data && data.error && data.error.message) || `Resend API ${response.status}`);
  }
  return data;
}

async function handleEmailStart(request, env) {
  const body = await request.json();
  const email = normalizeEmail(body.email);
  const redirect = validatedRedirect(body.redirect, env);
  const userId = await emailUserId(email, env);
  const rateKey = emailRateKey(userId);
  if (await requireKv(env).get(rateKey)) {
    return json({ error: "驗證信剛寄出，請 60 秒後再試一次。" }, { status: 429 }, env);
  }

  const challengeId = crypto.randomUUID();
  const code = randomCode();
  const token = randomToken();
  const challenge = {
    email,
    userId,
    redirect,
    codeHash: await hmacDigestText(`email-code:${challengeId}:${code}`, env),
    tokenHash: await hmacDigestText(`email-token:${challengeId}:${token}`, env),
    attempts: 0,
    createdAt: Date.now()
  };
  await writeJsonKv(env, emailChallengeKey(challengeId), challenge, { expirationTtl: EMAIL_CHALLENGE_TTL_SECONDS });
  await requireKv(env).put(rateKey, "1", { expirationTtl: EMAIL_RATE_LIMIT_SECONDS });

  const callback = new URL("/email/callback", request.url);
  callback.searchParams.set("challenge", challengeId);
  callback.searchParams.set("token", token);
  await sendVerificationEmail({ email, code, magicLink: callback.toString(), challengeId }, env);

  const result = { ok: true, challengeId, email, expiresIn: EMAIL_CHALLENGE_TTL_SECONDS };
  if (env.EMAIL_DEBUG === "true") {
    result.debugCode = code;
    result.debugLink = callback.toString();
  }
  return json(result, {}, env);
}

async function completeEmailChallenge({ challengeId, email, code, token }, env) {
  if (!challengeId) throw new Error("缺少驗證流程 ID");
  const key = emailChallengeKey(challengeId);
  const challenge = await readJsonKv(env, key);
  if (!challenge) throw new Error("驗證碼已失效，請重新寄送");
  if (challenge.attempts >= MAX_EMAIL_ATTEMPTS) {
    await deleteKv(env, key);
    throw new Error("嘗試次數過多，請重新寄送驗證信");
  }

  let verified = false;
  if (token) {
    const tokenHash = await hmacDigestText(`email-token:${challengeId}:${token}`, env);
    verified = tokenHash === challenge.tokenHash;
  } else {
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail !== challenge.email) throw new Error("Email 與驗證信不一致");
    const codeHash = await hmacDigestText(`email-code:${challengeId}:${code}`, env);
    verified = codeHash === challenge.codeHash;
  }

  if (!verified) {
    challenge.attempts += 1;
    const elapsed = Math.floor((Date.now() - Number(challenge.createdAt || Date.now())) / 1000);
    const remaining = Math.max(60, EMAIL_CHALLENGE_TTL_SECONDS - elapsed);
    await writeJsonKv(env, key, challenge, { expirationTtl: remaining });
    throw new Error("驗證碼不正確");
  }

  await deleteKv(env, key);
  const session = await encryptSession({
    provider: "email",
    email: challenge.email,
    user_id: challenge.userId,
    createdAt: Date.now()
  }, env);
  return {
    session,
    email: challenge.email,
    redirect: challenge.redirect
  };
}

async function handleEmailVerify(request, env) {
  const body = await request.json();
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
    const workerOrigin = new URL(request.url).origin;
    return Response.redirect(withHashParams(result.redirect, {
      email_sync: result.session,
      email_account: result.email,
      sync_worker: workerOrigin
    }), 302);
  } catch (error) {
    return Response.redirect(withHashParam(`${env.APP_ORIGIN}/interview-trainer/`, "email_sync_error", error.message || "Email login failed"), 302);
  }
}

async function handleApi(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
  const url = new URL(request.url);
  try {
    if (url.pathname === "/auth/start" && request.method === "GET") return handleAuthStart(request, env);
    if (url.pathname === "/auth/callback" && request.method === "GET") return handleAuthCallback(request, env);
    if (url.pathname === "/email/start" && request.method === "POST") return handleEmailStart(request, env);
    if (url.pathname === "/email/verify" && request.method === "POST") return handleEmailVerify(request, env);
    if (url.pathname === "/email/callback" && request.method === "GET") return handleEmailCallback(request, env);
    if (url.pathname === "/logout" && request.method === "POST") return json({ ok: true }, {}, env);

    const session = await sessionFromRequest(request, env);
    if (url.pathname === "/me" && request.method === "GET") {
      if (session.provider === "email") return json({ provider: "email", email: session.email }, {}, env);
      const user = await githubFetch("/user", session.access_token);
      return json({ provider: "github", login: user.login, avatar_url: user.avatar_url }, {}, env);
    }
    if (url.pathname === "/progress" && request.method === "GET") {
      const payload = await readProgressForSession(session, env);
      if (!payload) return json({ error: "No cloud progress found" }, { status: 404 }, env);
      return json(payload, {}, env);
    }
    if (url.pathname === "/progress" && request.method === "PUT") {
      const payload = await request.json();
      await writeProgressForSession(session, payload, env);
      return json({ ok: true }, {}, env);
    }
    return json({ error: "Not found" }, { status: 404 }, env);
  } catch (error) {
    return json({ error: error.message || "Worker error" }, { status: 400 }, env);
  }
}

export default {
  fetch: handleApi
};
