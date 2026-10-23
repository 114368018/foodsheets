// Makes differently written names and units add up: 蕃茄 = 番茄, 克 = g, 1 公斤 = 1000 g.
// Only used for summaries; what each group typed is never changed.

const CHAR_VARIANTS: Record<string, string> = {
  蕃: '番',
  鷄: '雞',
  麪: '麵',
  臺: '台',
  菓: '果',
  荳: '豆',
}

// Keys and values are in normalized form (see normalizeNameText).
export const BUILTIN_INGREDIENT_ALIASES: Record<string, string> = {
  西紅柿: '番茄',
  洋芋: '馬鈴薯',
  番薯: '地瓜',
  甘藷: '地瓜',
  甘藍: '高麗菜',
  包心菜: '高麗菜',
  捲心菜: '高麗菜',
  胡蘿蔔: '紅蘿蔔',
  蛋: '雞蛋',
  全蛋: '雞蛋',
  起士: '起司',
  芝士: '起司',
  起士片: '起司片',
  芝士片: '起司片',
  乳酪片: '起司片',
  起士絲: '起司絲',
  芝士絲: '起司絲',
  乳酪絲: '起司絲',
  披薩起司: '起司絲',
  牛乳: '牛奶',
  鮮乳: '牛奶',
  鮮奶: '牛奶',
  黃油: '奶油',
  牛油: '奶油',
  淡奶油: '鮮奶油',
  動物性鮮奶油: '鮮奶油',
  白糖: '砂糖',
  白砂糖: '砂糖',
  精鹽: '鹽',
  食鹽: '鹽',
  海鹽: '鹽',
  沙拉油: '食用油',
  植物油: '食用油',
  油: '食用油',
  玉米澱粉: '玉米粉',
  馬鈴薯澱粉: '太白粉',
  鴻禧菇: '鴻喜菇',
  杏包菇: '杏鮑菇',
  彩椒: '甜椒',
  老豆腐: '板豆腐',
  傳統豆腐: '板豆腐',
  絹豆腐: '嫩豆腐',
  豆乾: '豆干',
  豆腐乾: '豆干',
  吐司: '白吐司',
  義大利麵: '義大利麵條',
  米: '白米',
  蓬萊米: '白米',
  開水: '水',
  飲用水: '水',
}

export const BUILTIN_TOOL_ALIASES: Record<string, string> = {
  煎匙: '鍋鏟',
  平底煎鍋: '平底鍋',
  煎鍋: '平底鍋',
  切菜板: '砧板',
  菜板: '砧板',
  刀: '菜刀',
  刀子: '菜刀',
  打蛋棒: '打蛋器',
  電子磅秤: '電子秤',
  磅秤: '電子秤',
  鋁箔: '鋁箔紙',
  烤盤紙: '烘焙紙',
  廚房紙: '廚房紙巾',
  紙巾: '廚房紙巾',
  卡式瓦斯爐: '卡式爐',
}

// Readable form: half-width, variant characters unified, no stray spaces, case kept.
export const cleanDisplayName = (name: string): string =>
  name
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/./g, (char) => CHAR_VARIANTS[char] ?? char)

// Grouping key: the readable form, lowercased.
export const normalizeNameText = (name: string): string => cleanDisplayName(name).toLowerCase()

export type CanonicalName = {
  key: string
  display: string
}

// Admin aliases first (they can override the built-in ones), then built-ins; follows short chains.
export const canonicalName = (
  name: string,
  adminAliases: Record<string, string>,
  builtinAliases: Record<string, string>,
): CanonicalName => {
  let display = cleanDisplayName(name)
  let key = display.toLowerCase()
  const seen = new Set<string>()

  while (key && !seen.has(key)) {
    seen.add(key)
    const next = adminAliases[key] ?? builtinAliases[key]
    if (!next) {
      break
    }
    display = cleanDisplayName(next)
    key = display.toLowerCase()
  }

  return { key, display }
}

export type UnitInfo = {
  unit: string
  factor: number
  dimension: 'weight' | 'volume' | 'count' | 'none'
}

const UNIT_TABLE: Array<[string[], string, number, UnitInfo['dimension']]> = [
  [['g', 'gram', 'grams', 'gm', '克', '公克'], 'g', 1, 'weight'],
  [['kg', 'kgs', 'kilogram', 'kilograms', '公斤', '千克'], 'g', 1000, 'weight'],
  [['斤', '台斤'], 'g', 600, 'weight'],
  [['兩'], 'g', 37.5, 'weight'],
  [['ml', 'cc', 'c.c.', 'milliliter', 'milliliters', 'millilitre', 'millilitres', '毫升', '西西'], 'ml', 1, 'volume'],
  [['l', 'liter', 'liters', 'litre', 'litres', '公升', '升'], 'ml', 1000, 'volume'],
  [['大匙', '湯匙', 'tbsp', 'tablespoon', 'tablespoons'], 'ml', 15, 'volume'],
  [['小匙', '茶匙', 'tsp', 'teaspoon', 'teaspoons'], 'ml', 5, 'volume'],
  [['顆', '個', '粒', '入', 'pc', 'pcs', 'piece', 'pieces', 'ea', 'each'], '顆', 1, 'count'],
  [['條', '根'], '條', 1, 'count'],
  [['包', '袋', 'pack', 'packs', 'bag', 'bags'], '包', 1, 'count'],
  [['片', 'slice', 'slices', 'sheet', 'sheets'], '片', 1, 'count'],
  [['盒', 'box', 'boxes', 'carton', 'cartons'], '盒', 1, 'count'],
  [['瓶', 'bottle', 'bottles'], '瓶', 1, 'count'],
  [['罐', 'can', 'cans', 'jar', 'jars'], '罐', 1, 'count'],
  [['塊', 'block', 'blocks'], '塊', 1, 'count'],
  [['把', '束', 'bunch', 'bunches'], '把', 1, 'count'],
]

const UNIT_LOOKUP = new Map(
  UNIT_TABLE.flatMap(([aliases, unit, factor, dimension]) =>
    aliases.map((alias) => [alias.toLowerCase(), { unit, factor, dimension }] as const),
  ),
)

export const canonicalUnit = (rawUnit: string): UnitInfo => {
  const unit = normalizeNameText(rawUnit)
  if (!unit) {
    return { unit: '', factor: 1, dimension: 'none' }
  }
  return UNIT_LOOKUP.get(unit) ?? { unit, factor: 1, dimension: 'count' }
}

// 1500 g -> "1.5 kg", 2000 ml -> "2 L"; everything else as is.
export const formatQuantity = (value: number, unit: string): string => {
  const rounded = (amount: number) => String(Math.round(amount * 100) / 100)
  if (unit === 'g' && value >= 1000) {
    return `${rounded(value / 1000)} kg`
  }
  if (unit === 'ml' && value >= 1000) {
    return `${rounded(value / 1000)} L`
  }
  return `${rounded(value)}${unit ? ` ${unit}` : ''}`
}

// Characters that usually make two otherwise identical names different products (紅豆／綠豆, 白醋／黑醋).
const DISTINGUISHING_CHARS = new Set(
  '紅白黑綠青黃紫橙大小嫩板乾鮮冰熱中低高細粗牛雞豬羊魚素甜酸辣鹹苦香生熟老新粉片絲丁塊條粒醬油汁膏糖鹽'.split(''),
)

// Characters people commonly swap when typing the same thing (same sound or old/new form).
const CONFUSABLE_PAIRS = new Set(
  ['喜禧', '司士', '砂沙', '乾干', '包鮑', '菇姑', '蘑磨', '薑姜', '麵面', '芝之', '粿果', '餃饺', '捲卷', '蔥葱', '咖喀', '喱哩', '吐土', '司絲']
    .map((pair) => Array.from(pair).sort().join('')),
)

export const pairKey = (a: string, b: string) => [a, b].sort().join('|')

const isLikelySameName = (a: string[], b: string[]): boolean => {
  const diffs = a.map((char, index) => [char, b[index]]).filter(([x, y]) => x !== y)
  if (diffs.length !== 1) {
    return false
  }

  const [x, y] = diffs[0]
  if (CONFUSABLE_PAIRS.has([x, y].sort().join(''))) {
    return true
  }
  // Longer names differing in one ordinary character are usually typos (鴻喜菇／鴻禧菇).
  return a.length >= 4 && !DISTINGUISHING_CHARS.has(x) && !DISTINGUISHING_CHARS.has(y)
}

// Pairs of names that are probably the same thing typed differently, for an admin to confirm.
export const suggestDuplicateNames = (names: string[], dismissed: Set<string>): Array<[string, string]> => {
  const unique = Array.from(new Set(names.filter(Boolean)))
  const pairs: Array<[string, string]> = []

  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const a = Array.from(unique[i])
      const b = Array.from(unique[j])
      if (a.length !== b.length || a.length < 2 || dismissed.has(pairKey(unique[i], unique[j]))) {
        continue
      }

      if (isLikelySameName(a, b)) {
        pairs.push([unique[i], unique[j]])
      }
    }
  }

  return pairs
}
