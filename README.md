# foodsheets

以 Vite + React + TypeScript 建立的食材管理網站專案。

## MVP 功能

- 類試算表食材輸入表格（可新增、刪除列）
- 規則驗證：有填食材時，總量必填
- 自動彙總食材總表（僅彙總符合規則的資料列）

## 開發指令

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```

## 目前狀態

- 已完成專案腳手架初始化
- 已建立 VS Code 任務：`Run Vite Dev Server`
- 已通過 `npm run build` 編譯驗證

## 免費部署（可在外使用）

### 方案 A：Vercel（推薦）

1. 將專案推到 GitHub
2. 到 Vercel 匯入該 repository
3. Framework Preset 選 `Vite`
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Deploy

免費額度足夠個人與小團隊長期使用，更新程式後可自動重新部署。

### 方案 B：Netlify

1. 將專案推到 GitHub
2. 到 Netlify 匯入該 repository
3. Build Command: `npm run build`
4. Publish Directory: `dist`
5. Deploy
