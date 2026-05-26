# Interview Trainer OAuth Worker

這個 Cloudflare Worker 讓 GitHub Pages 上的面試訓練台可以用「GitHub 登入」同步進度，不需要在前端手動貼 GitHub token。

## 架構

- 前端：`https://steven65026502.github.io/interview-trainer/`
- Worker：處理 GitHub OAuth callback，並代替前端讀寫 private Gist
- GitHub OAuth scope：`gist read:user`
- 進度檔：`rong-data-interview-progress.json`

## GitHub OAuth App

在 GitHub 建 OAuth App：

- Homepage URL：`https://steven65026502.github.io/interview-trainer/`
- Authorization callback URL：`https://你的-worker.workers.dev/auth/callback`

建立後，把 Client ID 填到 `wrangler.toml` 的 `GITHUB_CLIENT_ID`。

## Cloudflare Worker 部署

```powershell
cd 求職與工作/interview-trainer-oauth-worker
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

`SESSION_SECRET` 可以是一段長隨機字串，例如密碼管理器產生的 32 字元以上字串。

部署完成後，把 Worker URL 貼到訓練台「OAuth Worker URL」，按「用 GitHub 登入」。

## 參考

- GitHub OAuth flow: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
