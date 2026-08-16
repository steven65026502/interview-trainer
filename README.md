# Rong Data Interview Learning Console

這個 repository 是資料工程面試訓練台的 GitHub Pages 發布版本。

## 入口

- GitHub Pages：`https://steven65026502.github.io/interview-trainer/`
- 8 週學習表：`https://steven65026502.github.io/interview-trainer/roadmap.html`
- 模擬面試主頁：`index.html`
- 學習工作台：`roadmap.html`

## 功能重點

- 28 天資料工程學習路線。
- 每一課先完成一個主資源；其餘影片／文件為選修，再通過學習檢核解鎖挑戰題。
- 模擬面試題支援作答、追問、自評檢核與回饋。
- 8 週 Python、SQL、FastAPI、pytest、Docker、LeetCode、RAG 與面試衝刺表。
- 每週六個實作任務、三個能力閘門、No-AI 驗收、筆記、日期排程與「下一個任務」提示。
- 80% 共通核心＋20% 主線選修，可切換 Python 後端、資料工程、SDET 或 AI 應用。
- 17 個已於 2026-08-16 核實的 YouTube / Bilibili 資源，支援主／備用標記、篩選與觀看實作進度。
- 90 分鐘面試驗收採共通 70 分＋主線 30 分，畫面直接顯示評分錨點。
- 學習表可匯出／匯入 JSON 備份；匯入資料會驗證格式、欄位與大小，匯入或重設前可復原。
- 本機使用 `localStorage` 自動保存。
- 雲端同步支援 GitHub Gist、GitHub OAuth，以及 Email 驗證碼登入。

## 資料與瀏覽器安全

- 學習表只接受已知版本與欄位；筆記、分數與匯入碼不會直接當成 HTML 執行。
- GitHub Gist token 與 OAuth / Email session 不再寫入持久的 `localStorage`，只保留在目前分頁的 `sessionStorage`；關閉分頁後需重新登入或輸入 token。
- 「清空練習」、「重設學習表」與「清除同步設定」都有確認；前兩者提供一次本機復原。
- 介面以近期版本的 Chrome、Edge、Firefox 與 Safari 為支援基線。

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
