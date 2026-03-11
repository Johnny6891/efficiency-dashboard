# 安全模板（新專案）

這份模板用來避免把憑證或私鑰誤提交到 Git。

## 內容

- `.gitignore.template`：建議的忽略規則
- `PROJECT_PLAN_TEMPLATE.md`：規劃階段就納入安全基線
- `../../.github/workflows/secret-scan.yml`：CI 自動掃描規則
- `../../scripts/bootstrap-security-template.ps1`：一鍵套用腳本

## 不想手動怎麼做

直接在對話中說：

- 「幫我建立新專案並套用安全基線」
- 或「規劃新專案時先套安全模板」

Codex 會在建立專案時自動完成，不需要你手動跑腳本。

## 套用步驟（手動備援）

1. 複製 `.gitignore.template` 內容到新專案 `.gitignore`。
2. 複製 `secret-scan.yml` 到新專案 `.github/workflows/`。
3. 依 `PROJECT_PLAN_TEMPLATE.md` 建立 `docs/PROJECT_PLAN.md`。
4. 憑證一律放在 Secret Manager / CI Secrets，不放在 repo。
5. 若有懷疑外洩，立刻輪替金鑰並停用舊金鑰。

## 最小檢查清單

- [ ] repo 中沒有 `service-account*.json` 類檔案
- [ ] CI 會在 push/PR 自動掃描
- [ ] 部署憑證只來自 secrets（非檔案）
- [ ] 規劃文件已填寫安全與憑證策略
