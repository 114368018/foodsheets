// Shopping helpers: where to buy each ingredient, how much it should cost, and unit conversion.

export type StoreKind = '菜市場' | '全聯' | '萬家福' | 'Costco'

export const STORE_KINDS: StoreKind[] = ['菜市場', '全聯', '萬家福', 'Costco']

export type PriceEntry = {
  id: number
  ingredient: string
  store: string
  price: string
  packQty: string
  packUnit: string
  spec: string
  // Sold loose by weight (market stalls): cost is proportional instead of whole packs.
  loose?: boolean
  // Online shop product page (全聯全電商, 萬家福線上購物) whose price the daily update copies in.
  sourceUrl?: string
  // When an admin last edited the price by hand (ISO time).
  updatedAt?: string
  // Set only on the effective price list: where the shown price came from and when.
  auto?: 'product' | 'produce'
  autoAt?: string
}

type CategoryDef = {
  name: string
  defaultStore: StoreKind
  names: string[]
  keywords: string[]
}

// Ordered like a walk through the market / supermarket. First match wins.
export const INGREDIENT_CATEGORIES: CategoryDef[] = [
  {
    name: '罐頭・乾貨',
    defaultStore: '全聯',
    names: ['玉米罐頭', '番茄罐頭', '鮪魚罐頭', '乾香菇', '乾猴頭菇', '乾海帶', '乾昆布', '果乾', '辣椒乾'],
    keywords: ['罐頭', '乾'],
  },
  {
    name: '醬料・調味',
    defaultStore: '全聯',
    names: ['鹽', '味精', '白醋', '壽司醋', '酸瓜', '味噌', '羅望子', '泡菜'],
    keywords: ['醬', '醋', '油膏', '蠔油', '鹽', '糖'],
  },
  {
    name: '菇類',
    defaultStore: '菜市場',
    names: ['黑木耳'],
    keywords: ['菇'],
  },
  {
    name: '蔬菜',
    defaultStore: '菜市場',
    names: ['薑', '南薑', '黃薑', '豆芽', '玉米粒', '玉米筍', '碧玉筍', '四季豆', '辣椒葉', '九層塔', '香菜', '迷迭香'],
    keywords: ['菜', '瓜', '蘿蔔', '番茄', '茄子', '椒', '筍', '薯', '芋頭', '萵苣', '芹', '蔥', '蒜', '豆苗'],
  },
  {
    name: '水果',
    defaultStore: '菜市場',
    names: ['蘋果', '青蘋果', '奇異果', '酪梨', '柳丁', '橘子', '鳳梨', '哈密瓜', '西瓜', '火龍果', '紅火龍果', '葡萄', '紫葡萄', '無子葡萄', '藍莓', '石榴', '檸檬', '香蕉'],
    keywords: ['果', '莓', '葡萄', '瓜', '蕉'],
  },
  {
    name: '豆製品・素料',
    defaultStore: '菜市場',
    names: ['豆干', '豆花', '麵腸', '素肉', '素肉燥', '素火腿', '素培根', '素熱狗', '素鬆', '小肉豆', '火腿漿', 'Omnipork新豬肉'],
    keywords: ['豆腐', '豆皮', '素'],
  },
  {
    name: '蛋・乳製品',
    defaultStore: '全聯',
    names: ['雞蛋', '蛋黃', '滷蛋', '牛奶', '鮮奶', '優格', '煉乳', '奶油', '無鹽奶油', '鮮奶油'],
    keywords: ['蛋', '奶', '起司', '乳酪', '優格'],
  },
  {
    name: '米麵・主食',
    defaultStore: '全聯',
    names: ['白米', '糯米', '年糕', '薯餅', '薯條', '嫩油條', '甜不辣', '米紙', '海苔片', 'pappadam餅', '西米'],
    keywords: ['米', '麵', '粉絲', '河粉', '吐司', '麵包', '餅皮', '起酥'],
  },
  {
    name: '粉類・烘焙',
    defaultStore: '全聯',
    names: ['吉利丁粉', '素吉利丁', '巧克力豆'],
    keywords: ['粉', '酵母', '泡打'],
  },
  {
    name: '堅果・豆類・餡料',
    defaultStore: '全聯',
    names: ['花生', '花生米', '核桃', '紅豆'],
    keywords: ['芝麻', '堅果', '餡', '豆'],
  },
  {
    name: '香料',
    defaultStore: '全聯',
    names: ['八角', '桂皮', '香葉', '香茅', '斑蘭葉', '小茴香', '香料包', '伯爵茶包', '紅茶葉', '決明子', '咖喱', '東南亞咖喱'],
    keywords: ['胡椒', '香料', '咖哩', '咖喱', '茴香'],
  },
  {
    name: '油品・飲品',
    defaultStore: '全聯',
    names: ['米酒', '檸檬汁', '豆漿', '燕麥奶', '無糖豆奶', '椰奶', '水', '冰塊', '食用油', '橄欖油', '玄米油', '椰子油'],
    keywords: ['油', '奶', '酒', '汁'],
  },
]

export const OTHER_CATEGORY = '其他'

export const CATEGORY_ORDER = [...INGREDIENT_CATEGORIES.map((category) => category.name), OTHER_CATEGORY]

const normalizeName = (name: string) => name.trim().toLowerCase()

export const categorizeIngredient = (name: string): string => {
  const value = normalizeName(name)
  if (!value) {
    return OTHER_CATEGORY
  }

  const exact = INGREDIENT_CATEGORIES.find((category) => category.names.some((item) => normalizeName(item) === value))
  if (exact) {
    return exact.name
  }

  return INGREDIENT_CATEGORIES.find((category) => category.keywords.some((word) => value.includes(word)))?.name ?? OTHER_CATEGORY
}

export const defaultStoreForCategory = (category: string): StoreKind =>
  INGREDIENT_CATEGORIES.find((item) => item.name === category)?.defaultStore ?? '全聯'

export const storeKindOf = (storeName: string): StoreKind | null => {
  const value = storeName.toLowerCase()
  if (value.includes('全聯')) {
    return '全聯'
  }
  if (value.includes('市場') || value.includes('菜市')) {
    return '菜市場'
  }
  if (value.includes('萬家福') || value.includes('家樂福') || value.includes('carrefour')) {
    return '萬家福'
  }
  if (value.includes('costco') || value.includes('好市多')) {
    return 'Costco'
  }
  return null
}

// ---------- Units ----------
const WEIGHT_UNITS: Record<string, number> = { g: 1, 克: 1, 公克: 1, kg: 1000, 公斤: 1000, 斤: 600, 台斤: 600, 兩: 37.5 }
const VOLUME_UNITS: Record<string, number> = { ml: 1, cc: 1, 毫升: 1, l: 1000, 公升: 1000 }
const COUNT_ALIASES: Record<string, string> = { 個: '顆', 粒: '顆', 顆: '顆', 根: '條', 支: '條', 條: '條', 入: '顆' }

type Measure = { dimension: string; value: number }

export const toMeasure = (qty: number, rawUnit: string): Measure | null => {
  const unit = rawUnit.trim().toLowerCase()
  if (!Number.isFinite(qty) || qty <= 0) {
    return null
  }
  if (WEIGHT_UNITS[unit]) {
    return { dimension: 'weight', value: qty * WEIGHT_UNITS[unit] }
  }
  if (VOLUME_UNITS[unit]) {
    return { dimension: 'volume', value: qty * VOLUME_UNITS[unit] }
  }
  if (!unit) {
    return null
  }
  return { dimension: `count:${COUNT_ALIASES[unit] ?? unit}`, value: qty }
}

export type Estimate = {
  cost: number
  packs: number
  entry: PriceEntry
}

// Expected cost of buying `needQty needUnit` using this price entry, or null when units don't line up.
export const estimateWithEntry = (needQty: number, needUnit: string, entry: PriceEntry): Estimate | null => {
  const price = Number(entry.price)
  const need = toMeasure(needQty, needUnit)
  const pack = toMeasure(Number(entry.packQty) || 1, entry.packUnit)
  if (!need || !pack || !Number.isFinite(price) || price <= 0 || need.dimension !== pack.dimension) {
    return null
  }

  const ratio = need.value / pack.value
  const packs = entry.loose ? ratio : Math.max(1, Math.ceil(ratio - 1e-9))
  return { cost: Math.round(packs * price), packs, entry }
}

export const findPriceEntries = (ingredient: string, priceBook: PriceEntry[]): PriceEntry[] => {
  const name = normalizeName(ingredient)
  if (!name) {
    return []
  }

  const exact = priceBook.filter((entry) => normalizeName(entry.ingredient) === name)
  if (exact.length > 0) {
    return exact
  }

  // "牛番茄" can use a "番茄" price and vice versa; ignore single characters like "鹽" inside "胡椒鹽".
  return priceBook.filter((entry) => {
    const entryName = normalizeName(entry.ingredient)
    return entryName.length >= 2 && (name.includes(entryName) || entryName.includes(name))
  })
}

export type Suggestion = {
  store: string
  estimate: Estimate | null
  references: PriceEntry[]
  reason: 'price' | 'reference' | 'category'
}

export const suggestPurchase = (
  ingredient: string,
  needQty: number,
  needUnit: string,
  priceBook: PriceEntry[],
): Suggestion => {
  const references = findPriceEntries(ingredient, priceBook)
  const estimates = references
    .map((entry) => estimateWithEntry(needQty, needUnit, entry))
    .filter((estimate): estimate is Estimate => Boolean(estimate))
    .sort((a, b) => a.cost - b.cost)

  if (estimates.length > 0) {
    return { store: estimates[0].entry.store, estimate: estimates[0], references, reason: 'price' }
  }

  if (references.length > 0) {
    return { store: references[0].store, estimate: null, references, reason: 'reference' }
  }

  return { store: defaultStoreForCategory(categorizeIngredient(ingredient)), estimate: null, references, reason: 'category' }
}

export const formatPack = (entry: PriceEntry): string =>
  `${entry.packQty && entry.packQty !== '1' ? entry.packQty : ''}${entry.packUnit}`

export const formatMoney = (value: number): string => {
  const rounded = Math.round(value)
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString('zh-TW')}`
}

// Fixed ids for stores created by kind, so concurrent "assign all" from two admins merges into one store.
export const STORE_KIND_IDS: Record<StoreKind, number> = { 菜市場: 9_000_001, 全聯: 9_000_002, Costco: 9_000_003, 萬家福: 9_000_004 }

// ---------- Spending ----------
export type StoreItemLike = { id: number; ingredient: string; price: string; purchased?: boolean }
export type StoreLike<Item extends StoreItemLike = StoreItemLike> = { id: number; items: Item[]; receiptTotal?: string }

export const toMoney = (value: string | undefined): number => {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

export type StoreStats = {
  total: number
  purchased: number
  unpriced: number
  itemSum: number
  estimated: number
  spent: number
}

// Spending is the receipt total when one is entered, otherwise the sum of item prices.
export const computeStoreStats = <Item extends StoreItemLike>(
  store: StoreLike<Item>,
  estimateOf: (item: Item) => number,
): StoreStats => {
  const items = store.items.filter((item) => item.ingredient.trim())
  const itemSum = items.reduce((sum, item) => sum + toMoney(item.price), 0)
  const receipt = toMoney(store.receiptTotal)

  return {
    total: items.length,
    purchased: items.filter((item) => item.purchased).length,
    unpriced: items.filter((item) => !toMoney(item.price)).length,
    itemSum,
    estimated: items.reduce((sum, item) => sum + estimateOf(item), 0),
    spent: receipt > 0 ? receipt : itemSum,
  }
}

export type GroupShare = { groupId: string; qty: number }
export type GroupSpending = { actual: number; estimated: number }

// Splits spending over groups by how much of each ingredient they asked for.
// - With a receipt total: the receipt is split over the store's items by their price
//   (or estimate when no price was entered), so the groups' shares add up to the receipt exactly.
// - Without one: each item's price is split; unpriced items contribute their estimate separately.
// Amounts that cannot be attributed to any group (item no longer requested) are returned as unallocated.
export const allocateGroupSpending = <Item extends StoreItemLike>(
  stores: StoreLike<Item>[],
  sharesOf: (item: Item) => GroupShare[],
  estimateOf: (item: Item, store: StoreLike<Item>) => number,
): { byGroup: Map<string, GroupSpending>; unallocated: GroupSpending } => {
  const byGroup = new Map<string, GroupSpending>()
  const unallocated: GroupSpending = { actual: 0, estimated: 0 }

  const add = (item: Item, actual: number, estimated: number) => {
    const shares = sharesOf(item).filter((share) => share.qty > 0)
    const totalQty = shares.reduce((sum, share) => sum + share.qty, 0)
    if (totalQty === 0) {
      unallocated.actual += actual
      unallocated.estimated += estimated
      return
    }
    shares.forEach((share) => {
      const entry = byGroup.get(share.groupId) ?? { actual: 0, estimated: 0 }
      entry.actual += (actual * share.qty) / totalQty
      entry.estimated += (estimated * share.qty) / totalQty
      byGroup.set(share.groupId, entry)
    })
  }

  stores.forEach((store) => {
    const items = store.items.filter((item) => item.ingredient.trim())
    const receipt = toMoney(store.receiptTotal)

    if (receipt > 0) {
      const weights = items.map((item) => toMoney(item.price) || estimateOf(item, store))
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
      items.forEach((item, index) => {
        const share = weightSum > 0 ? weights[index] / weightSum : 1 / items.length
        add(item, receipt * share, 0)
      })
      if (items.length === 0) {
        unallocated.actual += receipt
      }
      return
    }

    items.forEach((item) => {
      const price = toMoney(item.price)
      add(item, price, price > 0 ? 0 : estimateOf(item, store))
    })
  })

  return { byGroup, unallocated }
}

// An ingredient belongs to one store. When copies exist (two admins assigning at the same moment),
// keep the one with the most progress: purchased, then priced, then the first one.
export const dedupeStoreItems = <Item extends StoreItemLike, Store extends StoreLike<Item>>(
  stores: Store[],
  keyOf: (name: string) => string,
): Store[] => {
  const rank = (item: Item) => (item.purchased ? 2 : 0) + (toMoney(item.price) ? 1 : 0)
  const best = new Map<string, Item>()

  stores.forEach((store) =>
    store.items.forEach((item) => {
      const key = keyOf(item.ingredient)
      if (!key) {
        return
      }
      const current = best.get(key)
      if (!current || rank(item) > rank(current)) {
        best.set(key, item)
      }
    }),
  )

  return stores.map((store) => ({
    ...store,
    items: store.items.filter((item) => {
      const key = keyOf(item.ingredient)
      return !key || best.get(key) === item
    }),
  }))
}
