# foodsheets (食材管理與協作系統)

以 Vite + React + TypeScript 建立的多人協作食材與工具管理網站專案。適用於團膳、廚藝競賽、或大型料理活動的各組食材登記與總務採買管理。

## 🌟 核心特色 (Features)
- **多人即時協作**：透過 Firebase Firestore 達成跨裝置、多人同時編輯，資料即時同步。
- **直覺的分組管理**：預設「第一組」到「第七組」與「學長姐組」，管理員可自行新增、改名、刪除組別；每組有獨立的食譜、食材、工具管理面板。
- **不怕多人同時編輯**：同步採三方合併（transaction + 版本號），刪除的資料不會被其他裝置的舊快照加回來。
- **自動化彙總**：系統會自動抓取所有組別填寫的食材與工具數量，產生「食材總表」與「工具總表」，方便總務統計與評估。
- **食譜連結與圖床整合**：
  - 支援上傳食譜參考圖片至 Cloudinary。
  - 貼上愛料理 (iCook) 網址時，可自動透過 Serverless API 抓取食譜封面圖。
- **專屬管理員視角**：包含快速核對清點功能、採買清單分派與金額計算。

## 🚀 主要功能 (Capabilities)
### 🧑‍🍳 一般組別功能
1. **菜單建檔**：設定隊名、菜系，並建立多道菜色。
2. **多媒體食譜參考**：每道菜可附上食譜教學網址（自動抓圖）或上傳圖片（支援 Ctrl+V 貼上與拖曳）。
3. **食材快速填寫**：直接輸入「番茄 6顆」或一次貼上整份食材清單會自動拆列；數量與單位合併成一格，內建食材庫可下拉帶入。每項食材可附照片，採買時照著買。
4. **工具需求提報**：填寫所需工具與數量。
5. **介面收折**：支援菜色、食材表、工具表的區塊收折，版面更清爽。

### 👑 管理員功能 (需輸入管理員密碼解鎖: 預設為 admin)
1. **食材/工具查核 (各組食材表/各組工具表)**：能以清單方式檢視各組需求，並提供「備妥」打勾功能，清楚掌握發放/自備進度。
2. **食材採買模組 (Shopping List)**：可新增採購地點 (如全聯、菜市場)，將需採買的項目列入，填寫預估/實際價格，並標記是否已購買。
3. **食材庫維護**：維護系統共用的預設食材選單。
4. **數字微調**：能在總表中對自動加總的食材/工具數量進行手動增刪微調。
5. **採買三步驟**：依分類與參考價建議去菜市場／全聯／萬家福／Costco 買並估價、一鍵分配；到店用手機「採買模式」邊買邊勾、記金額；最後填收據總額，自動算出實際花費與各組分攤。
6. **價格參考**：可維護各商店的參考價、包裝數量與是否秤重計價。
7. **一次匯出 ZIP**：各組食材表／各組工具表可一次下載 ZIP，裡面每組各一份 Word。
8. **食材與工具自動翻譯**：英文輸入的食材、工具會對應成中文後合併；英文模式顯示英文名稱，匯出也會翻成英文（內建對照表＋MyMemory 免費機器翻譯，結果存在專案資料中，可在食材總表修正）。

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

### 測試與檢查
```bash
# 採買計算、同步合併、食材解析、名稱整併、價格來源的自動測試
npm test

# 檢查是否有介面文字還沒有英文翻譯（新增或修改介面文字後執行）
npm run i18n:check
```

### 每日自動更新價格
- `api/update-prices.ts` 由 Vercel Cron 每天 23:00 UTC（台灣早上 7 點）執行（設定在 `vercel.json`），也可在「價格參考」頁按「立即更新價格」（10 分鐘內只能手動執行一次）。
- 菜市場：農業部「農產品交易行情」開放資料的批發均價（各市場成交量加權）× 1.6 換算每台斤零售價。管理員手動改過的價格不會被覆蓋。
- 全聯、萬家福：只抓管理員在價格參考貼上的「全聯小時達」（/hourArrive/goods/ 頁面）、「全聯全電商」（/product/ 頁面）或「萬家福線上購物」（/zh/…/<商品編號>.html 頁面）商品頁，三者的 robots.txt 都允許，讀取頁面內 schema.org 的售價。網路價格可能與門市略有不同；生鮮蔬菜網路上沒賣，仍用菜市場行情。
- 結果寫在 Firestore 的 `projects/<文件ID>--prices`，需要 Firestore 規則允許讀寫這份文件。可選擇在 Vercel 設定 `CRON_SECRET`，讓排程呼叫帶有驗證。

### 用 Firestore 模擬器在本機測試（不會動到正式資料）
1. 另開終端機：`npx firebase-tools emulators:start --only firestore --project demo-foodsheets`（需要 Java）
2. 在 `.env.local` 加上 `VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`（埠號依模擬器顯示為準）與 `VITE_FIREBASE_PROJECT_ID=demo-foodsheets`，再執行 `npm run dev`。

### 雲端資源服務設定
1. **Firebase**：請建立 Firebase 專案並啟用 Firestore Database（預設為測試模式或自行設定規則）。
2. **Cloudinary**：
   - 註冊並進入 Dashboard，取得 `cloud_name`。
   - 在 Settings > Upload 中，建立一個 **Unsigned** 的 Upload Preset，取得其名稱。

## 📝 版本日誌與狀態儲存
- 系統內部使用 LocalStorage (`foodsheets.v1.state`) 保存目前分頁、本機資料與「最後一次看到的雲端版本」，用來在重新連線時正確合併尚未同步的修改。核心資料以 Firebase 為準 (SSOT)。
- 版本更新請參見介面中的「版本日誌」分頁，可追蹤系統演進史。

## 📦 部署 (Deployment)
本專案支援 Vercel 與 Netlify 部署，只需將 Build Command 設為 `npm run build`，Output Directory 設為 `dist` 即可。若有使用到 `/api/` 的 Serverless Function 則強烈建議部署至 **Vercel**。
