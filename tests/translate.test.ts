import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INGREDIENT_LIBRARY_SEED } from '../src/ingredient-library.ts'
import { TOOL_LIBRARY_SEED } from '../src/tool-library.ts'
import { BUILTIN_TOOL_ALIASES } from '../src/name-normalize.ts'
import {
  BUILTIN_ZH_EN,
  chineseToEnglish,
  cleanMachineTranslation,
  englishToChinese,
  isEnglishName,
  learnedKey,
  amountToEnglish,
  BUILTIN_TOOL_ZH_EN,
  toolEnglishToChinese,
  toolChineseToEnglish,
} from '../src/ingredient-translate.ts'

test('every library ingredient has a built-in English name', () => {
  const missing = INGREDIENT_LIBRARY_SEED.filter((name) => !BUILTIN_ZH_EN[name])
  assert.deepEqual(missing, [])
})

test('English names find their Chinese ingredient', () => {
  assert.equal(englishToChinese('Tomato', {}), '番茄')
  assert.equal(englishToChinese('tomatoes', {}), '番茄')
  assert.equal(englishToChinese('Fresh  Tomatoes', {}), '番茄')
  assert.equal(englishToChinese('Eggs', {}), '雞蛋')
  assert.equal(englishToChinese('heavy cream', {}), '鮮奶油')
  assert.equal(englishToChinese('Shiitake mushrooms', {}), '香菇')
  assert.equal(englishToChinese('cherries', {}), null)
  assert.equal(englishToChinese('dragonfruit', { 'en:dragonfruit': '火龍果' }), '火龍果', 'learned translations win')
})

test('Chinese names find their English name', () => {
  assert.equal(chineseToEnglish('番茄', {}), 'Tomato')
  assert.equal(chineseToEnglish('鴻喜菇', {}), 'Shimeji mushroom')
  assert.equal(chineseToEnglish('不知名菜', {}), null)
  assert.equal(chineseToEnglish('不知名菜', { 'zh:不知名菜': 'Mystery greens' }), 'Mystery greens')
})

test('language detection and learned keys', () => {
  assert.equal(isEnglishName('Tomato'), true)
  assert.equal(isEnglishName('番茄'), false)
  assert.equal(isEnglishName('Omnipork新豬肉'), false)
  assert.equal(learnedKey(' Tomato '), 'en:tomato')
  assert.equal(learnedKey('番 茄'), 'zh:番茄')
})

test('machine translation results are cleaned or rejected', () => {
  assert.equal(cleanMachineTranslation('番茄', 'Tomatoes.', true), 'Tomatoes')
  assert.equal(cleanMachineTranslation('番茄', '番茄', true), null)
  assert.equal(cleanMachineTranslation('mushroom', '蘑菇', false), '蘑菇')
  assert.equal(cleanMachineTranslation('mushroom', 'mushroom', false), null)
  assert.equal(cleanMachineTranslation('x', 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS', true), null)
})

test('one-word spellings and names typed in English', () => {
  assert.equal(englishToChinese('Dragonfruit', {}), '火龍果')
  assert.equal(englishToChinese('Bellpeppers', {}), englishToChinese('bell pepper', {}))
  assert.equal(chineseToEnglish('奇異果乾', { 'en:dried kiwi': '奇異果乾' }), 'Dried kiwi')
})

test('amounts in English', () => {
  assert.equal(amountToEnglish('3顆'), '3 pcs')
  assert.equal(amountToEnglish('1.5 公斤 + 300 克'), '1.5 kg + 300 g')
  assert.equal(amountToEnglish('2 大匙'), '2 tbsp')
  assert.equal(amountToEnglish('適量'), 'as needed')
  assert.equal(amountToEnglish('200 ml'), '200 ml')
})

test('every library tool has a built-in English name', () => {
  const missing = TOOL_LIBRARY_SEED.filter((name) => !BUILTIN_TOOL_ZH_EN[BUILTIN_TOOL_ALIASES[name] ?? name])
  assert.deepEqual(missing, [])
})

test('tools between English and Chinese', () => {
  assert.equal(toolEnglishToChinese('Frying pan', {}), '平底鍋')
  assert.equal(toolEnglishToChinese('Knives', {}), '菜刀')
  assert.equal(toolEnglishToChinese('large mixing bowls', {}), '大碗公')
  assert.equal(toolEnglishToChinese('Chopping boards', {}), '砧板')
  assert.equal(toolEnglishToChinese('Tomato', {}), null)
  assert.equal(toolChineseToEnglish('平底鍋', {}), 'Frying pan')
  assert.equal(toolChineseToEnglish('奇怪的鍋', { 'en:weird pot': '奇怪的鍋' }), 'Weird pot')
})

test('names put together from known parts', () => {
  assert.equal(toolChineseToEnglish('木鍋鏟', {}), 'Wooden turner')
  assert.equal(toolChineseToEnglish('中型碗', {}), 'Medium bowl')
  assert.equal(toolChineseToEnglish('紙碗', {}), 'Paper bowl')
  assert.equal(toolChineseToEnglish('瓷鍋', {}), 'Ceramic pot')
  assert.equal(toolChineseToEnglish('大型不鏽鋼盆', {}), 'Large stainless steel basin')
  assert.equal(toolChineseToEnglish('免洗筷', {}), 'Disposable chopsticks')
  assert.equal(chineseToEnglish('冷凍玉米粒', {}), `Frozen ${chineseToEnglish('玉米粒', {})?.toLowerCase()}`)
  assert.equal(chineseToEnglish('紅糖', {}), 'Brown sugar')
  assert.equal(chineseToEnglish('芒果汁', {}), 'Mango juice')
  assert.equal(chineseToEnglish('完全不認識', {}), null)
  // learned (admin-corrected) parts are used too
  assert.equal(toolChineseToEnglish('小怪鍋', { 'zh:怪鍋': 'Odd pot' }), 'Small odd pot')
})
