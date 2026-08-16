import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `function ${name}`;
  let start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist in index.html`);
  if (html.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const signatureStart = html.indexOf("(", start);
  let signatureDepth = 0;
  let signatureEnd = signatureStart;
  for (; signatureEnd < html.length; signatureEnd += 1) {
    if (html[signatureEnd] === "(") signatureDepth += 1;
    if (html[signatureEnd] === ")") signatureDepth -= 1;
    if (signatureDepth === 0) break;
  }
  const bodyStart = html.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === "{") depth += 1;
    if (html[index] === "}") depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test("OAuth upload stops on 409, preserves both copies, and never overwrites the newer remote value", async () => {
  const calls = [];
  const state = { revision: 1, answers: ["local"] };
  const syncSettings = { oauthBaseRevision: null, oauthBaseExists: null };
  let mergeOptions = null;
  let conflict = null;
  let persisted = false;
  const context = {
    authProviderLabel: () => "Email",
    flushScheduledSave: () => undefined,
    oauthSyncReady: () => true,
    persistSyncStorage: () => { persisted = true; },
    progressPayload: () => ({
      app: "rong-data-interview-learning-console",
      version: 4,
      state: structuredClone(state)
    }),
    safeRevision: value => Number.isSafeInteger(value) && value >= 0 ? value : 0,
    save: () => { state.revision += 1; },
    setSyncStatus: () => undefined,
    state,
    syncSettings,
    validatedProgressState: payload => payload.state,
    applyProgressPayload: (payload, options) => {
      mergeOptions = options;
      state.answers = [...payload.state.answers];
      state.revision = Math.max(state.revision, payload.state.revision) + 1;
    },
    preserveSyncConflict: (provider, local, remote) => { conflict = { provider, local, remote }; },
    fetchOAuthWorker: async (path, options = {}) => {
      calls.push({ path, options });
      if (calls.length === 1) {
        const conflict = new Error("Progress conflict");
        conflict.status = 409;
        throw conflict;
      }
      if (calls.length === 2) {
        assert.equal(path, "/progress");
        assert.equal(options.method, undefined);
        return { app: "rong-data-interview-learning-console", version: 4, state: { revision: 5, answers: ["remote"] } };
      }
      throw new Error("a retry must not happen");
    }
  };
  vm.createContext(context);
  await assert.rejects(
    vm.runInContext(`${extractFunction("uploadProgressWithOAuth")}; uploadProgressWithOAuth(false);`, context),
    /未覆寫雲端/
  );

  assert.equal(mergeOptions.merge, true);
  assert.equal(mergeOptions.preferIncoming, true);
  assert.equal(persisted, true);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].options.body).baseRevision, 0);
  assert.deepEqual(conflict.local.state.answers, ["local"]);
  assert.deepEqual(conflict.remote.state.answers, ["remote"]);
  assert.deepEqual(state.answers, ["remote"]);
  assert.equal(syncSettings.oauthBaseRevision, 5);
  assert.equal(syncSettings.oauthBaseExists, true);
});

test("OAuth redirect canonicalizes index.html, query, and hash to the app directory", () => {
  const context = {
    URL,
    window: { location: { href: "https://steven65026502.github.io/interview-trainer/index.html?sync=1#learn" } }
  };
  vm.createContext(context);
  const result = vm.runInContext(`${extractFunction("oauthRedirectUrl")}; oauthRedirectUrl();`, context);
  assert.equal(result, "https://steven65026502.github.io/interview-trainer/");
});

test("first OAuth download backs up meaningful local work and gives newer remote text priority", async () => {
  const state = { revision: 3, answers: ["old local answer"] };
  const syncSettings = { oauthBaseRevision: null, oauthBaseExists: null };
  const remote = { app: "rong-data-interview-learning-console", version: 4, state: { revision: 8, answers: ["new remote answer"] } };
  let conflict = null;
  let mergeOptions = null;
  let syncStatus = "";
  const context = {
    applyProgressPayload: (payload, options) => {
      mergeOptions = options;
      state.answers = [...payload.state.answers];
    },
    authProviderLabel: () => "Email",
    fetchOAuthWorker: async () => remote,
    hasMeaningfulProgress: () => true,
    oauthSyncReady: () => true,
    persistSyncStorage: () => undefined,
    preserveSyncConflict: (provider, local, latest) => { conflict = { provider, local, latest }; },
    progressPayload: () => ({ app: "rong-data-interview-learning-console", version: 4, state: structuredClone(state) }),
    safeRevision: value => Number.isSafeInteger(value) && value >= 0 ? value : 0,
    setSyncStatus: message => { syncStatus = message; },
    state,
    syncSettings,
    uploadProgressWithOAuth: async () => true,
    validatedProgressState: payload => payload.state
  };
  vm.createContext(context);
  const result = await vm.runInContext(`${extractFunction("downloadProgressWithOAuth")}; downloadProgressWithOAuth(false);`, context);

  assert.equal(result, true);
  assert.equal(mergeOptions.merge, true);
  assert.equal(mergeOptions.preferIncoming, true);
  assert.deepEqual(conflict.local.state.answers, ["old local answer"]);
  assert.deepEqual(conflict.latest.state.answers, ["new remote answer"]);
  assert.deepEqual(state.answers, ["new remote answer"]);
  assert.equal(syncSettings.oauthBaseRevision, 8);
  assert.equal(syncSettings.oauthBaseExists, true);
  assert.match(syncStatus, /雲端同欄位優先，兩份副本已保留/);
});

test("manual import cannot advance the trusted synchronization revision", () => {
  assert.match(html, /applyProgressPayload\(payload, \{ merge: true, trustRevision: false \}\)/);
  assert.match(html, /if \(options\.trustRevision !== false\) \{\s*state\.revision = Math\.max/);
});

test("direct-token Gist upload stops before PATCH when the remote version moved", async () => {
  const calls = [];
  const state = { revision: 7, answers: ["stale-local"] };
  const syncSettings = {
    token: "token",
    gistId: "gist-1",
    gistBaseRevision: 5,
    gistBaseVersion: "version-5"
  };
  let conflict = null;
  let mergeOptions = null;
  let syncStatus = "";
  const remote = {
    app: "rong-data-interview-learning-console",
    version: 4,
    state: { revision: 6, answers: ["new-remote"] }
  };
  const context = {
    JSON,
    TextEncoder,
    applyProgressPayload: (payload, options) => {
      mergeOptions = options;
      state.answers = [...payload.state.answers];
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          id: "gist-1",
          history: [{ version: "version-6" }],
          files: { "rong-data-interview-progress.json": { content: JSON.stringify(remote) } }
        })
      };
    },
    findProgressGistId: async () => "gist-1",
    flushScheduledSave: () => undefined,
    gistVersion: gist => gist.history[0].version,
    persistSyncStorage: () => undefined,
    persistSyncSettings: () => undefined,
    preserveSyncConflict: (provider, local, latest) => { conflict = { provider, local, latest }; },
    progressGistFile: "rong-data-interview-progress.json",
    progressPayload: () => ({ app: "rong-data-interview-learning-console", version: 4, state: structuredClone(state) }),
    safeRevision: value => Number.isSafeInteger(value) && value >= 0 ? value : 0,
    save: () => undefined,
    saveSyncSettings: () => true,
    setSyncStatus: message => { syncStatus = message; },
    state,
    syncSettings,
    uploadProgressWithOAuth: async () => false,
    validatedProgressState: payload => payload.state
  };
  vm.createContext(context);
  await assert.rejects(
    vm.runInContext(`${extractFunction("uploadProgressToGist")}; uploadProgressToGist(false);`, context),
    /PATCH 已停止/
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
  assert.deepEqual(conflict.local.state.answers, ["stale-local"]);
  assert.deepEqual(conflict.latest.state.answers, ["new-remote"]);
  assert.equal(mergeOptions.merge, true);
  assert.equal(mergeOptions.preferIncoming, true);
  assert.deepEqual(state.answers, ["new-remote"]);
  assert.equal(syncSettings.gistBaseRevision, 6);
  assert.equal(syncSettings.gistBaseVersion, "version-6");
});

test("first direct-token download preserves local work and gives the Gist text priority", async () => {
  const state = { revision: 3, answers: ["old local answer"] };
  const syncSettings = {
    token: "token",
    gistId: "gist-1",
    gistBaseRevision: null,
    gistBaseVersion: ""
  };
  const remote = {
    app: "rong-data-interview-learning-console",
    version: 4,
    state: { revision: 8, answers: ["new gist answer"] }
  };
  let conflict = null;
  let mergeOptions = null;
  let syncStatus = "";
  const context = {
    JSON,
    TextEncoder,
    applyProgressPayload: (payload, options) => {
      mergeOptions = options;
      state.answers = [...payload.state.answers];
    },
    backupCurrentProgress: () => true,
    downloadProgressWithOAuth: async () => false,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        id: "gist-1",
        history: [{ version: "version-8" }],
        files: { "rong-data-interview-progress.json": { content: JSON.stringify(remote) } }
      })
    }),
    findProgressGistId: async () => "gist-1",
    gistVersion: gist => gist.history[0].version,
    hasMeaningfulProgress: () => true,
    persistSyncStorage: () => undefined,
    preserveSyncConflict: (provider, local, latest) => { conflict = { provider, local, latest }; },
    progressGistFile: "rong-data-interview-progress.json",
    progressPayload: () => ({ app: "rong-data-interview-learning-console", version: 4, state: structuredClone(state) }),
    safeRevision: value => Number.isSafeInteger(value) && value >= 0 ? value : 0,
    saveSyncSettings: () => true,
    setSyncStatus: message => { syncStatus = message; },
    state,
    syncSettings,
    validatedProgressState: payload => payload.state
  };
  vm.createContext(context);
  await vm.runInContext(`${extractFunction("downloadProgressFromGist")}; downloadProgressFromGist(true);`, context);

  assert.equal(mergeOptions.merge, true);
  assert.equal(mergeOptions.preferIncoming, true);
  assert.deepEqual(conflict.local.state.answers, ["old local answer"]);
  assert.deepEqual(conflict.latest.state.answers, ["new gist answer"]);
  assert.deepEqual(state.answers, ["new gist answer"]);
  assert.equal(syncSettings.gistBaseRevision, 8);
  assert.equal(syncSettings.gistBaseVersion, "version-8");
  assert.match(syncStatus, /雲端同欄位優先，兩份副本已保留/);
});

test("trusted undo save bypasses newer-state merge and persists the restored snapshot", () => {
  const state = { revision: 1, answers: [""] };
  const newerStored = { revision: 2, answers: ["value from the state being undone"] };
  let merged = false;
  let written = null;
  const context = {
    Date,
    JSON,
    Math,
    applyProgressPayload: () => { merged = true; },
    els: { saveState: { textContent: "" } },
    localStorage: {
      getItem: () => JSON.stringify(newerStored),
      setItem: (_key, value) => { written = JSON.parse(value); }
    },
    progressStateSnapshot: () => structuredClone(state),
    progressStorageKey: "progress",
    progressVersion: 4,
    safeRevision: value => Number.isSafeInteger(value) && value >= 0 ? value : 0,
    saveTimer: 0,
    setSyncStatus: () => undefined,
    state,
    window: { clearTimeout: () => undefined }
  };
  vm.createContext(context);
  const result = vm.runInContext(`${extractFunction("save")}; save({ mergeStored: false, silent: true });`, context);

  assert.equal(result, true);
  assert.equal(merged, false);
  assert.equal(written.revision, 3);
  assert.deepEqual(written.answers, [""]);
});

test("normal save treats a newer localStorage revision as incoming and preserves the old local copy", () => {
  const state = { revision: 1, answers: ["stale local"] };
  const newerStored = { revision: 2, answers: ["new other-tab answer"], version: 4 };
  let mergeOptions = null;
  let conflict = null;
  let written = null;
  const context = {
    Date,
    JSON,
    Math,
    applyProgressPayload: (payload, options) => {
      mergeOptions = options;
      state.answers = [...payload.state.answers];
      state.revision = payload.state.revision;
    },
    els: { saveState: { textContent: "" } },
    hasMeaningfulProgress: () => true,
    localStorage: {
      getItem: () => JSON.stringify(newerStored),
      setItem: (_key, value) => { written = JSON.parse(value); }
    },
    preserveSyncConflict: (provider, local, latest) => { conflict = { provider, local, latest }; },
    progressPayload: () => ({ app: "rong-data-interview-learning-console", version: 4, state: structuredClone(state) }),
    progressStateSnapshot: () => structuredClone(state),
    progressStorageKey: "progress",
    progressVersion: 4,
    safeRevision: value => Number.isSafeInteger(value) && value >= 0 ? value : 0,
    saveTimer: 0,
    setSyncStatus: () => undefined,
    state,
    window: { clearTimeout: () => undefined }
  };
  vm.createContext(context);
  const result = vm.runInContext(`${extractFunction("save")}; save({ silent: true });`, context);

  assert.equal(result, true);
  assert.equal(mergeOptions.merge, true);
  assert.equal(mergeOptions.preferIncoming, true);
  assert.deepEqual(conflict.local.state.answers, ["stale local"]);
  assert.deepEqual(conflict.latest.state.answers, ["new other-tab answer"]);
  assert.deepEqual(written.answers, ["new other-tab answer"]);
  assert.equal(written.revision, 3);
  assert.match(html, /applyProgressPayload\(incomingPayload, \{ merge: true, preferIncoming: true, persist: false \}\)/);
});
