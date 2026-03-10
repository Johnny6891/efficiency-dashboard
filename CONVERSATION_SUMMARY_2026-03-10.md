# 對話摘要紀錄 - 2026-03-10

## 範圍
- 主題：將原本執行時間過長的 GAS 同步流程改為 GitHub Actions，並持續排除 `Sync Efficiency Stats` workflow 失敗問題。
- 專案：`efficiency-dashboard`
- 檢查分支：`main`

## 已完成修正
1. workflow 環境變數策略調整：
- 只保留必要敏感值在 `secrets.*`。
- 其餘非敏感固定值改放 workflow 內，避免手動維護過多 secrets。

2. `package.json` 找不到問題修正：
- 根因是 `.gitignore` 的 `sync-efficiency/*.json` 連 `package.json`、`package-lock.json` 一起忽略。
- 已修正為必要檔案可提交。

3. 憑證變數與欄位編碼修正：
- workflow 內 `FIREBASE_CREDENTIALS` 改共用 `GOOGLE_CREDENTIALS`。
- 中文欄位改用直接繁中字，避免 Unicode escape 導致欄位比對失敗。

4. 參照表欄位名稱修正：
- `REF_STATUS_HEADER` 改為 `狀態(1表示顯示0不顯示)`。
- `REF_NAME_HEADER` 改為 `人員名稱`。

## 本次確認到的現況
- `main` 與 `origin/main` 已同步。
- 最新遠端 commit 為 `ec79aef`（`Update sync-efficiency.yml`）。
- workflow 目前設定已包含預期值：
- `FIREBASE_CREDENTIALS: ${{ secrets.GOOGLE_CREDENTIALS }}`
- `REF_SHEET_NAME: 勿修改/全部同事DATA`
- `REF_GROUP_HEADER: 組別`
- `REF_STATUS_HEADER: 狀態(1表示顯示0不顯示)`
- `REF_NAME_HEADER: 人員名稱`

## 最新失敗根因（已由 logs 驗證）
- 讀取資料夾：`logs_59964310138`
- 失敗步驟：`Run sync`
- 關鍵錯誤：
- `PERMISSION_DENIED: Cloud Firestore API has not been used in project bionic-union-456401-c6 before or it is disabled`
- 錯誤 metadata 顯示：
- `reason: SERVICE_DISABLED`
- `service: firestore.googleapis.com`

## 結論
- 目前已非 workflow 寫法、欄位名稱或 JSON 格式問題。
- 真正阻塞點是 GCP 專案端未啟用（或未完成啟用）Cloud Firestore API。

## 後續動作
1. 啟用 Firestore API（專案 `bionic-union-456401-c6`）：
- https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=bionic-union-456401-c6

2. 等待 3-10 分鐘 propagation 後，重新執行 workflow。

3. 若仍失敗，檢查 `GOOGLE_CREDENTIALS` 對應服務帳號 IAM 權限是否具備 Firestore 讀寫權限。

## 備註
- 本機有未追蹤檔（憑證與 logs），本次未納入提交。

---

## 追加紀錄（同日後續）

### 使用者提問與確認
- 使用者確認 `rerun Actions` 是否等於 GitHub Actions 的 `Re-run jobs`。
- 回覆確認：是，若不改 workflow，直接用 `Re-run jobs`；若 workflow 有變更，則用 `Run workflow` 觸發新 run。

### 新線索與判斷
- 使用者提供最新失敗畫面後，錯誤型態由 `PERMISSION_DENIED / SERVICE_DISABLED` 進展為 `Error: 5 NOT_FOUND`。
- 這代表 API 啟用問題可能已改善，但目前很可能是「Firestore 目標專案/資料庫不一致」或「憑證打到錯誤專案」。

### 憑證對應原則（重要）
- `GOOGLE_CREDENTIALS`：用於讀取 Google Sheets（來源）。
- `FIREBASE_CREDENTIALS`：用於寫入 Firestore（目標）。
- 若目標是 `work-report-system` 的 Firestore，`FIREBASE_CREDENTIALS` 必須使用 `work-report-system` 專案的 service account JSON。

### 已實作調整
1. 新增安全除錯步驟 `Debug credential projects`（僅輸出 `project_id` 與 `client_email`，不輸出 private key）。
- commit: `d1c016b`

2. workflow 改為分離憑證，不再共用同一 secret：
- `FIREBASE_CREDENTIALS: ${{ secrets.FIREBASE_CREDENTIALS }}`
- commit: `cdb0262`

### 本次給使用者的操作指引
1. 到 GitHub Secrets 新增/更新 `FIREBASE_CREDENTIALS`（貼入目標 Firestore 專案 `work-report-system` 的完整 JSON，且不要外層引號）。
2. 保留 `GOOGLE_CREDENTIALS` 供 Sheets 讀取。
3. 重新 `Re-run jobs`，先看 `Debug credential projects` 兩行輸出是否專案分離正確。
4. 若仍失敗，再依 `Run sync` 前段錯誤持續收斂。

---

## 追加紀錄（同日第三段 — 最終修正）

### 問題確認

- 使用者已更新 `FIREBASE_CREDENTIALS` secret，但用 `Re-run jobs` 重跑後 `Debug credential projects` 輸出仍然顯示兩個 `project_id` 都是 `bionic-union-456401-c6`。
- 確認 Firestore 資料庫在 `work-report-system` 專案已存在（`(default)` database，含 `efficiency_stats`、`orders` collections）。

### 根因

1. **貼錯 JSON**：使用者原本把 `bionic-union-456401-c6` 的 JSON 貼到 `FIREBASE_CREDENTIALS`，而非 `work-report-system-26c12` 的 JSON。
2. **Re-run jobs 不刷新 secrets**：GitHub Actions 的 `Re-run jobs` 會沿用原始 run 建立時的 secrets 快照，不會讀取更新後的值。

### 修正動作

1. 將 `work-report-system-26c12-firebase-adminsdk-fbsvc-add29d0514.json` 的完整內容貼入 GitHub Secrets → `FIREBASE_CREDENTIALS`。
2. 使用 `Run workflow`（手動觸發新 run）而非 `Re-run jobs`。

### 修正後驗證結果

- `Debug credential projects` 輸出正確分離：
  - `GOOGLE_CREDENTIALS project_id=bionic-union-456401-c6`（讀 Sheets）
  - `FIREBASE_CREDENTIALS project_id=work-report-system-26c12`（寫 Firestore）
- `Run sync` 步驟成功通過。

### 學到的重要知識

> **GitHub Actions `Re-run jobs` vs `Run workflow`**：
> - `Re-run jobs`：重播同一個 run，secrets 沿用建立時的快照，不會更新。
> - `Run workflow`：建立全新 run，會讀取最新的 secrets 值。
> - 因此，更新 secrets 後必須用 `Run workflow` 才能生效。

### 目前狀態

- ✅ Workflow `Sync Efficiency Stats` 已成功執行
- ✅ Firestore 資料應已同步寫入 `work-report-system` 的 `efficiency_stats` collection
- ✅ 前端 UI 調整已完成（見下方追加紀錄）

---

## 追加紀錄（同日第四段 — 前端修正與 Skill 建立）

### 前端數據顯示問題修正

**問題現象**：詳細數據表格的「總筆數」、「未達成筆數」、「達成率」全部顯示 0 或 `-`

**根因**：
- `sync-efficiency/index.js` 的 `readSheet()` 未指定 `valueRenderOption`
- Google Sheets API 預設回傳**格式化字串**，BF 欄（效率值）回傳 `"182%"` 字串
- `Number("182%")` → `NaN` → `bfIsValid = false` → `count` 永遠不 +1 → `efficiency = null`

**修正**（commit `23ae0e2`）：  
`readSheet()` 加入 `valueRenderOption: 'UNFORMATTED_VALUE'` 及 `dateTimeRenderOption: 'SERIAL_NUMBER'`，讓 API 回傳原始數值（`1.82` 而非 `"182%"`）。日期欄改回傳序列號，`parseSheetDate()` 已有處理邏輯，完全相容。

### 前端 UI 調整（commit `34072be`）

| 項目 | 變更 |
|------|------|
| 年月篩選「全部」選項 | 移除 |
| 「重置」按鈕 | 移除（HTML + JS listener 同步清除） |
| 趨勢圖標題 | 「月度效率趨勢」→「年度效率趨勢」 |
| 趨勢圖邏輯 | 依所選年月的**年份**，從 `rawData` 取該年所有月份，計算各月加權平均效率，x 軸顯示「1月」「2月」...，不受人員篩選影響 |

### 建立 Auto-Commit Skill

- 路徑：`c:\Users\user\vibe coding\.agents\skills\auto-commit\SKILL.md`
- 功能：往後 AI 每次改完程式碼，自動執行 `git add -A; git commit -m "..."; git push`，commit message 用 `fix/feat/chore/refactor:` 前綴 + 英文描述

### 待辦

- 🔲 執行 `firebase deploy --only hosting` 將前端部署上線
- 🔲 重新跑 `Run workflow`（GitHub Actions）讓修正後的 sync 重新寫入正確數據
- 🔲 確認前端數據顯示正常
