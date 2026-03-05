export type ChangelogEntry = {
  version: string
  date: string
  changes: string[]
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
{
    version: 'v2.0.0',
    date: '2026-03-06',
    changes: ['正式版本發布，加入所有資料刪除功能，並清空現有資料。'],
  },
  {
    version: 'v1.8.0',
    date: '2026-03-06',
    changes: ['新增管理員限定「食材採買」分頁，可新增商店並分派食材採買清單與金額計算。'],
  },
  {
    version: 'v1.7.1',
    date: '2026-03-06',
    changes: ['新增管理員限定「各組工具表」，並提供每列工具備妥勾選框。'],
  },
  {
    version: 'v1.7.0',
    date: '2026-03-06',
    changes: ['新增可編輯的預設食材庫檔案，並加入「第七組」作為備用分組。'],
  },
  {
    version: 'v1.6.4',
    date: '2026-03-06',
    changes: ['iCook 縮圖抓取失敗時不再回退舊截圖，改為直接顯示開啟連結提示。'],
  },
  {
    version: 'v1.6.3',
    date: '2026-03-06',
    changes: ['iCook 網址縮圖改為優先透過 API 抓取封面，避免首次顯示錯誤預設圖。'],
  },
  {
    version: 'v1.6.2',
    date: '2026-03-06',
    changes: ['修正 iCook 食譜縮圖來源，特定食譜可顯示正確封面圖。'],
  },
  {
    version: 'v1.6.1',
    date: '2026-03-06',
    changes: ['新增 iCook 食譜網址縮圖預覽支援（例如 icook.tw/recipes/...）。'],
  },
  {
    version: 'v1.6.0',
    date: '2026-03-06',
    changes: [
      '各組食材表新增每組摺疊功能。',
      '在各組食材表與食材總表加入備料勾選框，可標記是否已準備食材。',
    ],
  },
  {
    version: 'v1.5.1',
    date: '2026-03-06',
    changes: ['優化摺疊按鈕樣式（右側箭頭、展開向上/收合向下）並加入收合動畫。'],
  },
  {
    version: 'v1.5.0',
    date: '2026-03-06',
    changes: ['新增料理1/2/3與工具表的摺疊功能，方便快速收合內容。'],
  },
  {
    version: 'v1.4.0',
    date: '2026-03-06',
    changes: ['新增「各組食材總庫」管理員頁面，完整顯示各組別食材明細，不做跨組合併。'],
  },
  {
    version: 'v1.3.0',
    date: '2026-03-05',
    changes: [
      '新增管理員右上角權限輸入，解鎖後才會顯示食材總表、工具總表與食材庫。',
      '新增食材庫頁面（管理員可新增與刪除食材），食材欄位支援建議選項。',
      '新增版本日誌頁面，所有人都可以查看每次更新內容。',
    ],
  },
]
