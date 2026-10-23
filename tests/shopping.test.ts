import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allocateGroupSpending,
  categorizeIngredient,
  computeStoreStats,
  dedupeStoreItems,
  estimateWithEntry,
  storeKindOf,
  suggestPurchase,
  toMeasure,
  type PriceEntry,
} from '../src/shopping.ts'

const entry = (fields: Partial<PriceEntry>): PriceEntry => ({
  id: 1,
  ingredient: '雞蛋',
  store: '全聯',
  price: '70',
  packQty: '10',
  packUnit: '顆',
  spec: '',
  ...fields,
})

test('units convert to a shared base', () => {
  assert.deepEqual(toMeasure(1, 'kg'), { dimension: 'weight', value: 1000 })
  assert.deepEqual(toMeasure(1, '斤'), { dimension: 'weight', value: 600 })
  assert.deepEqual(toMeasure(2, 'L'), { dimension: 'volume', value: 2000 })
  assert.deepEqual(toMeasure(3, '個'), { dimension: 'count:顆', value: 3 })
  assert.equal(toMeasure(0, 'g'), null)
  assert.equal(toMeasure(2, ''), null)
})

test('estimates round up to whole packs, loose items are proportional', () => {
  assert.equal(estimateWithEntry(8, '顆', entry({}))?.cost, 70)
  assert.equal(estimateWithEntry(11, '顆', entry({}))?.cost, 140)
  assert.equal(estimateWithEntry(10, '顆', entry({}))?.packs, 1)
  assert.equal(estimateWithEntry(900, 'g', entry({ price: '30', packQty: '1', packUnit: '斤', loose: true }))?.cost, 45)
  assert.equal(estimateWithEntry(5, 'g', entry({})), null, 'different dimensions cannot be estimated')
  assert.equal(estimateWithEntry(5, '顆', entry({ price: '' })), null, 'missing price')
})

test('suggestion picks the cheapest store for the needed amount', () => {
  const book = [
    entry({ id: 1, store: '全聯', price: '135', packQty: '227', packUnit: 'g', ingredient: '奶油' }),
    entry({ id: 2, store: 'Costco', price: '549', packQty: '1812', packUnit: 'g', ingredient: '奶油' }),
  ]
  assert.equal(suggestPurchase('奶油', 100, 'g', book).store, '全聯')
  assert.equal(suggestPurchase('奶油', 2000, 'g', book).store, 'Costco')
  assert.equal(suggestPurchase('馬斯卡彭', 1, '盒', book).reason, 'category')
})

test('categories and store kinds', () => {
  assert.equal(categorizeIngredient('高麗菜'), '蔬菜')
  assert.equal(categorizeIngredient('番茄醬'), '醬料・調味')
  assert.equal(categorizeIngredient('哈密瓜'), '水果')
  assert.equal(categorizeIngredient('玄米油'), '油品・飲品')
  assert.equal(storeKindOf('全聯 民生店'), '全聯')
  assert.equal(storeKindOf('Costco好市多'), 'Costco')
  assert.equal(storeKindOf('傳統市場'), '菜市場')
  assert.equal(storeKindOf('雜貨店'), null)
})

type Item = { id: number; ingredient: string; price: string; purchased?: boolean }

test('store stats use the receipt total when given', () => {
  const store = { id: 1, items: [{ id: 1, ingredient: 'A', price: '100', purchased: true }, { id: 2, ingredient: 'B', price: '' }, { id: 3, ingredient: '', price: '50' }] }
  const stats = computeStoreStats<Item>(store, () => 30)
  assert.deepEqual(stats, { total: 2, purchased: 1, unpriced: 1, itemSum: 100, estimated: 60, spent: 100 })
  assert.equal(computeStoreStats<Item>({ ...store, receiptTotal: '180' }, () => 0).spent, 180)
  assert.equal(computeStoreStats<Item>({ ...store, receiptTotal: 'abc' }, () => 0).spent, 100, 'invalid receipt is ignored')
})

test('group allocation always adds up to what was spent', () => {
  const shares: Record<string, { groupId: string; qty: number }[]> = {
    egg: [{ groupId: 'g1', qty: 6 }, { groupId: 'g2', qty: 4 }],
    milk: [{ groupId: 'g2', qty: 1 }],
    orphan: [],
  }
  const stores = [
    { id: 1, items: [{ id: 1, ingredient: 'egg', price: '100' }, { id: 2, ingredient: 'milk', price: '' }] },
    { id: 2, receiptTotal: '300', items: [{ id: 3, ingredient: 'egg', price: '200' }, { id: 4, ingredient: 'milk', price: '' }] },
    { id: 3, items: [{ id: 5, ingredient: 'orphan', price: '40' }] },
  ]
  const estimate = () => 50
  const { byGroup, unallocated } = allocateGroupSpending<Item>(stores, (item) => shares[item.ingredient] ?? [], estimate)
  const g1 = byGroup.get('g1')!
  const g2 = byGroup.get('g2')!
  const spent = stores.reduce((sum, store) => sum + computeStoreStats<Item>(store, estimate).spent, 0)

  // Store 1: egg 100 split 60/40, milk unpriced -> estimate 50 to g2.
  // Store 2: receipt 300 split by weights egg 200 / milk 50 -> 240 egg (144/96), 60 milk (g2).
  assert.equal(Math.round(g1.actual), 60 + 144)
  assert.equal(Math.round(g2.actual), 40 + 96 + 60)
  assert.equal(Math.round(g2.estimated), 50)
  assert.equal(g1.estimated, 0)
  assert.equal(unallocated.actual, 40, 'an item nobody requested is reported, not dropped')
  assert.equal(Math.round(g1.actual + g2.actual + unallocated.actual), spent)
})

test('receipt with no priced items splits evenly by estimate weight', () => {
  const stores = [{ id: 1, receiptTotal: '90', items: [{ id: 1, ingredient: 'a', price: '' }, { id: 2, ingredient: 'b', price: '' }] }]
  const { byGroup } = allocateGroupSpending<Item>(stores, (item) => [{ groupId: item.ingredient, qty: 1 }], () => 0)
  assert.equal(byGroup.get('a')!.actual, 45)
  assert.equal(byGroup.get('b')!.actual, 45)
})

test('duplicate store items keep the one with the most progress', () => {
  const stores = [
    { id: 1, items: [{ id: 1, ingredient: '番茄', price: '' }, { id: 2, ingredient: '鹽', price: '' }] },
    { id: 2, items: [{ id: 3, ingredient: ' 番茄 ', price: '120', purchased: true }, { id: 4, ingredient: '', price: '' }] },
  ]
  const result = dedupeStoreItems<Item, (typeof stores)[number]>(stores, (name) => name.trim())
  assert.deepEqual(result[0].items.map((item) => item.id), [2])
  assert.deepEqual(result[1].items.map((item) => item.id), [3, 4], 'blank manual rows are left alone')
})

test('money formatting puts the sign before the dollar sign', async () => {
  const { formatMoney } = await import('../src/shopping.ts')
  assert.equal(formatMoney(-24), '-$24')
  assert.equal(formatMoney(1234.4), '$1,234')
  assert.equal(formatMoney(0), '$0')
})
