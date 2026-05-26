const PROGRESS_FILE = "rong-data-interview-progress.json";
const GITHUB_API = "https://api.github.com";

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

async function tokenFromRequest(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Not signed in");
  const session = await decryptSession(match[1], env);
  if (!session.access_token) throw new Error("Invalid session");
  return session.access_token;
}

async function findProgressGist(token) {
  const gists = await githubFetch("/gists?per_page=100", token);
  return gists.find(gist => gist.files && gist.files[PROGRESS_FILE]) || null;
}

async function readProgress(token) {
  const gist = await findProgressGist(token);
  if (!gist) return null;
  const full = await githubFetch(`/gists/${gist.id}`, token);
  const file = full.files[PROGRESS_FILE];
  if (!file || !file.content) return null;
  return JSON.parse(file.content);
}

async function writeProgress(token, payload) {
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
    access_token: tokenData.access_token,
    scope: tokenData.scope,
    createdAt: Date.now()
  }, env);
  return Response.redirect(withHashParam(state.redirect, "github_sync", session), 302);
}

async function handleApi(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
  const url = new URL(request.url);
  try {
    if (url.pathname === "/auth/start" && request.method === "GET") return handleAuthStart(request, env);
    if (url.pathname === "/auth/callback" && request.method === "GET") return handleAuthCallback(request, env);
    if (url.pathname === "/logout" && request.method === "POST") return json({ ok: true }, {}, env);

    const token = await tokenFromRequest(request, env);
    if (url.pathname === "/me" && request.method === "GET") {
      const user = await githubFetch("/user", token);
      return json({ login: user.login, avatar_url: user.avatar_url }, {}, env);
    }
    if (url.pathname === "/progress" && request.method === "GET") {
      const payload = await readProgress(token);
      if (!payload) return json({ error: "No cloud progress found" }, { status: 404 }, env);
      return json(payload, {}, env);
    }
    if (url.pathname === "/progress" && request.method === "PUT") {
      const payload = await request.json();
      await writeProgress(token, payload);
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
