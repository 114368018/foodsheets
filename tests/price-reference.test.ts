import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRICE_SEED_BATCHES } from '../src/price-reference.ts'
import { isProductUrl } from '../api/_price-sources.ts'

test('replacing batches only point at existing starting entries of the same ingredient and store', () => {
  const base = new Map(PRICE_SEED_BATCHES[0].entries.map((entry) => [entry.id, entry]))
  PRICE_SEED_BATCHES.filter((batch) => batch.replaces).forEach((batch) => {
    batch.entries.forEach((entry) => {
      const original = base.get(entry.id)
      assert.ok(original, `${batch.id}: ${entry.ingredient} has no starting entry`)
      assert.equal(original.ingredient, entry.ingredient)
      assert.equal(original.store, entry.store)
    })
  })
})

test('adding batches never reuse an id', () => {
  const ids = PRICE_SEED_BATCHES.filter((batch) => !batch.replaces).flatMap((batch) => batch.entries.map((entry) => entry.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('every linked starting price can be fetched by the daily update', () => {
  PRICE_SEED_BATCHES.flatMap((batch) => batch.entries)
    .filter((entry) => entry.sourceUrl)
    .forEach((entry) => assert.ok(isProductUrl(entry.sourceUrl ?? ''), `${entry.ingredient}: ${entry.sourceUrl}`))
})
