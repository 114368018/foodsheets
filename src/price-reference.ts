import type { PriceEntry } from './shopping'

// Reference prices (NT$) used to suggest where to buy and to estimate the budget.
// Compiled 2026-10 from public price reports and typical shelf prices; they are estimates only.
// Admins can edit everything on the 「價格參考」 page, and real spending always comes from what
// shoppers enter while buying.
export const PRICE_REFERENCE_UPDATED = '2026-10'

type SeedRow = [
  ingredient: string,
  store: string,
  price: number,
  packQty: number,
  packUnit: string,
  spec: string,
  loose?: boolean,
  sourceUrl?: string,
]

const SEED: SeedRow[] = [
  // 菜市場：蔬果多為秤重（每台斤），價格隨季節波動大
  ['高麗菜', '菜市場', 30, 1, '斤', '秤重，一顆約 2～2.5 斤', true],
  ['大白菜', '菜市場', 30, 1, '斤', '秤重', true],
  ['青江菜', '菜市場', 40, 1, '斤', '秤重', true],
  ['菠菜', '菜市場', 60, 1, '斤', '秤重', true],
  ['牛番茄', '菜市場', 50, 1, '斤', '秤重，約 3 顆一斤', true],
  ['番茄', '菜市場', 45, 1, '斤', '秤重', true],
  ['紅蘿蔔', '菜市場', 30, 1, '斤', '秤重，約 2 條一斤', true],
  ['白蘿蔔', '菜市場', 25, 1, '斤', '秤重', true],
  ['馬鈴薯', '菜市場', 35, 1, '斤', '秤重，約 3 顆一斤', true],
  ['地瓜', '菜市場', 35, 1, '斤', '秤重', true],
  ['小黃瓜', '菜市場', 45, 1, '斤', '秤重', true],
  ['茄子', '菜市場', 45, 1, '斤', '秤重', true],
  ['櫛瓜', '菜市場', 60, 1, '斤', '秤重', true],
  ['青椒', '菜市場', 60, 1, '斤', '秤重', true],
  ['甜椒', '菜市場', 25, 1, '顆', '紅／黃椒單顆'],
  ['栗子南瓜', '菜市場', 60, 1, '顆', '單顆'],
  ['玉米筍', '菜市場', 30, 1, '盒', '一盒約 150g'],
  ['四季豆', '菜市場', 70, 1, '斤', '秤重', true],
  ['薑', '菜市場', 90, 1, '斤', '秤重', true],
  ['九層塔', '菜市場', 20, 1, '把', '一小把'],
  ['香菜', '菜市場', 20, 1, '把', '一小把，夏季可能大漲'],
  ['豆芽', '菜市場', 20, 1, '斤', '秤重', true],
  ['鮮香菇', '菜市場', 160, 1, '斤', '秤重', true],
  ['金針菇', '菜市場', 15, 1, '包', '一包約 200g'],
  ['鴻喜菇', '菜市場', 30, 1, '包', '一包約 150g'],
  ['杏鮑菇', '菜市場', 40, 1, '包', '一包約 300g'],
  ['板豆腐', '菜市場', 20, 1, '塊', '豆腐攤'],
  ['嫩豆腐', '菜市場', 20, 1, '盒', '豆腐攤'],
  ['豆干', '菜市場', 40, 1, '斤', '秤重', true],
  ['雞蛋', '菜市場', 55, 10, '顆', '蛋行，約一台斤'],
  ['蘋果', '菜市場', 35, 1, '顆', '單顆'],
  ['檸檬', '菜市場', 15, 1, '顆', '單顆'],

  // 全聯：包裝品、乳製品、乾貨調味
  ['雞蛋', '全聯', 70, 10, '顆', '盒裝 10 入，58～89 元不等'],
  ['牛奶', '全聯', 95, 936, 'ml', '鮮乳 936ml'],
  ['鮮奶', '全聯', 95, 936, 'ml', '鮮乳 936ml'],
  ['無鹽奶油', '全聯', 135, 227, 'g', '227g 條狀'],
  ['奶油', '全聯', 135, 227, 'g', '227g 條狀'],
  ['鮮奶油', '全聯', 85, 200, 'ml', '動物性 200ml'],
  ['起司片', '全聯', 99, 12, '片', '12 片裝'],
  ['起司絲', '全聯', 109, 200, 'g', '披薩用 200g'],
  ['優格', '全聯', 75, 450, 'g', '450g 原味'],
  ['高麗菜', '全聯', 45, 1, '顆', '整顆'],
  ['牛番茄', '全聯', 59, 4, '顆', '盒裝約 4 顆'],
  ['紅蘿蔔', '全聯', 35, 3, '條', '袋裝約 3 條'],
  ['馬鈴薯', '全聯', 45, 3, '顆', '袋裝約 3 顆'],
  ['板豆腐', '全聯', 25, 1, '盒', '盒裝'],
  ['嫩豆腐', '全聯', 22, 1, '盒', '盒裝'],
  ['白米', '全聯', 199, 3, 'kg', '3kg 袋裝'],
  ['義大利麵條', '全聯', 59, 500, 'g', '500g'],
  ['中筋麵粉', '全聯', 55, 1, 'kg', '1kg'],
  ['低筋麵粉', '全聯', 60, 1, 'kg', '1kg'],
  ['麵粉', '全聯', 55, 1, 'kg', '1kg'],
  ['砂糖', '全聯', 50, 1, 'kg', '1kg'],
  ['細砂糖', '全聯', 55, 1, 'kg', '1kg'],
  ['鹽', '全聯', 25, 1, 'kg', '精鹽 1kg'],
  ['醬油', '全聯', 110, 1000, 'ml', '1000ml'],
  ['番茄醬', '全聯', 55, 500, 'g', '500g'],
  ['食用油', '全聯', 159, 2, 'l', '沙拉油 2L'],
  ['玉米罐頭', '全聯', 35, 1, '罐', '340g'],
  ['白吐司', '全聯', 55, 1, '條', '一條'],
  ['太白粉', '全聯', 35, 500, 'g', '500g'],

  // Costco：量大單價低，適合多組共用的大宗食材
  ['雞蛋', 'Costco', 219, 30, '顆', '30 入'],
  ['無鹽奶油', 'Costco', 549, 1812, 'g', '科克蘭 453g × 4'],
  ['奶油', 'Costco', 549, 1812, 'g', '科克蘭 453g × 4'],
  ['鮮奶油', 'Costco', 239, 1000, 'ml', '動物性 1L'],
  ['起司絲', 'Costco', 369, 1000, 'g', '莫札瑞拉乳酪絲 1kg'],
  ['牛奶', 'Costco', 289, 3784, 'ml', '鮮乳 1.89L × 2'],
  ['鮮奶', 'Costco', 289, 3784, 'ml', '鮮乳 1.89L × 2'],
  ['橄欖油', 'Costco', 599, 3, 'l', '3L'],
  ['白米', 'Costco', 499, 9, 'kg', '9kg'],
]

// 萬家福線上購物 (formerly 家樂福) products, looked up 2026-10-24. Each is linked to its product page,
// so the daily update keeps the price current. Fresh produce is not sold online and stays on market data.
const UNI_PROSPERITY_SEED: SeedRow[] = [
  ['雞蛋', '萬家福', 130, 10, '顆', '非籠飼 10 入', undefined, 'https://online.uni-prosperity.com.tw/zh/%E9%AE%AE%E6%B4%BB%E8%B5%B0%E5%9C%B0%E8%9B%8B/1507003400101.html'],
  ['牛奶', '萬家福', 85, 930, 'ml', '瑞穗全脂 930ml', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%B5%B1%E4%B8%80/1501001100101.html'],
  ['鮮奶油', '萬家福', 349, 1000, 'ml', '總統牌動物性 1L', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%B8%BD%E7%B5%B1%E7%89%8C/1503201200101.html'],
  ['無鹽奶油', '萬家福', 49, 100, 'g', '卡貝樂 100g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%8D%A1%E8%B2%9D%E6%A8%82/1503092000101.html'],
  ['無鹽奶油', '萬家福', 329, 500, 'g', '總統牌 500g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%B8%BD%E7%B5%B1%E7%89%8C/1503002000101.html'],
  ['起司絲', '萬家福', 149, 300, 'g', '寶宏安柏 300g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%AF%B6%E5%AE%8F/1504208300101.html'],
  ['起司片', '萬家福', 196, 24, '片', '安佳 24 片', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%AE%89%E4%BD%B3/1504003400101.html'],
  ['白米', '萬家福', 239, 3, 'kg', '3kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E9%97%9C%E5%B1%B1%E7%A9%80%E5%A0%A1/1451012200101.html'],
  ['中筋麵粉', '萬家福', 70, 1000, 'g', '駱駝牌 1kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E9%A7%B1%E9%A7%9D%E7%89%8C/1474001700101.html'],
  ['低筋麵粉', '萬家福', 70, 1000, 'g', '駱駝牌 1kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E9%A7%B1%E9%A7%9D%E7%89%8C/1474005000101.html'],
  ['細砂糖', '萬家福', 36, 1, 'kg', '台糖 1kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%8F%B0%E7%B3%96/1437000200101.html'],
  ['砂糖', '萬家福', 36, 1, 'kg', '台糖 1kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%8F%B0%E7%B3%96/1437000200101.html'],
  ['二號砂糖', '萬家福', 36, 1, 'kg', '台糖 1kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%8F%B0%E7%B3%96/1437000400101.html'],
  ['醬油', '萬家福', 114, 1600, 'ml', '龜甲萬 1600ml', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%B5%B1%E4%B8%80/1462001400101.html'],
  ['番茄醬', '萬家福', 58, 560, 'g', '工研 560g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%B7%A5%E7%A0%94%E9%85%A2/1463001000101.html'],
  ['義大利麵條', '萬家福', 89, 500, 'g', '#16 500g', undefined, 'https://online.uni-prosperity.com.tw/zh/molisana/1450723300101.html'],
  ['玉米罐頭', '萬家福', 92, 1, '罐', '340g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%89%9B%E9%A0%AD%E7%89%8C/1481001600103.html'],
  ['板豆腐', '萬家福', 20, 1, '盒', '義美 300g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%BE%A9%E7%BE%8E/1508000300101.html'],
  ['嫩豆腐', '萬家福', 18, 1, '盒', '義美 290g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E7%BE%A9%E7%BE%8E/1508000600101.html'],
  ['食用油', '萬家福', 169, 3, 'l', '台糖 3L', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%8F%B0%E7%B3%96/1461001100101.html'],
  ['橄欖油', '萬家福', 472, 1000, 'ml', '1L', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%BE%97%E6%84%8F%E7%9A%84%E4%B8%80%E5%A4%A9/1461201800201.html'],
  ['鹽', '萬家福', 17, 1, 'kg', '台鹽 1kg', undefined, 'https://online.uni-prosperity.com.tw/zh/%E5%8F%B0%E9%B9%BD/1460000500101.html'],
  ['白吐司', '萬家福', 48, 0.5, '條', '半條', undefined, 'https://online.uni-prosperity.com.tw/zh/%E8%87%AA%E8%A3%BD%E5%93%81/2300002300101.html'],
  ['優格', '萬家福', 88, 500, 'g', '希臘式無糖 500g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E6%AF%94%E8%8F%B2%E5%A4%9A/1500304300101.html'],
  ['咖喱', '萬家福', 115, 1, '盒', '佛蒙特 230g', undefined, 'https://online.uni-prosperity.com.tw/zh/house-%E5%A5%BD%E4%BE%8D/1460300300101.html'],
  ['可可粉', '萬家福', 229, 100, 'g', '100g', undefined, 'https://online.uni-prosperity.com.tw/zh/%E9%9C%B2%E7%89%B9/G423008526301.html'],
]

const toEntries = (rows: SeedRow[], firstId: number): PriceEntry[] =>
  rows.map(([ingredient, store, price, packQty, packUnit, spec, loose, sourceUrl], index) => ({
    id: firstId + index,
    ingredient,
    store,
    price: String(price),
    packQty: String(packQty),
    packUnit,
    spec,
    ...(loose ? { loose: true } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  }))

// Starting price lists, applied once per project (an admin deleting entries later is respected).
export const PRICE_SEED_BATCHES: Array<{ id: string; entries: PriceEntry[] }> = [
  { id: 'base-2026-10', entries: toEntries(SEED, 1) },
  { id: 'uni-prosperity-2026-10', entries: toEntries(UNI_PROSPERITY_SEED, 1001) },
]
