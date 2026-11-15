// Turns free text like "番茄 6顆" or a pasted multi-line list into ingredient fields.

export type ParsedIngredient = {
  ingredient: string
  totalQty: string
  totalUnit: string
  note: string
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const AMOUNT_PATTERN = String.raw`(\d+(?:\.\d+)?(?:\/\d+)?|[半零一二兩三四五六七八九十]+)`

const toHalfWidth = (value: string): string =>
  value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/／/g, '/')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')

const chineseToNumber = (value: string): number | null => {
  if (value === '半') {
    return 0.5
  }

  if (value.includes('十')) {
    const [tensPart, onesPart] = value.split('十')
    const tens = tensPart ? CN_DIGITS[tensPart] : 1
    const ones = onesPart ? CN_DIGITS[onesPart] : 0
    return tens === undefined || ones === undefined ? null : tens * 10 + ones
  }

  return value.length === 1 && CN_DIGITS[value] !== undefined ? CN_DIGITS[value] : null
}

const normalizeQty = (raw: string): string | null => {
  if (/^\d/.test(raw)) {
    const fraction = raw.match(/^(\d+)\/(\d+)$/)
    if (fraction && Number(fraction[2]) !== 0) {
      return String(Math.round((Number(fraction[1]) / Number(fraction[2])) * 100) / 100)
    }
    return raw
  }

  const converted = chineseToNumber(raw)
  return converted === null ? null : String(converted)
}

// "6顆" / "x6 顆" / "兩包" / "1/2杯" -> { qty, unit }. Text without a number stays in unit.
export const parseAmount = (text: string): { qty: string; unit: string } => {
  const value = toHalfWidth(text).trim()
  const match = value.match(new RegExp(`^[x×*＊]?\\s*${AMOUNT_PATTERN}\\s*(.*)$`))
  const qty = match ? normalizeQty(match[1]) : null

  if (!match || qty === null) {
    return { qty: '', unit: value }
  }

  return { qty, unit: match[2].trim() }
}

// While typing into a combined amount field, split without changing the text
// (qty + unit always equals the input), so IME composition is never disturbed.
export const splitAmountInput = (text: string): { qty: string; unit: string } => {
  const match = text.match(/^(\s*[0-9０-９.．/／]*)([\s\S]*)$/)
  return match ? { qty: match[1], unit: match[2] } : { qty: '', unit: text }
}

const VAGUE_WORDS = '適量|少許|少量|些許|一點|一些|酌量|隨意'
const VAGUE_AMOUNT = new RegExp(`^(${VAGUE_WORDS})$`)

// What a row's amount is: a number ("6 顆"), words such as "適量", or nothing yet.
export type RowAmount = { kind: 'number' | 'vague' | 'none'; text: string }
export const rowAmount = (qty: string, unit: string): RowAmount => {
  const number = qty.trim()
  if (/^\d/.test(number)) {
    return { kind: 'number', text: `${number}${unit.trim()}` }
  }
  const words = number || unit.trim()
  return words ? { kind: 'vague', text: words } : { kind: 'none', text: '' }
}

// The number and unit to add up. "7-8朵" (stored as 7 and "-8朵") counts as 8 朵, so enough gets bought.
export const countedAmount = (qty: string, unit: string): { qty: string; unit: string } => {
  const range = unit.match(/^\s*[-~～–—至到]\s*(\d+(?:\.\d+)?)\s*(.*)$/)
  if (!range || !/^\d/.test(qty.trim())) {
    return { qty, unit }
  }
  return { qty: String(Math.max(Number(qty) || 0, Number(range[1]))), unit: range[2] }
}

// Something to point out about a typed amount, or '' when it looks fine.
// Seasonings: salt, sugar, sauces, spices, yeast and the like, in Chinese or English.
const SEASONING = /(鹽|糖|胡椒|椒粉|孜然|肉桂|香料|咖[哩喱]|味精|醬|醋|蜂蜜|酵母|香草)|salt|sugar|pepper|sauce|spice|powder|honey|vinegar|yeast/i
export const isSeasoning = (name: string): boolean => SEASONING.test(name)

// Milligrams are counted as written (1000 毫克 = 1 g). Seasonings can really be that little, so only
// other ingredients (butter, vegetables, beans…) get a "did you mean grams?" hint.
export const amountConcern = (qty: string, unit: string, ingredient = ''): 'no-unit' | 'milligram' | '' => {
  if (rowAmount(qty, unit).kind !== 'number') {
    return ''
  }
  const text = countedAmount(qty, unit).unit.trim().toLowerCase()
  if (!text) {
    return 'no-unit'
  }
  return /^(毫克|mg)/.test(text) && !isSeasoning(ingredient) ? 'milligram' : ''
}

export const parseIngredientLine = (line: string): ParsedIngredient | null => {
  const notes: string[] = []
  let text = toHalfWidth(line)
    // Bullets and list numbering: "- ", "• ", "1. ", "2、", "(3) "
    .replace(/^\s*(?:[-*•・●○▪]|\d+\s*[.)、]|[(（]\d+[)）])\s*/, '')
    .replace(/[(（]([^)）]*)[)）]/g, (_, inner: string) => {
      if (inner.trim()) {
        notes.push(inner.trim())
      }
      return ' '
    })
    .trim()

  if (!text || /[:：]$/.test(text)) {
    // Empty, or a section header such as "材料："
    return null
  }

  text = text.replace(/\s+/g, ' ')
  const match = text.match(new RegExp(`^(.+?)[\\s:：]*[x×*＊]?\\s*${AMOUNT_PATTERN}\\s*([^\\s\\d].*)?$`))
  const qty = match ? normalizeQty(match[2]) : null

  if (match && qty !== null) {
    return {
      ingredient: match[1].trim(),
      totalQty: qty,
      totalUnit: (match[3] ?? '').trim(),
      note: notes.join('、'),
    }
  }

  // "鹽 少許": the words are the amount.
  const vague = text.match(new RegExp(`^(.+?)\\s*(${VAGUE_WORDS})$`))
  if (vague && !VAGUE_AMOUNT.test(text)) {
    return { ingredient: vague[1].trim(), totalQty: '', totalUnit: vague[2], note: notes.join('、') }
  }

  return { ingredient: text.trim(), totalQty: '', totalUnit: '', note: notes.join('、') }
}

// Splits pasted text on new lines and list separators (but not on "1,000").
export const parseIngredientText = (text: string): ParsedIngredient[] =>
  text
    .split(/\r?\n|[、，；;]|,(?!\d)/)
    .map(parseIngredientLine)
    .filter((item): item is ParsedIngredient => Boolean(item && item.ingredient))

export const looksLikeIngredientList = (text: string): boolean => /\r?\n|[、，；;]|,(?!\d)/.test(text.trim())
