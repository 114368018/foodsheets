import { test } from 'node:test'
import assert from 'node:assert/strict'
import { threeWayMerge, deepEqual } from '../src/sync.ts'
import { parseIngredientText, parseIngredientLine, parseAmount, splitAmountInput } from '../src/ingredient-parse.ts'
import {
  BUILTIN_INGREDIENT_ALIASES,
  canonicalName,
  canonicalUnit,
  formatQuantity,
  suggestDuplicateNames,
} from '../src/name-normalize.ts'
import { nextId } from '../src/ids.ts'

test('sync: deletions are never undone by a stale copy', () => {
  const d = (id: number, title = '') => ({ id, title })
  const base = { dishes: [d(1, 'a'), d(2, 'b'), d(3, 'c')] }
  const local = { dishes: [d(1, 'a'), d(2, 'b')] }
  const staleRemote = { dishes: [d(1, 'A'), d(2, 'b'), d(3, 'c')] }
  assert.deepEqual(threeWayMerge(base, local, staleRemote).dishes, [d(1, 'A'), d(2, 'b')])
  assert.ok(deepEqual({ a: 1, b: undefined }, { a: 1 }))
})

test('sync: concurrent additions from both sides are kept', () => {
  const base = { stores: [{ id: 1, items: [] as { id: number }[] }] }
  const local = { stores: [{ id: 1, items: [{ id: 10 }] }] }
  const remote = { stores: [{ id: 1, items: [{ id: 20 }] }] }
  assert.deepEqual(threeWayMerge(base, local, remote).stores[0].items.map((item) => item.id).sort(), [10, 20])
})

test('parse: one line and pasted lists', () => {
  assert.deepEqual(parseIngredientLine('番茄 6顆'), { ingredient: '番茄', totalQty: '6', totalUnit: '顆', note: '' })
  assert.deepEqual(parseIngredientLine('高麗菜半顆'), { ingredient: '高麗菜', totalQty: '0.5', totalUnit: '顆', note: '' })
  assert.deepEqual(parseIngredientLine('三角油豆腐 2塊')?.ingredient, '三角油豆腐')
  assert.equal(parseIngredientLine('材料：'), null)
  assert.deepEqual(
    parseIngredientText('1. 雞蛋 6顆\n- 牛奶 x2 瓶、奶油1,000g').map((item) => [item.ingredient, item.totalQty, item.totalUnit]),
    [['雞蛋', '6', '顆'], ['牛奶', '2', '瓶'], ['奶油', '1000', 'g']],
  )
  assert.deepEqual(parseAmount('兩包'), { qty: '2', unit: '包' })
  const typed = splitAmountInput(' 2 顆')
  assert.equal(typed.qty + typed.unit, ' 2 顆', 'typing never changes the text')
})

test('names and units merge for summaries', () => {
  const name = (value: string) => canonicalName(value, {}, BUILTIN_INGREDIENT_ALIASES)
  assert.equal(name('蕃茄').key, name('番茄').key)
  assert.equal(name('西紅柿').display, '番茄')
  assert.equal(name('ＯＭＮＩＰＯＲＫ').display, 'OMNIPORK')
  assert.equal(canonicalName('蕃茄', { 番茄: '牛番茄' }, BUILTIN_INGREDIENT_ALIASES).display, '牛番茄', 'admin aliases chain')
  assert.equal(canonicalName('a', { a: 'b', b: 'a' }, {}).key.length > 0, true, 'alias loops terminate')
  assert.deepEqual(canonicalUnit('公斤'), { unit: 'g', factor: 1000, dimension: 'weight' })
  assert.deepEqual(canonicalUnit('CC'), { unit: 'ml', factor: 1, dimension: 'volume' })
  assert.deepEqual(canonicalUnit('pcs'), canonicalUnit('顆'))
  assert.deepEqual(canonicalUnit('Tablespoons'), canonicalUnit('大匙'))
  assert.equal(formatQuantity(1500, 'g'), '1.5 kg')
  assert.deepEqual(suggestDuplicateNames(['鴻喜菇', '鴻禧菇', '紅豆', '紅椒', '白醋', '黑醋'], new Set()), [['鴻喜菇', '鴻禧菇']])
})

test('ids stay unique within the same millisecond', () => {
  const ids = Array.from({ length: 5000 }, () => nextId())
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => Number.isSafeInteger(id)))
})
