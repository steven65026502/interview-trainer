# Interview Trainer Sync Worker

這個 Cloudflare Worker 負責資料工程面試訓練台的雲端同步。GitHub Pages 仍然只放靜態 HTML；登入、寄信、session 加密與雲端進度都在 Worker 端處理。

## 支援的登入方式

- GitHub OAuth：登入後把進度存到使用者自己的 private Gist。
- Email 驗證碼：輸入 Email 後寄出 6 位驗證碼與登入連結，登入後把進度存到 Cloudflare KV。

## Email 登入流程

1. 前端呼叫 `POST /email/start`，送出 Email 與回跳網址。
2. Worker 產生 6 位驗證碼與一次性登入 token，雜湊後存進 `PROGRESS_KV`，10 分鐘後自動失效。
3. Worker 透過 Resend 寄出驗證碼與登入連結。
4. 使用者可以：
   - 點信中的登入連結，Worker 會完成驗證並回跳到訓練台。
   - 或在訓練台輸入 6 位驗證碼，前端呼叫 `POST /email/verify`。
5. Worker 回傳加密 session，前端之後用 `GET /progress` / `PUT /progress` 同步進度。

## Cloudflare Worker 設定

```powershell
cd 求職與工作/interview-trainer-oauth-worker
npx wrangler login
```

建立 KV namespace：

```powershell
npx wrangler kv namespace create interview_trainer_progress
npx wrangler kv namespace create interview_trainer_progress --preview
```

把輸出的 `id` / `preview_id` 填進 `wrangler.toml`，並取消註解：

```toml
[[kv_namespaces]]
binding = "PROGRESS_KV"
id = "你的 namespace id"
preview_id = "你的 preview namespace id"
```

設定 secrets：

```powershell
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEND_API_KEY
```

`SESSION_SECRET` 建議用 32 字元以上的隨機字串。`RESEND_API_KEY` 是 Resend 的 API key。

設定寄件人：

```toml
[vars]
EMAIL_FROM = "Data Interview Trainer <onboarding@resend.dev>"
```

正式使用時建議改成你已驗證網域的寄件地址，例如：

```toml
EMAIL_FROM = "Data Interview Trainer <login@your-domain.com>"
```

部署：

```powershell
npx wrangler deploy
```

部署完成後，把 Worker URL 貼到訓練台右側「同步服務 URL」。

## GitHub OAuth 設定

如果也要保留 GitHub 登入，建立 GitHub OAuth App：

- Homepage URL：`https://steven65026502.github.io/interview-trainer/`
- Authorization callback URL：`https://你的-worker.workers.dev/auth/callback`

把 Client ID 填到 `wrangler.toml`：

```toml
GITHUB_CLIENT_ID = "你的 GitHub OAuth Client ID"
```

再設定 secret：

```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET
```

## 測試模式

開發時可以先在 `wrangler.toml` 打開：

```toml
EMAIL_DEBUG = "true"
```

這時如果還沒設定 Resend，`POST /email/start` 會直接回傳 `debugCode`，方便本機測試。正式部署前請關掉。

## 參考

- GitHub OAuth flow: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Workers KV: https://developers.cloudflare.com/kv/
- Resend Email API: https://www.resend.com/docs/api-reference/emails/send-email
