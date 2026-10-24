import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateProduce,
  fromFirestoreValue,
  hasTradingData,
  isProductUrl,
  parseProductPrice,
  rocToIso,
  toFirestoreValue,
  toRocDate,
} from '../api/_price-sources.ts'

test('ROC dates', () => {
  assert.equal(toRocDate(new Date(2026, 9, 3)), '115.10.03')
  assert.equal(rocToIso('115.10.21'), '2026-10-21')
})

test('closed market days have no trading data', () => {
  assert.equal(hasTradingData([{ 作物名稱: '休市', 平均價: 0 }]), false)
  assert.equal(hasTradingData([{ 作物名稱: '甘藍-初秋', 平均價: 44, 交易量: 100 }]), true)
})

test('produce price is the volume-weighted wholesale average, converted to retail per 斤', () => {
  const rows = [
    { 作物名稱: '甘藍-初秋', 平均價: 40, 交易量: 300 },
    { 作物名稱: '甘藍-改良種', 平均價: 60, 交易量: 100 },
    { 作物名稱: '甘藍-紫色', 平均價: 200, 交易量: 100 },
    { 作物名稱: '甘薯-台農57號', 平均價: 30, 交易量: 10 },
    { 作物名稱: null, 平均價: 99, 交易量: 1 },
  ]
  const result = aggregateProduce(rows, { 高麗菜: ['甘藍-初秋', '甘藍-改良種'], 地瓜: ['甘薯-*'], 不存在: ['無'] })
  assert.deepEqual(result.map((item) => item.ingredient), ['高麗菜', '地瓜'])
  assert.equal(result[0].wholesalePerKg, 45)
  assert.equal(result[0].price, Math.round(45 * 0.6 * 1.6))
  assert.equal(result[1].wholesalePerKg, 30)
})

test('全聯 product pages: schema.org price', () => {
  const html = `<html><script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    <script type="application/ld+json">[{"@context":"https://schema.org/","@type":"Product","name":"雞蛋10入","offers":{"@type":"Offer","price":72,"availability":"https://schema.org/InStock"}}]</script></html>`
  assert.deepEqual(parseProductPrice(html), { price: 72, name: '雞蛋10入', inStock: true })
  assert.equal(parseProductPrice('<html>no data</html>'), null)
  assert.equal(parseProductPrice('<script type="application/ld+json">{broken</script>'), null)
})

test('only 全聯全電商 product URLs are fetched', () => {
  assert.equal(isProductUrl('https://pxbox.es.pxmart.com.tw/product/1074'), true)
  assert.equal(isProductUrl('http://pxbox.es.pxmart.com.tw/product/1074'), false)
  assert.equal(isProductUrl('https://example.com/product/1074'), false)
  assert.equal(isProductUrl('https://pxbox.es.pxmart.com.tw/search/result?keyword=蛋'), false)
  assert.equal(isProductUrl('not a url'), false)
})

test('Firestore REST values round-trip', () => {
  const value = { a: 1, b: 2.5, c: 'x', d: [true, null], e: { f: 'g' } }
  assert.deepEqual(fromFirestoreValue(toFirestoreValue(value)), value)
})

test('萬家福 product pages and URLs', () => {
  const html = `<script type="application/ld+json">{"@context":"http://schema.org/","@type":"Product","name":"可口可樂Zero 600ml","offers":{"@type":"Offer","priceCurrency":"TWD","price":"89","availability":"http://schema.org/InStock"}}</script>`
  assert.deepEqual(parseProductPrice(html), { price: 89, name: '可口可樂Zero 600ml', inStock: true })
  assert.equal(isProductUrl('https://online.uni-prosperity.com.tw/zh/cocacola-%E5%8F%AF%E5%8F%A3%E5%8F%AF%E6%A8%82/1000000100104.html'), true)
  assert.equal(isProductUrl('https://online.uni-prosperity.com.tw/zh/search?q=蛋'), false)
  assert.equal(isProductUrl('https://online.uni-prosperity.com.tw/on/demandware.store/x.html'), false)
})

test('全聯小時達 product URLs', () => {
  assert.equal(isProductUrl('https://shop.pxgo.com.tw/hourArrive/goods/246809-37010023-4710679240152'), true)
  assert.equal(isProductUrl('https://shop.pxgo.com.tw/hourArrive/search/result?q=蛋'), false)
  assert.equal(isProductUrl('https://shop.pxgo.com.tw/hourArrive/member/orders'), false)
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"阿薩姆茶葉蛋 350g","offers":{"@type":"Offer","availability":"https://schema.org/InStock","price":65,"priceCurrency":"TWD"}}</script>`
  assert.deepEqual(parseProductPrice(html), { price: 65, name: '阿薩姆茶葉蛋 350g', inStock: true })
})
