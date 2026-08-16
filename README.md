# Rong 工程求職學習與面試工作台

這個 repository 是以 Python／資料工程能力為底、可依 Python 後端、資料工程、SDET 或 AI 應用主線練習的求職工作台。

## 入口

- GitHub Pages：`https://steven65026502.github.io/interview-trainer/`
- 8 週學習表：`https://steven65026502.github.io/interview-trainer/roadmap.html`
- 模擬面試主頁：`index.html`
- 學習工作台：`roadmap.html`

## 功能重點

- 28 天資料工程基礎路線；每課依序完成一個主資源、60 分文字理解與技術挑戰，兩階段都通過才解鎖下一天。
- 共通題庫加四職類角色題；切換主線時只計入該主線的題目與進度。
- 模擬面試支援作答、追問、自評檢核與啟發式回饋；回饋不會執行程式或 SQL，技術能力仍以 No-AI 實作與測試為準。
- 8 週 Python、SQL、FastAPI、pytest、Docker、LeetCode、RAG 與面試衝刺表。
- 每週實作任務、能力閘門、主線成果證據、No-AI 驗收、筆記、日期排程與「下一個任務」提示。
- 演算法逐題記錄難度、首次耗時、No-AI、AC、程式連結與錯題重做日期，自動統計 35 Easy／11 Medium；W8 另重做 6 題錯題。
- W2 保存 Python／SQL 基準，W4／W6／W8 分別保存五項 100 分驗收；日期、評分者、證據與分數依職類主線隔離。
- 80% 共通核心＋20% 主線成果，可切換 Python 後端、資料工程、SDET 或 AI 應用。
- 17 個已於 2026-08-16 核實的 YouTube / Bilibili 資源，支援主／備用標記、篩選與觀看實作進度。
- W4、W6、W8 驗收採 Python、SQL、主線實作、演算法、專案表達各 20 分，畫面直接顯示評分錨點。
- 學習表可匯出／匯入 JSON 備份；匯入資料會驗證格式、欄位與大小，匯入或重設前可復原。
- 本機使用 `localStorage` 自動保存。
- 雲端同步支援 GitHub Gist、GitHub OAuth，以及 Email 驗證碼登入。

## 資料與瀏覽器安全

- 學習表只接受已知版本與欄位；筆記、分數與匯入碼不會直接當成 HTML 執行。
- GitHub Gist token 與 OAuth / Email session 不寫入持久的 `localStorage`，只保留在目前分頁的 `sessionStorage`；關閉分頁後需重新登入或輸入 token。
- 同步 URL 只接受 HTTPS origin（本機開發可用 localhost HTTP）；匯入內容有版本、大小與欄位白名單，文字狀態以安全 DOM API 顯示。
- Email 與 GitHub OAuth 同步會用 revision／存在狀態做原子衝突檢查；遇到 HTTP 409 時會停止上傳、不自動重試，保留本機與遠端完整副本，並以遠端同欄位優先顯示，避免舊 snapshot 覆蓋新進度。
- 手動 GitHub personal-token 模式會記住最後下載的 Gist revision 與 history version；基準改變時會在 PATCH 前停止並保留兩份副本。GitHub Gist API 沒有可靠的原子 CAS，讀取與寫入之間仍有極小競爭視窗；多裝置同步建議使用 Worker 的 GitHub OAuth 或 Email 模式。
- 「清空練習」、「重設學習表」與「清除同步設定」都有確認；前兩者提供一次本機復原。
- 介面以近期版本的 Chrome、Edge、Firefox 與 Safari 為支援基線。
- 每次 push／pull request 會自動驗證 HTML、inline JavaScript、Worker 測試與 Wrangler dry-run。

## Email 雲端同步

前端 UI 已放在 `index.html` 的「進度同步」區塊。真正的 Email 驗證、寄信、session 加密與雲端進度儲存由 `oauth-worker/` 內的 Cloudflare Worker 負責。

部署 Worker 前，需要設定：

- Cloudflare Durable Object：綁定名稱 `AUTH_COORDINATOR`
- Cloudflare KV：只有遷移舊版 Email 進度時才保留 `PROGRESS_KV`
- Worker secret：`SESSION_SECRET`（至少 32 bytes）
- Worker secret：`RESEND_API_KEY`
- Worker var：`EMAIL_FROM`（正式環境使用已驗證網域）

詳細步驟見：

- `oauth-worker/README.md`

## GitHub OAuth 同步

GitHub OAuth 仍然保留，適合直接把進度存在使用者自己的 private Gist。

Worker 使用 PKCE、一次性 OAuth state cookie、24 小時可撤銷 session，以及 Email／OAuth 原子限流；修改 `oauth-worker/` 後必須重新部署 Worker，GitHub Pages 部署不會自動更新它。升級到目前版本後，既有 GitHub OAuth session 需要重新登入一次，才能取得穩定的 GitHub user ID 並啟用每位使用者的原子同步。

詳細設定同樣見：

- `oauth-worker/README.md`
