---
description: 前端設計系統規範 — Liquid Glass + 莫蘭迪配色
---

# 前端設計規範

## 設計風格：Liquid Glass + 莫蘭迪配色

所有前端專案必須套用以下設計系統，**無需使用者另行指定**。

---

## 色彩系統（莫蘭迪配色）

```css
:root {
  /* 主色調 — 莫蘭迪暖灰藍 */
  --color-primary: #8c9db5;       /* 主要強調色 */
  --color-primary-light: #b0c4d8;

  /* 中性色 */
  --color-bg: #f2ede8;            /* 主背景（米白） */
  --color-surface: rgba(255, 255, 255, 0.45); /* Glass 卡片背景 */
  --color-border: rgba(255, 255, 255, 0.6);

  /* 語意色（低飽和莫蘭迪版） */
  --color-success: #9dba9d;       /* 鼠尾草綠 */
  --color-warning: #d4b896;       /* 杏色 */
  --color-danger: #c9968a;        /* 磚玫瑰紅 */
  --color-info: #8c9db5;          /* 霧藍 */

  /* 文字 */
  --color-text: #4a4a4a;
  --color-text-muted: #8a8a8a;

  /* Glass 效果 */
  --glass-blur: blur(16px);
  --glass-bg: rgba(255, 255, 255, 0.45);
  --glass-border: 1px solid rgba(255, 255, 255, 0.6);
  --glass-shadow: 0 8px 32px rgba(140, 157, 181, 0.15);
}
```

---

## Liquid Glass 核心 CSS

```css
/* Glass 卡片 */
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--glass-border);
  border-radius: 16px;
  box-shadow: var(--glass-shadow);
}

/* Glass 按鈕 */
.glass-btn {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 10px;
  color: var(--color-primary);
  transition: all 0.2s ease;
}
.glass-btn:hover {
  background: rgba(255, 255, 255, 0.7);
  transform: translateY(-1px);
}

/* 主背景 — 莫蘭迪漸層 */
body {
  background: linear-gradient(135deg, #f2ede8 0%, #e8e0f0 50%, #dce8f0 100%);
  min-height: 100vh;
  font-family: 'Inter', 'Noto Sans TC', sans-serif;
  color: var(--color-text);
}
```

---

## 字型

- 英文：`Inter`（Google Fonts）
- 中文：`Noto Sans TC`（Google Fonts）
- 引入：`https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap`

---

## 設計原則

1. **背景**：莫蘭迪漸層（米白 → 淡紫 → 淡藍），不用純白或深色
2. **卡片/容器**：Liquid Glass（`backdrop-filter: blur` + 半透明白 + 白色邊框）
3. **強調色**：霧藍 `#8c9db5`，避免飽和鮮豔色
4. **狀態色**：皆使用低飽和版（鼠尾草綠/杏色/磚玫瑰紅）
5. **陰影**：柔和，用主色半透明（`rgba(140, 157, 181, 0.15)`）
6. **動效**：subtle，hover 用 `translateY(-1px)` + `transition: 0.2s ease`
7. **圓角**：卡片 `16px`，按鈕 `10px`，輸入框 `8px`

---

## Chart.js 莫蘭迪色盤

```js
const MORANDI_PALETTE = [
  '#8c9db5', '#9dba9d', '#d4b896', '#c9968a',
  '#b5a8c8', '#a8c4c4', '#c4b5a0', '#b5b5b5'
];
```

---

## 參考專案

- `c:\Users\user\vibe coding\efficiency-dashboard\public\` — 完整實作範例
