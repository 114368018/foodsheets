// Helpers for the "type one line, press Enter" item entry used by groups,
// plus unit normalization so the shopping list can merge quantities.

export type ItemDraft = {
  name: string
  qty: string
  unit: string
  note: string
}

export const VAGUE_QTY = '適量'

export const INGREDIENT_UNIT_CHIPS = ['顆', '個', 'g', '包', '瓶', '罐', '盒', 'ml', '把', '條', '片', '大匙']
export const TOOL_UNIT_CHIPS = ['個', '台', '組', '把', '支', '捲', '包', '張']
export const EXTRA_UNIT_OPTIONS = ['kg', 'L', '小匙', '杯', '塊', '根', '袋', '份', '瓣', '串', '朵', '粒', '隻', '碗', '斤']

const VAGUE_QTY_WORDS = ['適量', '少許', '少量', '些許', '一點點', '一點', '一些', '隨意', '酌量']

// Longest first so "公斤" wins over "斤" and "大匙" over "匙".
const KNOWN_UNITS = [
  '公克', '公斤', '台斤', '毫升', '公升', '大匙', '小匙', '茶匙', '湯匙',
  'kg', 'ml', 'cc', 'g', 'l', '克', '斤', '兩',
  '顆', '個', '包', '瓶', '罐', '盒', '把', '條', '片', '匙', '杯', '碗', '根', '支', '塊', '串',
  '粒', '朵', '隻', '份', '袋', '捆', '束', '瓣', '張', '盤', '組', '台', '捲', '打', '尾', '株',
].sort((a, b) => b.length - a.length)

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

const parseChineseNumber = (text: string): number | null => {
  if (text === '半') {
    return 0.5
  }

  let body = text
  let half = 0
  if (body.length > 1 && body.endsWith('半')) {
    half = 0.5
    body = body.slice(0, -1)
  }

  if (body.includes('十')) {
    const [tensText, onesText] = body.split('十')
    const tens = tensText ? CN_DIGITS[tensText] : 1
    const ones = onesText ? CN_DIGITS[onesText] : 0
    if (tens === undefined || ones === undefined) {
      return null
    }
    return tens * 10 + ones + half
  }

  if (body.length === 1 && CN_DIGITS[body] !== undefined) {
    return CN_DIGITS[body] + half
  }

  return null
}

export const formatQtyNumber = (value: number): string => {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** Parses "2", "1.5", "1/2", "2~3" (upper bound), "兩", "半" into a number. */
export const parseQuantity = (text: string): number | null => {
  const value = text.trim().replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
  if (!value) {
    return null
  }

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fraction && Number(fraction[2]) !== 0) {
    return Number(fraction[1]) / Number(fraction[2])
  }

  const range = value.match(/^(\d+(?:\.\d+)?)\s*[-~～到至]\s*(\d+(?:\.\d+)?)$/)
  if (range) {
    return Math.max(Number(range[1]), Number(range[2]))
  }

  return parseChineseNumber(value)
}

export const normalizeUnitText = (unit: string): string => {
  const trimmed = unit.trim()
  if (/^[a-zA-Z]+$/.test(trimmed)) {
    const lower = trimmed.toLowerCase()
    return lower === 'l' ? 'L' : lower
  }
  return trimmed
}

const UNIT_CONVERSIONS: Record<string, { base: string; factor: number }> = {
  g: { base: 'g', factor: 1 },
  克: { base: 'g', factor: 1 },
  公克: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  公斤: { base: 'g', factor: 1000 },
  斤: { base: 'g', factor: 600 },
  台斤: { base: 'g', factor: 600 },
  ml: { base: 'ml', factor: 1 },
  毫升: { base: 'ml', factor: 1 },
  cc: { base: 'ml', factor: 1 },
  L: { base: 'ml', factor: 1000 },
  公升: { base: 'ml', factor: 1000 },
  湯匙: { base: '大匙', factor: 1 },
  大匙: { base: '大匙', factor: 1 },
  茶匙: { base: '小匙', factor: 1 },
  小匙: { base: '小匙', factor: 1 },
}

/** Maps equivalent units onto one base unit (kg → g, 公升 → ml …) so totals can be summed. */
export const toBaseUnit = (unit: string): { base: string; factor: number } => {
  const normalized = normalizeUnitText(unit)
  return UNIT_CONVERSIONS[normalized] ?? { base: normalized, factor: 1 }
}

export const formatQuantity = (qty: number, baseUnit: string): string => {
  if (baseUnit === 'g' && qty >= 1000) {
    return `${formatQtyNumber(qty / 1000)} kg`
  }
  if (baseUnit === 'ml' && qty >= 1000) {
    return `${formatQtyNumber(qty / 1000)} L`
  }
  return `${formatQtyNumber(qty)}${baseUnit ? ` ${baseUnit}` : ''}`
}

const NUMBER_PATTERN = String.raw`\d+(?:\.\d+)?(?:\s*(?:\/|-|~|～)\s*\d+(?:\.\d+)?)?`
const CN_NUMBER_PATTERN = '[半一二兩三四五六七八九十]+半?'
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UNIT_PATTERN = KNOWN_UNITS.map(escapeRegExp).join('|')

const TRAILING_ARABIC = new RegExp(`^(.*?)\\s*[x×*]?\\s*(${NUMBER_PATTERN})\\s*([^\\d\\s]{0,4})(?:\\s+(.+))?$`, 'i')
const TRAILING_CHINESE = new RegExp(`^(.+?)(${CN_NUMBER_PATTERN})\\s*(${UNIT_PATTERN})$`, 'i')
const LEADING_QTY = new RegExp(`^(${NUMBER_PATTERN}|${CN_NUMBER_PATTERN})\\s*(${UNIT_PATTERN})?\\s+(.+)$`, 'i')

const normalizeQtyText = (raw: string): string => {
  const parsed = parseQuantity(raw)
  return parsed === null ? raw.trim() : formatQtyNumber(parsed)
}

/**
 * Turns free text such as「洋蔥 2顆」「麵粉500g」「蒜頭兩顆」「鹽 適量」「雞蛋 x6 (共用)」
 * into name / qty / unit / note. Library names containing parentheses are kept intact.
 */
export const parseItemLine = (raw: string, knownNames: string[] = []): ItemDraft | null => {
  let text = raw
    .replace(/\u3000/g, ' ')
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-*•·・]|\d+[.、)]\s)\s*/, '')

  if (!text) {
    return null
  }

  let protectedName = ''
  const nameWithParens = knownNames
    .filter((name) => /[()（）]/.test(name))
    .sort((a, b) => b.length - a.length)
    .find((name) => text.startsWith(name))
  if (nameWithParens) {
    protectedName = nameWithParens
    text = text.slice(nameWithParens.length).trim()
  }

  const notes: string[] = []
  const parenNote = text.match(/[（(]([^（）()]*)[)）]\s*$/)
  if (parenNote && parenNote.index !== undefined) {
    notes.push(parenNote[1].trim())
    text = text.slice(0, parenNote.index).trim()
  }

  const commaIndex = text.search(/[，,；;]/)
  if (commaIndex > 0) {
    notes.unshift(text.slice(commaIndex + 1).trim())
    text = text.slice(0, commaIndex).trim()
  }

  let name = text
  let qty = ''
  let unit = ''

  const vagueWord = VAGUE_QTY_WORDS.find((word) => name.endsWith(word))
  if (vagueWord) {
    qty = VAGUE_QTY
    name = name.slice(0, -vagueWord.length).trim()
  } else {
    const chinese = name.match(TRAILING_CHINESE)
    const arabic = name.match(TRAILING_ARABIC)
    const leading = name.match(LEADING_QTY)

    if (arabic && (arabic[1].trim() || protectedName)) {
      name = arabic[1].trim()
      qty = normalizeQtyText(arabic[2])
      unit = arabic[3]
      if (arabic[4]) {
        notes.unshift(arabic[4].trim())
      }
    } else if (chinese && chinese[1].trim()) {
      name = chinese[1].trim()
      qty = normalizeQtyText(chinese[2])
      unit = chinese[3]
    } else if (leading && !protectedName) {
      qty = normalizeQtyText(leading[1])
      unit = leading[2] ?? ''
      name = leading[3].trim()
    }
  }

  name = `${protectedName}${protectedName && name ? ' ' : ''}${name}`.trim()
  if (!name) {
    return null
  }

  return {
    name,
    qty,
    unit: normalizeUnitText(unit),
    note: notes.filter(Boolean).join('，'),
  }
}

const INGREDIENT_UNIT_HINTS: Record<string, string> = {
  雞蛋: '顆', 洋蔥: '顆', 蒜頭: '顆', 番茄: '顆', 牛番茄: '顆', 高麗菜: '顆', 大白菜: '顆',
  馬鈴薯: '顆', 蘋果: '顆', 青蘋果: '顆', 奇異果: '顆', 酪梨: '顆', 柳丁: '顆', 橘子: '顆', 檸檬: '顆',
  青椒: '顆', 甜椒: '顆', 黃椒: '顆', 紅椒: '顆', 鳳梨: '顆', 哈密瓜: '顆', 火龍果: '顆', 栗子南瓜: '顆',
  青蔥: '把', 九層塔: '把', 香菜: '把', 菠菜: '把', 青江菜: '把', 四季豆: '把',
  薑: '塊', 南薑: '塊', 黃薑: '塊',
  辣椒: '條', 大辣椒: '條', 紅蘿蔔: '條', 白蘿蔔: '條', 小黃瓜: '條', 茄子: '條', 地瓜: '條', 櫛瓜: '條',
  牛奶: '瓶', 豆漿: '瓶', 燕麥奶: '瓶', 無糖豆奶: '瓶',
  白吐司: '條', 法國麵包: '條',
  冰塊: '包', 水: 'ml',
}

const INGREDIENT_SUFFIX_HINTS: Array<[RegExp, string]> = [
  [/罐頭$/, '罐'],
  [/豆腐$/, '盒'],
  [/(菇|木耳)$/, '包'],
  [/(起司片|海苔片|米紙|起酥片)$/, '片'],
  [/(醬油|醬油膏|醬|油|醋|酒|汁|露)$/, '瓶'],
  [/(粉|糖|鹽|米|芝麻|花生|豆|餡)$/, 'g'],
  [/(麵|粉條|米粉|河粉|通心粉|年糕)$/, '包'],
]

const TOOL_SUFFIX_HINTS: Array<[RegExp, string]> = [
  [/(爐|機|箱|秤|電鍋|氣炸鍋|打蛋器)$/, '台'],
  [/(紙|紙巾)$/, '捲'],
  [/(刀|鏟|夾|剪|刮刀)$/, '把'],
  [/(匙|筷|槍|棍)$/, '支'],
]

/** Best-effort default unit for a name when nobody has used it before. */
export const guessUnit = (name: string, kind: 'ingredient' | 'tool'): string => {
  const trimmed = name.trim()
  if (!trimmed) {
    return ''
  }

  if (kind === 'tool') {
    return TOOL_SUFFIX_HINTS.find(([pattern]) => pattern.test(trimmed))?.[1] ?? '個'
  }

  if (INGREDIENT_UNIT_HINTS[trimmed]) {
    return INGREDIENT_UNIT_HINTS[trimmed]
  }

  return INGREDIENT_SUFFIX_HINTS.find(([pattern]) => pattern.test(trimmed))?.[1] ?? ''
}

export const normalizeNameKey = (name: string): string => name.trim().toLowerCase()
