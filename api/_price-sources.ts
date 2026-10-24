// Price sources for the daily update (files starting with "_" are not deployed as endpoints).
//
// 1. 農業部「農產品交易行情」open data: daily wholesale prices (元/公斤) per crop and market.
//    Retail market prices are estimated from it, because no official retail series exists.
// 2. Online shop product pages (全聯全電商, 萬家福線上購物): each carries schema.org Product data with
//    the current price. Only pages an admin linked in 價格參考 are read (both robots.txt allow them).

export const PRODUCE_API = 'https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx'
// Supported shops: host + product page path.
export const PRODUCT_PAGES = [
  { host: 'shop.pxgo.com.tw', path: /^\/hourArrive\/goods\/[\w-]+\/?$/ },
  { host: 'pxbox.es.pxmart.com.tw', path: /^\/product\/\d+\/?$/ },
  { host: 'online.uni-prosperity.com.tw', path: /^\/zh\/[^/]+\/[A-Z0-9]{8,}\.html$/ },
]

// Typical traditional-market markup over wholesale; one 台斤 is 0.6 kg.
export const RETAIL_MARKUP = 1.6
const KG_PER_JIN = 0.6

// Ingredient -> crop names in the open data (a trailing * matches every variety of that crop).
export const PRODUCE_CROPS: Record<string, string[]> = {
  高麗菜: ['甘藍-初秋', '甘藍-改良種'],
  大白菜: ['包心白-包白', '包心白-其他'],
  青江菜: ['青江白菜-小梗'],
  小白菜: ['小白菜-土白菜', '小白菜-其他'],
  菠菜: ['菠菜-圓葉', '菠菜-角葉'],
  美生菜: ['萵苣菜-結球萵'],
  萵苣: ['萵苣菜-結球萵'],
  牛番茄: ['番茄-牛番茄'],
  番茄: ['番茄-黑柿', '番茄-牛番茄'],
  紅小番茄: ['小番茄-聖女', '小番茄-玉女'],
  黃小番茄: ['小番茄-其他'],
  紅蘿蔔: ['胡蘿蔔-清洗', '胡蘿蔔-未洗'],
  白蘿蔔: ['蘿蔔-白玉蘿蔔', '蘿蔔-梅花'],
  馬鈴薯: ['馬鈴薯-本產', '馬鈴薯-進口'],
  地瓜: ['甘薯-*'],
  小黃瓜: ['胡瓜-黑刺', '胡瓜-改良種'],
  茄子: ['茄子-其他', '茄子-胭脂茄', '茄子-麻荸茄'],
  青椒: ['甜椒-青椒'],
  甜椒: ['甜椒-彩色種 紅色', '甜椒-彩色種 黃色', '甜椒-彩色種'],
  紅椒: ['甜椒-彩色種 紅色'],
  黃椒: ['甜椒-彩色種 黃色'],
  花椰菜: ['花椰菜-青梗', '花椰菜-白梗'],
  白花椰菜: ['花椰菜-白梗'],
  芹菜: ['芹菜-白梗', '芹菜-芹菜管'],
  西洋芹: ['芹菜-西洋芹菜'],
  栗子南瓜: ['南瓜-栗子'],
  玉米筍: ['玉米-玉米筍'],
  四季豆: ['敏豆-醜豆', '敏豆-白豆'],
  薑: ['薑-老薑', '薑-嫩薑', '薑-粉薑'],
  九層塔: ['九層塔'],
  香菜: ['芫荽'],
  豆芽: ['芽菜類-綠豆芽', '芽菜類-黃豆芽'],
  鮮香菇: ['濕香菇'],
  金針菇: ['金絲菇-金針菇'],
  杏鮑菇: ['杏鮑菇'],
  鴻喜菇: ['鴻喜菇'],
  秀珍菇: ['秀珍菇'],
  黑木耳: ['濕木耳'],
  芋頭: ['芋-檳榔心芋', '芋-麵芋'],
  蘋果: ['蘋果-富士進口', '蘋果-其他進口'],
  香蕉: ['香蕉'],
  鳳梨: ['鳳梨-金鑽鳳梨'],
  檸檬: ['雜柑-檸檬', '雜柑-無子檸檬'],
  柳丁: ['甜橙-柳橙'],
  奇異果: ['奇異果-進口', '奇異果'],
  葡萄: ['葡萄-巨峰'],
  火龍果: ['火龍果'],
  酪梨: ['酪梨'],
}

export type ProduceRow = {
  交易日期?: string
  作物名稱?: string | null
  平均價?: number
  交易量?: number
}

export type ProducePrice = {
  ingredient: string
  // Estimated retail price per 台斤.
  price: number
  wholesalePerKg: number
  volumeKg: number
}

// 2026-10-21 -> "115.10.21" (the open data uses ROC years).
export const toRocDate = (date: Date): string =>
  `${date.getFullYear() - 1911}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`

export const rocToIso = (roc: string): string => {
  const [year, month, day] = roc.split('.').map(Number)
  return `${year + 1911}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Markets are closed some days ("休市"); such days have no usable prices.
export const hasTradingData = (rows: ProduceRow[]): boolean =>
  rows.some((row) => row.作物名稱 && row.作物名稱 !== '休市' && (row.平均價 ?? 0) > 0)

const matchesCrop = (cropName: string, pattern: string) =>
  pattern.endsWith('*') ? cropName.startsWith(pattern.slice(0, -1)) : cropName === pattern

// Volume-weighted average over every market and listed variety.
export const aggregateProduce = (rows: ProduceRow[], crops = PRODUCE_CROPS): ProducePrice[] =>
  Object.entries(crops)
    .map(([ingredient, patterns]) => {
      let weighted = 0
      let volume = 0
      rows.forEach((row) => {
        const name = row.作物名稱 ?? ''
        const price = row.平均價 ?? 0
        const qty = row.交易量 ?? 0
        if (price > 0 && qty > 0 && patterns.some((pattern) => matchesCrop(name, pattern))) {
          weighted += price * qty
          volume += qty
        }
      })
      if (volume === 0) {
        return null
      }
      const wholesalePerKg = weighted / volume
      return {
        ingredient,
        price: Math.round(wholesalePerKg * KG_PER_JIN * RETAIL_MARKUP),
        wholesalePerKg: Math.round(wholesalePerKg * 10) / 10,
        volumeKg: Math.round(volume),
      }
    })
    .filter((item): item is ProducePrice => item !== null)

export const isProductUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      PRODUCT_PAGES.some((page) => url.hostname === page.host && page.path.test(url.pathname))
    )
  } catch {
    return false
  }
}

export type ProductPrice = {
  price: number
  name: string
  inStock: boolean
}

// Reads the schema.org Product block of a shop's product page.
export const parseProductPrice = (html: string): ProductPrice | null => {
  const blocks = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) ?? []
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
    try {
      const parsed = JSON.parse(json) as unknown
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        const product = item as { '@type'?: string; name?: string; offers?: { price?: number | string; availability?: string } }
        const price = Number(product.offers?.price)
        if (product['@type'] === 'Product' && Number.isFinite(price) && price > 0) {
          return {
            price,
            name: product.name ?? '',
            inStock: !String(product.offers?.availability ?? '').includes('OutOfStock'),
          }
        }
      }
    } catch {
      // Not JSON we understand; try the next block.
    }
  }
  return null
}

// ---------- Firestore REST helpers (values <-> plain JSON) ----------
type FirestoreValue = Record<string, unknown>

export const toFirestoreValue = (value: unknown): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } }
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])) } }
  }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  return { stringValue: String(value) }
}

export const fromFirestoreValue = (value: FirestoreValue | undefined): unknown => {
  if (!value) return undefined
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('nullValue' in value) return null
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] }).values ?? []
    return values.map(fromFirestoreValue)
  }
  if ('mapValue' in value) {
    const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {}
    return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, fromFirestoreValue(item)]))
  }
  return undefined
}
