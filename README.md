# efficiency-dashboard

此專案包含兩個主要部分：

- 前端儀表板（`public/`）：顯示效率統計資料
- 同步服務（`sync-efficiency/`）：將 Google Sheets 資料彙整後寫入 Firestore

---

## 專案結構

- `public/`：Firebase Hosting 靜態網站（`index.html`、`app.js`、`style.css`）
- `sync-efficiency/`：Node.js 同步程式（Google Sheets -> Firestore）
- `.github/workflows/sync-efficiency.yml`：同步排程與執行流程
- `firestore.rules`：Firestore 存取規則
- `scripts/run-sync-workflow.ps1`：手動觸發並追蹤 GitHub Actions 同步流程

---

## Google Sheets 複製到 Firestore：什麼時候？

同步由 GitHub Actions `Sync Efficiency Stats` workflow 執行：

- 自動排程：每天台北時間 `07:00`，只同步今年資料（`SYNC_SCOPE=current_year`）
- 手動觸發：可從 GitHub Actions `workflow_dispatch` 手動跑一次，並選擇同步範圍（今年或全部年份）

排程設定：

- cron：`0 23 * * *`（UTC 23:00 = Asia/Taipei 07:00）

- 排程事件（`schedule`）會自動帶入：`SYNC_SCOPE=current_year`
- 手動事件（`workflow_dispatch`）可選：`all_years` 或 `current_year`

---

## Google Sheets 複製到 Firestore：複製哪些資料？

### 1. 人員篩選來源（參考表）

先讀取參考表（`REF_SHEET_ID` / `REF_SHEET_NAME`），只保留符合條件的人員：

- `組別` = `2`（`INCLUDE_GROUP=2`）
- `狀態` = `1`（`INCLUDE_STATUS=1`）

只有這些人員，才會進入後續統計。

### 1.5 同步範圍規則

- `SYNC_SCOPE=current_year`：只處理 `SYNC_YEAR`（預設為台北時區今年）
- `SYNC_SCOPE=all_years`：處理 `DATA_SHEETS_JSON` 內所有年份資料

### 2. 主資料來源（多個資料表）

由 `DATA_SHEETS_JSON` 指定多個 Google Sheet（可跨年份），每個項目格式：

```json
{"id":"SHEET_ID","name":"Data Sheet(Calculation)"}
```

### 3. 讀取欄位（0-based index）

- `COL_COLLEAGUE=43`：同事欄（可逗號分隔多人）
- `COL_DATE=50`：日期欄
- `COL_PRODUCTION_HOURS=53`：生產工時欄
- `COL_BF=57`：BF 欄

### 4. 寫入前彙總邏輯

資料不是逐列原封不動寫入，而是彙總成「每人、每月」：

- key：`person + "_" + yearMonth`
- 指標：
  - `count`：有 BF 值的筆數
  - `lt09`：BF < 0.9
  - `btw0912`：0.9 <= BF <= 1.2
  - `gt12`：BF > 1.2
  - `productionHours`：工時加總
  - `efficiency`：`(count - lt09) / count`（四捨五入至小數第 2 位）

### 5. Firestore 輸出

寫入集合：`efficiency_stats`

- 統計文件：`{person}_{yearMonth}`（文件 ID 會把 `/` 轉成 `-`）
- 中繼資料文件：`_metadata`
  - `lastSyncTime`
  - `recordCount`
  - `validPersonsCount`
  - `coveredMonths`
  - `sourceRows`
  - `deletedCount`
  - `durationMs`

另外，同步時會先刪除本次涵蓋月份的舊資料，再寫入新統計資料，避免月份重複。

---

## 前端自動更新機制

前端儀表板會每 **1 小時**自動輪詢一次 Firestore `_metadata` 文件（僅 1 read），
比對 `lastSyncTime` 是否有變動：

- **沒有變動**：不做任何事
- **有變動**：重新載入全量資料並更新畫面

因此同步完成後，網頁最多 1 小時內會自動反映最新資料，**不需要手動重新整理**。

---

## 執行與維運

### 手動觸發同步（本機）

```powershell
.\run-sync-workflow.cmd
```

或直接：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-sync-workflow.ps1
```

### 同步服務設定重點

必要 Secrets / 環境變數：

- `GOOGLE_CREDENTIALS`
- `FIREBASE_CREDENTIALS`
- `REF_SHEET_ID`
- `DATA_SHEETS_JSON`

詳細設定可參考：

- `sync-efficiency/README.md`
- `sync-efficiency/.env.example`

---

## 安全注意

- 請勿將服務帳號金鑰（JSON/PEM/P12）提交到 Git
- 憑證請改由 GitHub Secrets 或 Secret Manager 注入
- 若同步失敗且訊息包含 `PERMISSION_DENIED` / `SERVICE_DISABLED`，請先確認：
  - Firestore API 已啟用
  - 服務帳號具有 Firestore 寫入權限

