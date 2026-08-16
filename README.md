# Rong Data Interview Learning Console

這個 repository 是資料工程面試訓練台的 GitHub Pages 發布版本。

## 入口

- GitHub Pages：`https://steven65026502.github.io/interview-trainer/`
- 8 週學習表：`https://steven65026502.github.io/interview-trainer/roadmap.html`
- 模擬面試主頁：`index.html`
- 學習工作台：`roadmap.html`

## 功能重點

- 28 天資料工程學習路線。
- 每一課依序完成文字教學、影片/文件資源、學習檢核，再解鎖挑戰題。
- 模擬面試題支援作答、追問、自評檢核與回饋。
- 8 週 Python、SQL、FastAPI、pytest、Docker、LeetCode、RAG 與面試衝刺表。
- 每週六個實作任務、三個能力閘門、No-AI 驗收、筆記與日期排程。
- 已核實的 YouTube / Bilibili 影片資源庫，以及角色別面試驗收表。
- 學習表可匯出／匯入 JSON 備份，完成狀態與分數會自動保存。
- 本機使用 `localStorage` 自動保存。
- 雲端同步支援 GitHub Gist、GitHub OAuth，以及 Email 驗證碼登入。

## Email 雲端同步

前端 UI 已放在 `index.html` 的「進度同步」區塊。真正的 Email 驗證、寄信、session 加密與雲端進度儲存由 `oauth-worker/` 內的 Cloudflare Worker 負責。

部署 Worker 前，需要設定：

- Cloudflare KV：綁定名稱 `PROGRESS_KV`
- Worker secret：`SESSION_SECRET`
- Worker secret：`RESEND_API_KEY`
- Worker var：`EMAIL_FROM`

詳細步驟見：

- `oauth-worker/README.md`

## GitHub OAuth 同步

GitHub OAuth 仍然保留，適合直接把進度存在使用者自己的 private Gist。

詳細設定同樣見：

- `oauth-worker/README.md`
