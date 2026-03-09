# 工時效率統計系統 — 開發紀錄

> 建立日期：2026/03/06

---

## 專案概述

將原本的 Google Apps Script (GAS) 工時統計系統遷移至 **Firestore + Firebase Hosting 前端儀表板**。

### 原始系統
- **資料來源**：Google Sheet `Data Sheet(Calculation)` — 約 20,000 筆工報記錄
- **人員篩選**：Google Sheet `勿修改/全部同事DATA`（組別=2, 狀態=1）
- **統計邏輯**：GAS 函數 `countMultipleColleaguesWorkingHours()` — 按「同事 × 年月」分組統計 BF 值分佈與生產工時
- **輸出**：Google Sheet `Efficiency(New)`

### 新系統架構

```
Google Sheet (Data Sheet) → GAS dailySync() → Firestore [orders]
Google Sheet (同事DATA) → GAS syncEfficiencyToFirestore() → Firestore [efficiency_stats]
                          ↑ 直接讀取 Sheet 做統計計算          ↓
                                                      前端儀表板 (Firebase Hosting)
```

---

## 技術決策

| 項目 | 決策 | 理由 |
|------|------|------|
| 資料來源 | Firestore (`orders` 集合已有同步) | 使用者已有 GAS → Firestore 同步機制 |
| 人員名單 | 維持 Google Sheet | 使用者要求，GAS 直接讀取 |
| 前端部署 | Firebase Hosting | 與 Firestore 天然整合 |
| 資料即時性 | 定期排程（每日） | 使用者需求 |
| 認證 | 無（內部信任網路） | Firestore 規則設定公開讀取 |
| 效率計算 | GAS 預先計算寫入 Firestore | 避免前端查詢 20K+ 文件，降低成本 |
| 前端框架 | 純 HTML + CSS + JS | 符合使用者既有專案模式 |
| 設計風格 | Liquid Glass + 莫蘭迪配色 | 使用者要求 |

---

## 檔案清單

```
efficiency-dashboard/
├── gas/
│   └── syncEfficiency.gs    # GAS 效率計算 + 寫入 Firestore
├── public/
│   ├── index.html           # 前端主頁面
│   ├── style.css            # Liquid Glass + 莫蘭迪配色 CSS
│   └── app.js               # 應用邏輯 (Firestore + Chart.js)
├── firebase.json            # Firebase Hosting 設定
├── .firebaserc              # Firebase 專案連結
└── firestore.rules          # Firestore 安全規則
```

---

## Firebase 設定

- **專案 ID**：`work-report-system-26c12`
- **Hosting URL**：https://work-report-system-26c12.web.app
- **登入帳號**：`johnny@dgstand.com`
- **Firestore 集合**：
  - `orders` — 原始工報資料（GAS dailySync 寫入）
  - `efficiency_stats` — 預計算統計結果（GAS syncEfficiencyToFirestore 寫入）

---

## Firestore 資料結構

### `efficiency_stats` 集合（每個文件）

```json
{
  "yearMonth": "2026/3",
  "person": "亞美 Yamei",
  "count": 11,
  "lt09": 1,
  "btw0912": 7,
  "gt12": 3,
  "efficiency": 0.91,
  "productionHours": 1697.0
}
```

### `efficiency_stats/_metadata`

```json
{
  "lastSyncTime": "2026-03-06T06:39:15.000Z",
  "recordCount": 30,
  "validPersonsCount": 10
}
```

---

## 前端功能

- ✅ Summary Cards（有效人員 / 統計筆數 / 平均效率 / 總工時）
- ✅ 篩選器（年月、人員下拉 + 搜尋 + 重置）
- ✅ 資料表格（8 欄，可排序）
- ✅ 效率進度條（≥90% 綠 / ≥70% 黃 / <70% 紅）
- ✅ BF 值色標（<0.9 紅 / 0.9~1.2 綠 / >1.2 藍）
- ✅ 月度效率趨勢折線圖
- ✅ 人員效率比較直條圖（含 90% 達成目標線 + 數據標籤）
- ✅ RWD（手機 / 平板 / 桌面）

---

## 部署指令

```powershell
cd "C:\Users\user\vibe coding\efficiency-dashboard"
firebase deploy --only hosting
```

> PowerShell 注意：多目標用引號 `firebase deploy --only "hosting,firestore:rules"`

---

## GAS 整合

在現有 GAS 專案（有 `dailySync()` 的）中：
1. 新增 `syncEfficiency.gs` 內容
2. 在 `dailySync()` 最後加：`syncEfficiencyToFirestore();`
3. 效率計算公式：`efficiency = (count - lt09) / count`（與原 Sheet 公式一致）

---

## 設計迭代

1. **初版**：深色主題（深海藍 + 青綠 accent）+ 橫向長條圖
2. **改版**：Liquid Glass 風格 + 溫暖莫蘭迪配色 + 直條圖（含 90% 達成目標線）

---

## 變更紀錄

### 2026/03/06 下午

#### 詳細數據表格欄位調整（`index.html` + `app.js`）
- `計數` → `總筆數`
- `<0.9` → `未達成筆數`
- 移除 `0.9~1.2`、`>1.2` 兩欄（colspan 8 → 6）
- `效率` → `達成率`

#### 年月篩選預設最近月份（`app.js`）
- `populateFilters()` 加入「預設選 months[0]（降序後第一個即最新月份）」邏輯
- `state.filterMonth` 同步設定，確保 `applyFiltersAndRender()` 以最近月份為初始篩選

#### 人員效率比較圖 legend 被遮擋修正（`app.js`）
- **根因**：y 軸 `max: 100` 時，100% 的 bar 頂端貼到繪圖區上緣，datalabel（`anchor: 'end', align: 'top'`）溢出繪圖區，與 legend 重疊
- **修法**：y 軸 `max` 改為 `112`，讓 datalabel 在繪圖區內部有空間顯示；`ticks callback` 改為 `v <= 100 ? v + '%' : ''` 避免顯示 >100% 的刻度

#### 部署注意
- Firebase CDN 有邊緣節點快取，部署後若未更新可在網址加 `?v=N` 強制 bypass（正式網址不需帶此參數）
