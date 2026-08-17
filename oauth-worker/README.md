# Rong AI 應用與資料整合求職工作台 Sync Worker

這個 Cloudflare Worker 為 GitHub Pages 上的「Rong AI 應用與資料整合求職工作台」提供兩種登入與進度同步方式：

- GitHub OAuth：將進度保存到使用者自己的 private Gist。
- Email 驗證：將進度保存到每位使用者專屬的 SQLite-backed Durable Object。

## 安全模型

- OAuth `state` 會綁定 `HttpOnly; Secure; SameSite=Lax` cookie，並在 Durable Object 中一次性消耗；GitHub 流程同時使用 PKCE。
- Email 寄送頻率、驗證嘗試次數、OAuth pending state 及 session jti 都由 SQLite-backed Durable Object 原子管理；OAuth 起始請求另有單一 IP 速率限制，過期紀錄由 alarm 分頁回收。
- Session 有 24 小時有效期；`POST /logout` 會撤銷 jti，舊 bearer 無法再使用。
- Worker 不會透過 HTTP 回傳 Email 驗證碼或 magic link。需要本機測試時，請 mock Resend，不要在公開 Worker 加入 debug code 回傳模式。
- Email JSON body 上限 4 KiB；進度 JSON body 上限 1 MiB，並要求正確的 `application/json` 與進度 envelope。
- `/progress` PUT 使用 `baseRevision` 與 `baseExists` 做 optimistic concurrency control；舊 snapshot（包含沒有 revision 的舊版檔案）會收到 HTTP 409，不會覆蓋較新進度。GitHub Gist 的讀取、比較與寫入也會在每位使用者專屬的 Durable Object 中串行執行。
- Email 使用者 ID 保留舊版推導方式；若仍綁定 `PROGRESS_KV`，既有 KV 進度會在第一次讀寫時遷移到 Durable Object，KV 之後只作相容讀取、不再接受新寫入。
- 新版 GitHub session 會保存穩定的 GitHub user ID，確保同帳號的 Gist 操作進入同一個 Durable Object；部署前取得、缺少此 ID 的舊 session 需重新登入。

## 前置需求

- Node.js 20 以上
- Cloudflare 帳號與 Wrangler
- GitHub OAuth App（若啟用 GitHub 登入）
- Resend API key 與已驗證寄件網域（若啟用 Email 登入）

## 設定

安裝／登入 Wrangler：

```powershell
cd oauth-worker
npx --yes wrangler@4.123.0 login
```

新安裝不需要建立 KV。只有需要遷移舊版 Email 進度時，才保留原本存有資料的既有 KV namespace；新建的空 namespace 無法遷移舊資料。可先列出帳號內的 namespace，確認原 id：

```powershell
npx --yes wrangler@4.123.0 kv namespace list
```

若有舊資料，把既有 namespace id 寫入 `wrangler.toml` 並取消 KV binding 註解：

```toml
[[kv_namespaces]]
binding = "PROGRESS_KV"
id = "你的 production namespace id"
preview_id = "你的 preview namespace id"
```

`wrangler.toml` 已包含新的 Durable Object binding 與首次部署 migration：

```toml
[[durable_objects.bindings]]
name = "AUTH_COORDINATOR"
class_name = "AuthCoordinator"

[[migrations]]
tag = "v1-auth-coordinator"
new_sqlite_classes = ["AuthCoordinator"]
```

請保留 migration；首次 `wrangler deploy` 會建立 SQLite-backed Durable Object namespace。

設定 secrets：

```powershell
npx --yes wrangler@4.123.0 secret put SESSION_SECRET
npx --yes wrangler@4.123.0 secret put RESEND_API_KEY
npx --yes wrangler@4.123.0 secret put GITHUB_CLIENT_SECRET
```

`SESSION_SECRET` 必須至少 32 bytes，建議使用密碼管理器產生 32 bytes 以上的隨機值。Worker 在 secret 缺漏或過短時會 fail closed 並回傳 HTTP 500。

確認 `wrangler.toml` 的公開設定：

```toml
[vars]
APP_ORIGIN = "https://steven65026502.github.io"
GITHUB_CLIENT_ID = "你的 GitHub OAuth Client ID"
EMAIL_FROM = "Rong AI 應用與資料整合求職工作台 <login@your-domain.com>"
```

允許的登入返回頁固定為：

```text
https://steven65026502.github.io/interview-trainer/
```

Worker 會拒絕不同 origin、不同 pathname、含帳密／query／fragment 或超長的 redirect URL。

## GitHub OAuth App

建立 GitHub OAuth App 並設定：

- Homepage URL：`https://steven65026502.github.io/interview-trainer/`
- Authorization callback URL：`https://你的-worker.workers.dev/auth/callback`

Client ID 放在 `wrangler.toml`；Client secret 只能用 `wrangler secret put GITHUB_CLIENT_SECRET` 設定。

## 測試

測試不需要外部套件：

```powershell
npm test
```

測試涵蓋 redirect allowlist、缺少 secret、公開 debug 資料移除、OAuth state cookie／一次性與速率限制、超過 128 筆過期紀錄的分頁回收、session 到期與撤銷、Content-Type 與 body size 上限、Email／GitHub CAS 衝突，以及前端 409 停寫與衝突副本保留。

也可以做 Wrangler dry run：

```powershell
npx --yes wrangler@4.123.0 deploy --dry-run
```

## 部署

```powershell
npx --yes wrangler@4.123.0 deploy
```

部署後把 Worker URL 填入「Rong AI 應用與資料整合求職工作台」的「同步服務 URL」。正式環境不要加入任何會把驗證碼、magic link、session 或 secret 寫到 response、console 或 Git 的除錯功能。

## 參考

- [GitHub OAuth web flow](https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers KV](https://developers.cloudflare.com/kv/)
- [Resend Email API](https://resend.com/docs/api-reference/emails/send-email)
