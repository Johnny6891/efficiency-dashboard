# 對話摘要 — 2026/03/10 下午

> 時間：2026/03/10 16:33 ~ 16:59

---

## 目標

對 efficiency-dashboard 專案進行全面優化分析，並執行選定的優化項目。

## 優化分析

完整掃描所有專案檔案後產出 v2 優化報告（14 項），按 P0~P3 分級：

| 優先級 | 項目數 | 範疇 |
|--------|--------|------|
| 🔴 P0 | 2 | 安全性（Firestore rules、GAS 硬編碼 ID） |
| 🟡 P1 | 4 | 效能（全量 Firestore 查詢、Chart destroy、npm cache、deleteCoveredMonths） |
| 🟢 P2 | 7 | 可維護性（重複邏輯、零測試、error retry、殘留 CSS、filterMonth、env.yaml、compat SDK） |
| 🔵 P3 | 3 | 功能增強（CSV 匯出、Dark Mode、PWA） |

前次 P0 #3（Service Account 金鑰暴露）已確認修復。

## 執行項目

使用者選擇執行 6 項（#1, #2, #8, #10, #11, #12）：

### #1 App Check 防爬蟲
- `index.html`：加入 `firebase-app-check-compat.js`
- `app.js`：加入 `RECAPTCHA_SITE_KEY` 常數 + `firebase.appCheck().activate()`
- ⚠️ 需到 Firebase Console 註冊取得 site key 後替換 `YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY`

### #2 GAS Spreadsheet ID 硬編碼
- 隨 #8 移除 GAS 自動解決

### #8 刪除 GAS 資料夾
- `gas/syncEfficiency.gs` 已刪除（之前從 GAS 遷移到 GitHub Actions，GAS 已 deprecated）

### #10 Error Retry
- 新增 `fetchDataWithRetry(db, maxRetries = 3)` — 指數退避（500ms → 1s → 2s）
- `init()` 中 Firestore 連線失敗時自動重試 3 次

### #11 刪除 `.btn-reset` CSS
- `style.css` 移除 20 行未使用的 `.btn-reset` / `.btn-reset:hover` 樣式

### #12 filterMonth 初始值修復
- `populateFilters()` 資料為空時顯示 `<option disabled>無資料</option>` placeholder
- 清空 select 再重建，避免 `state.filterMonth = 'all'` 與 UI 不一致

## Git

- Commit: `refactor: App Check, error retry, remove GAS, cleanup CSS/filterMonth`
- 已 push 至 GitHub `main` 分支

## 待處理

- 替換 `RECAPTCHA_SITE_KEY` 後重新部署
- 其他未執行項目（Chart update、npm cache、測試、CSV 匯出等）視需求後續處理
