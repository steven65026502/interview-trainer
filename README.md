# Rong AI 應用與資料整合求職工作台

這個 repository 是 Rong 的學習、驗收與模擬面試工作台。職涯主線聚焦在「AI 應用與資料整合工程師」：以 Python、SQL、API 與資料管線為工程底座，再加入 LLM、RAG、結構化輸出、工具呼叫、品質評估與錯誤處理能力。

> 目前這個 repository 已實作的是學習表、模擬面試、進度紀錄與同步機制。下方的「企業 IT／設備維運知識與工單 Copilot」是八週內要完成的唯一主作品規劃，不是本 repository 已完成的產品功能。

## 職涯定位

五類投遞方向，依目前定位排序：

1. **主線**：AI 應用工程師、AI Workflow、RAG 知識庫、LLM Evaluation 與 AI QA。
2. **平行投遞**：資料工程師、Python 應用工程師、後端整合與自動化工程師；優先選會用到 SQL、API、pytest 與資料品質的職缺。
3. **半導體方向**：IT 系統、製造資料整合、設備資料自動化、AI 導入與智慧製造軟體。
4. **條件式選擇**：AIoT Solution／技術服務；只有工作確實包含部署、API、Linux 與程式除錯時才列入。
5. **備用方向**：GIS 全端開發；必須是真正撰寫 API、資料庫與前端功能的職位。

暫不優先：

- 純模型訓練、研究型 ML／演算法、競賽程式或 LeetCode Hard 導向職缺。
- 明確要求多年大型分散式系統、資深 MLOps、Kubernetes 平台治理的職缺。
- 工作核心是報表、純人工資料標註、純前端切版，或無程式開發責任的職缺。
- 只使用低程式碼平台、無法接觸 Python／SQL／API／測試與資料流的「AI」職缺。
- GIS 專案助理、行政支援或「先做行政再看表現」的模糊轉開發安排。

### 詮華的面談條件

只有在對方願意直接以「GIS 全端／初階開發職務」評估時，才值得進入面談；若職務仍是 GIS 專案助理，或要求先做行政工作再視表現轉開發，就不建議作為目前求職主線。

## 核心技能優先序與面試標準

1. **Python**：能從 API／檔案取得資料，完成清理、驗證、資料庫寫入、例外處理與 logging，並能閱讀、除錯及修改既有程式。
2. **SQL**：能獨立寫 JOIN、GROUP BY、CTE 與 Window Function，正確處理 NULL、去重、交易、索引與 `EXPLAIN ANALYZE`。
3. **REST API**：理解 HTTP、JSON 與狀態碼，能以 FastAPI／Pydantic 實作驗證、查詢、分頁與一致的錯誤格式。
4. **Git／Linux**：能操作 branch、commit、merge，並從 process、port、環境變數與 service log 排查問題。
5. **Docker**：能寫 Dockerfile／Compose，讓 API 與 PostgreSQL 在乾淨環境以一個指令啟動。
6. **資料工程**：能設計可重跑的 ETL／ingestion，處理 data contract、品質驗證、冪等、排程、retry、版本與對帳。
7. **RAG**：能說清楚 chunk、metadata、embedding、pgvector、retrieve、rerank、citation 與 refusal，並以來源驗證回答。
8. **AI 評測**：能用固定測試集量測 retrieval、citation、task success、latency 與 failures，而不是只看成功 demo。
9. **Agent 可靠性**：能處理 tool calling、JSON Schema、timeout、retry、權限、稽核與 HITL；本作品只使用 **LangGraph**，Dify／n8n／多 Agent 暫不並行。

`pytest`、單元／整合／API／回歸測試貫穿九項能力。演算法則維持面試基礎：Array、String、Hash Map、Stack、Queue、Binary Search、Two Pointers、Sliding Window、Tree、BFS、DFS 與基礎 Heap；只練常見模式、Big-O、邊界與測試，不投入 LeetCode Hard。

## 唯一主作品：企業 IT／設備維運知識與工單 Copilot

狀態：**規劃中，尚未在本 repository 實作。**

八週內的程式、SQL、API、測試、Docker、RAG 與面試故事都應累積到同一個作品，不再另外製作互不相干的小型聊天機器人、Todo API 或純教學範例。

預計解決的問題：企業 IT 人員面對設備手冊、SOP、FAQ 與歷史工單時，需要快速找到可靠處理步驟，並把對話整理成可追蹤的工單草稿。Copilot 應協助檢索與整理，不應在缺乏證據時自行編造答案，也不應預設擁有修改設備或正式送出工單的權限。

預計最小範圍：

- 匯入設備手冊、維運 SOP、FAQ 與去識別化工單樣本，保存來源、文件版本及處理狀態。
- 提供 FastAPI 查詢介面，可查設備資料、設備狀態、工單狀態與知識文件，並回傳結構化答案、引用來源與「證據不足」狀態。
- 依問題內容產生工單草稿，例如設備類別、問題摘要、影響、已嘗試步驟與建議優先級。
- PostgreSQL 保存文件、設備、工單與稽核欄位；以 **pgvector** 保存 embedding 並完成 ingestion、相似度檢索與索引驗證。
- Agent 流程只以 LangGraph 實作；Dify／n8n 留到主作品完成後再評估，不作為八週交付相依項目。
- 工具呼叫先採 allowlist 與唯讀操作；任何工單或外部系統寫入都必須先顯示結構化草稿，經人員明確確認後才執行，並留下 HITL 稽核紀錄。
- 使用 50 題版本固定的測試集，涵蓋可回答、無答案、錯誤來源、惡意提示、timeout 與格式解析失敗。
- 以 pytest、API／整合測試、Docker Compose、CI、架構圖與限制說明形成可重現證據。

完成標準不是「畫面能聊天」，而是面試時能展示一條可驗證資料流：

```text
文件／工單 → 清理與版本紀錄 → chunk／embedding → retrieval
→ LLM 結構化回答與引用 → 工單草稿 → 評估、log 與人工確認
```

作品驗收至少包含：

1. 固定版本的 50 題測試集，可重跑且保留每題預期來源與預期行為。
2. 五項主要品質指標：retrieval 命中率、引用正確率、任務完成率、回應延遲（至少記錄 p50／p95）與失敗案例通過率；另保留答案正確率與拒答正確率作為診斷指標。
3. 所有寫入操作皆經 HITL 明確確認，且可從 log 追查提出、確認與執行結果。
4. Docker／Docker Compose 可重現啟動，README 說明環境、指令、測試、限制與失敗處理。
5. 一張與實作一致的架構圖，以及一段三分鐘 demo，完整展示提問、引用、工單草稿、人工確認與評估結果。

## 八週執行節奏

| 週次 | 核心能力 | 累積到唯一作品的成果 | 驗收重點 |
|---|---|---|---|
| W1 | Python 與資料處理 | 文件／工單樣本清理器、型別提示、例外處理與 logging | 不用 AI 重做清理流程，並以 pytest 驗證正常與錯誤資料 |
| W2 | SQL 與 PostgreSQL | 文件、來源、設備、工單與 ingestion run schema；可重跑匯入與對帳 | 限時寫 JOIN、window function、transaction／upsert，並補資料庫測試 |
| W3 | FastAPI、Postman 與 DB | health、設備查詢、設備／工單狀態及工單草稿 API；Postman collection 串起成功與錯誤流程 | 獨立增加含 schema、狀態碼、分頁、DB transaction 與 pytest／API 測試的 endpoint |
| W4 | Git、Linux 與 Docker | branch／PR 流程、log 排查、API＋PostgreSQL Docker Compose 與 CI | 在乾淨環境依 README 啟動，並讓各週累積的 pytest 全部通過 |
| W5 | RAG、pgvector ingest／retrieval | 文件切分、embedding、pgvector 寫入、版本紀錄、相似度檢索與索引驗證 | 用固定查詢檢查 retrieval 命中，不把生成答案當成檢索正確的證明 |
| W6 | RAG 引用、拒答、rerank 與 eval baseline | 回答附來源、證據不足時拒答、比較 rerank 前後結果，建立可重跑 baseline | 保存 retrieval、引用、答案／拒答、延遲與失敗類型，之後的改動都與 baseline 比較 |
| W7 | LangGraph Agent 與 HITL | tool calling、JSON Schema、timeout、retry、權限 allowlist、工單草稿與人工寫入確認 | 模擬壞參數、工具 500／timeout、越權與重複提交；pytest 驗證未確認就不能寫入 |
| W8 | 評測、作品交付與面試 | 跑完 50 題固定評測，整理 Docker、README、架構圖、三分鐘 demo 與面試故事 | 報告五項主指標及失敗案例，完成角色模擬、錯題重做與投遞復盤 |

pytest 不獨占單一週：W1 起每一週都要為當週新增功能補正常、邊界與失敗案例；W4 負責把既有測試接進 Docker／CI，W7 驗證 Agent 權限與 HITL，W8 再以完整 suite 與 50 題評測交付。

建議每天約 90 分鐘：主題實作 40 分鐘、No-AI 基礎演算法 20 分鐘、唯一作品整合 20 分鐘、面試輸出／紀錄 10 分鐘。學習與投遞同步進行，不必等八週全部完成才開始投履歷。

## AI 使用五原則

1. **能用自己的話說明**：AI 產生的程式、SQL、Docker、prompt 與設計都必須逐段看懂。
2. **能在沒有 AI 時修改需求**：基礎 Python、SQL、API、除錯與演算法保留 No-AI 練習與每週驗收。
3. **能找出錯誤並讀懂 log**：從 traceback、SQL plan、API response、container／CI log 與 trace 縮小問題。
4. **能為它補一個測試**：使用 pytest、Postman、固定評估集與 SQL 對帳驗證正常、邊界及失敗案例。
5. **能解釋設計理由並承擔結果**：說明選擇、限制與取捨，最後由自己負責修正、測試及面試說法。

另須遵守資料界線：不輸入公司機密、個資、token 或未去識別化工單，並記錄重要假設與 AI 協助範圍。

## 投遞與面試策略

- 每週優先投遞 3–5 個符合上述五類方向、且實際工作包含 Python／SQL／API／RAG／測試證據之一的職缺。
- JD 若同時出現 Python、API、SQL、ETL／資料處理、RAG、LLM API、pytest 或 Docker，應優先評估。
- 面試證據集中在同一作品：問題背景、資料流、schema、API 契約、RAG 取捨、測試、錯誤處理、評估結果與限制。
- 面試後把真題、卡點與最低分項回填到工作台；下一週只補最影響錄取的缺口。
- 遇到公司名稱或職稱看似相關，但 JD 仍以行政、助理、資料標註或低程式碼操作為主時，依實際工作內容而不是名稱判斷。

## 工作台入口

- GitHub Pages：<https://steven65026502.github.io/interview-trainer/>
- 8 週學習表：<https://steven65026502.github.io/interview-trainer/roadmap.html>
- 模擬面試主頁：`index.html`
- 學習工作台：`roadmap.html`

## 目前已實作功能

- 搭配 8 週主表的 28 天 AI 應用與資料整合 Course；每課依序完成一個主教材（影片或本站短文）、兩題理解題、Copilot 應用題與面試實戰，通過後才解鎖下一天。
- 理解題使用固定題目、標準答案與逐題解析；開放式應用題與面試題沒有唯一文字答案，改以技術要點、驗證、風險與取捨 rubric 提供練習回饋。
- 共通題庫加 Python 後端、資料工程、SDET 與 AI 應用四類角色題；切換角色時只計入該角色的題目與進度。
- 模擬面試支援作答、追問、自評檢核與啟發式回饋。回饋不會執行程式或 SQL，技術能力仍以 No-AI 實作與測試為準。
- 進度、分數與解鎖是個人自學紀錄，可由本人匯入或修改，沒有伺服器簽章；不能當成證書、招募驗證或防竄改的能力證明。
- 8 週 Python、SQL、FastAPI、pytest、Docker、LeetCode、RAG 與面試衝刺表。
- 每週實作任務、能力閘門、主線成果證據、No-AI 驗收、筆記、日期排程與「下一個任務」提示。
- 演算法逐題記錄難度、首次耗時、No-AI、AC、程式連結與錯題重做日期，自動統計 35 Easy／11 Medium；W8 另重做 6 題錯題。
- W2 保存 Python／SQL 基準，W4／W6／W8 分別保存五項 100 分驗收；日期、評分者、證據與分數依角色分開保存。
- 學習表目前保留 80% 共通核心＋20% 角色成果的切換機制。
- 19 個於 2026-08-16 至 2026-08-17 核實過的 YouTube／Bilibili 資源，支援主／備用標記、篩選與觀看實作進度。
- 學習表可匯出／匯入 JSON 備份；匯入資料會驗證版本、欄位與大小，匯入或重設前可復原。
- 本機使用 `localStorage` 自動保存。只有 `index.html` 的 28 天練習、答案與面試進度支援 GitHub Gist、GitHub OAuth 或 Email 雲端同步；`roadmap.html` 的 8 週任務仍只支援本機保存與 JSON 匯出／匯入，不會自動跨裝置同步。

## 資料與瀏覽器安全

- 學習表只接受已知版本與欄位；筆記、分數與匯入碼不會直接當成 HTML 執行。
- GitHub Gist token 與 OAuth／Email session 不寫入持久的 `localStorage`，只保留在目前分頁的 `sessionStorage`；關閉分頁後需重新登入或輸入 token。
- 同步 URL 接受 HTTPS origin（本機開發可用 localhost HTTP）。這不是官方服務 allowlist；只應填入自己信任的 Worker，變更 Worker 前應先登出並清除同步設定。
- Email 進度使用每位使用者的 Durable Object 與 revision／存在狀態檢查。GitHub OAuth 請求也會依使用者序列化並在寫入前檢查 revision，但 GitHub Gist API 不提供可靠的全域原子 CAS；外部手動修改或 direct-token 寫入仍可能產生競爭。
- 遇到 HTTP 409 時會停止上傳、不自動重試，並把本機與遠端副本放到目前分頁的衝突匯出區。關閉分頁前應立即下載或另行保存，這不是永久衝突歷史。
- 手動 GitHub personal-token 模式會記住最後下載的 Gist revision 與 history version；基準改變時會在 PATCH 前停止。讀取與寫入之間仍有競爭視窗，多裝置同步應避免混用 direct-token 與 Worker 模式。
- 「清空練習」、「重設學習表」與「清除同步設定」都有確認；前兩者提供一次本機復原。
- 每次推送到 `main` 或建立／更新 pull request 時，會自動驗證 HTML、inline JavaScript、Worker 測試與 Wrangler dry-run。

## 雲端同步 Worker

前端 UI 位於 `index.html` 的「進度同步」區塊。Email 驗證、寄信、session 加密、GitHub OAuth 與該頁的雲端進度協調由 `oauth-worker/` 內的 Cloudflare Worker 負責；`roadmap.html` 不會送進 Worker。GitHub Pages 部署也不會自動部署 Worker。

Course 進度使用 envelope v5。自架同步服務升級時必須先部署支援 v5 的 Worker，再發布 v5 前端；使用者一旦寫入 v5，Worker 會拒絕舊版 v1–v4 客戶端降版覆寫。若 Worker 尚未升級，前端本機進度仍會保留，但雲端上傳會失敗。

正式部署前需要設定：

- Durable Object binding：`AUTH_COORDINATOR`
- 選用的舊版 Email KV migration binding：`PROGRESS_KV`
- Worker secret：`SESSION_SECRET`（至少 32 bytes）
- Worker secret：`RESEND_API_KEY`
- Worker secret：`GITHUB_CLIENT_SECRET`
- Worker var：`GITHUB_CLIENT_ID`
- Worker var：`EMAIL_FROM`（正式環境使用已驗證網域）
- Worker var：`APP_ORIGIN`

目前 `oauth-worker/wrangler.toml` 仍含範例 Client ID 與 Resend 測試寄件者，不能直接視為正式環境設定。完整部署與 OAuth callback 設定見 `oauth-worker/README.md`。

## 本機驗證

靜態頁面可在 repository 根目錄啟動：

```powershell
python -m http.server 8000
```

Worker 測試：

```powershell
npm test --prefix oauth-worker
```

Wrangler bundle dry-run：

```powershell
npx --yes wrangler@4.123.0 deploy --dry-run --config oauth-worker/wrangler.toml
```
