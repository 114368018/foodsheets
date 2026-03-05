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

## 雲端同步與圖片設定（跨裝置）

1. 在 Firebase 建立專案並啟用 Firestore Database（用來同步文字資料）。
2. 在 Cloudinary 建立帳號，建立一個 `Unsigned` Upload Preset（用來上傳圖片）。
	前端只需要 `cloud_name` 與 `upload_preset`，不要把 `api_secret` 放進 `.env`。
3. 複製 `.env.example` 為 `.env`，填入 Firebase 與 Cloudinary 設定值。
4. 重新啟動開發伺服器。

```bash
cp .env.example .env
npm run dev
```

5. 預設會同步到 `projects/{VITE_FIREBASE_PROJECT_DOC_ID}`，可在 `.env` 改成你想要的專案代號。
6. 圖片會上傳到 Cloudinary，並把圖片 URL 存進 Firestore。
7. 若要啟用「刪除圖片時同步刪除 Cloudinary」，請在 Vercel 專案環境變數新增：
	`CLOUDINARY_CLOUD_NAME`、`CLOUDINARY_API_KEY`、`CLOUDINARY_API_SECRET`（這三個是 server-only，不可加 `VITE_` 前綴）。

若未設定 Firebase，系統會自動退回本機 `localStorage` 模式；若未設定 Cloudinary，圖片上傳功能會停用並顯示提示。
若未設定上述 server-only Cloudinary 變數，按刪除時仍會從表單移除圖片，但不會同步刪除 Cloudinary 檔案。

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
