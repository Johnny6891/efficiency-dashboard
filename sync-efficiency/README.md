# sync-efficiency（Cloud Run）

此服務用於取代長時間執行的 GAS，同步 Google Sheets 統計資料到 Firestore。

## API 端點

- `GET /healthz`
- `POST /sync-efficiency`

若有設定 `SYNC_TOKEN`，呼叫 `POST /sync-efficiency` 時需帶入：

`Authorization: Bearer <SYNC_TOKEN>`

## 1）安裝套件

```powershell
cd "C:\Users\user\vibe coding\efficiency-dashboard\sync-efficiency"
npm install
```

## 2）設定環境變數

請將 `.env.example` 的內容設定到 Cloud Run 環境變數。

必要環境變數：

- `GOOGLE_CREDENTIALS`（JSON 字串）
- `FIREBASE_CREDENTIALS`（JSON 字串）
- `REF_SHEET_ID`
- `DATA_SHEETS_JSON`（JSON 陣列）

## 3）本機基本測試

```powershell
npm run check
npm start
# 另一個終端可測試：
# curl http://localhost:8080/healthz
```

## 4）部署到 Cloud Run

```powershell
gcloud run deploy sync-efficiency `
  --source . `
  --region asia-east1 `
  --allow-unauthenticated `
  --timeout 3600 `
  --memory 1Gi `
  --cpu 1
```

補充：
- `--timeout 3600` 代表單次請求最長 60 分鐘。
- 若不希望公開存取，請移除 `--allow-unauthenticated`，改用 IAM / 服務帳號授權呼叫。

## 5）建立 Cloud Scheduler（每日排程）

```powershell
gcloud scheduler jobs create http sync-efficiency-daily `
  --schedule "0 1 * * *" `
  --time-zone "Asia/Taipei" `
  --uri "https://<YOUR_CLOUD_RUN_URL>/sync-efficiency" `
  --http-method POST `
  --headers "Authorization=Bearer <SYNC_TOKEN>" `
  --location asia-east1
```

## 6）Firestore 預期輸出

集合：`efficiency_stats`

- `person_yearMonth` 文件（例如：`王小明_2026-3`）
- `_metadata` 文件，包含：
  - `lastSyncTime`
  - `recordCount`
  - `validPersonsCount`
  - `coveredMonths`
  - `sourceRows`
  - `deletedCount`
  - `durationMs`

## 常見問題排查

- `Cannot find column "..."`：請改用欄位索引環境變數 `REF_GROUP_COL`、`REF_STATUS_COL`、`REF_NAME_COL`。
- `Unauthorized`：Bearer Token 未帶入或不正確。
- 500 且顯示 JSON parse error：憑證環境變數不是合法 JSON 字串。
