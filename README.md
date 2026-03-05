# foodsheets (食材管理與協作系統)

以 Vite + React + TypeScript 建立的多人協作食材與工具管理網站專案。適用於團膳、廚藝競賽、或大型料理活動的各組食材登記與總務採買管理。

## 🌟 核心特色 (Features)
- **多人即時協作**：透過 Firebase Firestore 達成跨裝置、多人同時編輯，資料即時同步。
- **直覺的分組管理**：內建「第一組」到「第七組」與「學長姐組」，每組獨立的食譜、食材、工具管理面板。
- **自動化彙總**：系統會自動抓取所有組別填寫的食材與工具數量，產生「食材總表」與「工具總表」，方便總務統計與評估。
- **食譜連結與圖床整合**：
  - 支援上傳食譜參考圖片至 Cloudinary。
  - 貼上愛料理 (iCook) 網址時，可自動透過 Serverless API 抓取食譜封面圖。
- **專屬管理員視角**：包含快速核對清點功能、採買清單分派與金額計算。

## 🚀 主要功能 (Capabilities)
### 🧑‍🍳 一般組別功能
1. **菜單建檔**：設定隊名、菜系，並建立多道菜色。
2. **多媒體食譜參考**：每道菜可附上食譜教學網址（自動抓圖）或是自行上傳圖片。
3. **食材份量估算**：採用「單位/單份量」與「總量」雙軌填寫，且有內建食材庫可透過下拉選單快速帶入。
4. **工具需求提報**：填寫所需工具與數量。
5. **介面收折**：支援菜色、食材表、工具表的區塊收折，版面更清爽。

### 👑 管理員功能 (需輸入管理員密碼解鎖: 預設為 admin)
1. **食材/工具查核 (各組食材表/各組工具表)**：能以清單方式檢視各組需求，並提供「備妥」打勾功能，清楚掌握發放/自備進度。
2. **食材採買模組 (Shopping List)**：可新增採購地點 (如全聯、菜市場)，將需採買的項目列入，填寫預估/實際價格，並標記是否已購買。
3. **食材庫維護**：維護系統共用的預設食材選單。
4. **數字微調**：能在總表中對自動加總的食材/工具數量進行手動增刪微調。

## 🛠️ 技術架構 (Tech Stack)
- **前端工具**：Vite + React 19 + TypeScript
- **資料庫**：Firebase Firestore (即時資料庫)
- **雲端圖床**：Cloudinary (圖片上傳與儲存)
- **Serverless API**：Vercel Serverless Functions (`/api/`)，用以處理跨域抓圖與 Cloudinary 圖片刪除。
- **樣式**：純 CSS (CSS Variables)

## 💻 專案操作與開發指南 (Getting Started)

### 前置準備
你需要在本地端建立 `.env` 檔案並填入環境變數（可參考 `.env.example`）：
- Firebase 設定檔 (包含 `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_AUTH_DOMAIN` 等)
- Cloudinary 設定檔 (`VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`)
- 若要本機測試刪除檔案 API，需要加填 Server-only 的變數（不帶 VITE 前綴）：`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`。

### 指令集
```bash
# 安裝依賴套件
npm install

# 啟動一般開發環境伺服器
npm run dev

# 啟動包含 Serverless API 的本機伺服器 (透過 Vercel CLI)
npm run dev:vercel

# 進行打包建置
npm run build
```

### 雲端資源服務設定
1. **Firebase**：請建立 Firebase 專案並啟用 Firestore Database（預設為測試模式或自行設定規則）。
2. **Cloudinary**：
   - 註冊並進入 Dashboard，取得 `cloud_name`。
   - 在 Settings > Upload 中，建立一個 **Unsigned** 的 Upload Preset，取得其名稱。

## 📝 版本日誌與狀態儲存
- 系統內部使用 LocalStorage (`foodsheets.v1.state`) 在離線或載入前保存部分視圖狀態 (如當前分頁、收折狀態)。核心資料庫源皆優先來自 Firebase (SSOT)。
- 版本更新請參見介面中的「版本日誌」分頁，可追蹤系統演進史。

## 📦 部署 (Deployment)
本專案支援 Vercel 與 Netlify 部署，只需將 Build Command 設為 `npm run build`，Output Directory 設為 `dist` 即可。若有使用到 `/api/` 的 Serverless Function 則強烈建議部署至 **Vercel**。
