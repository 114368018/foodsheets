import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translate } from '../src/i18n.ts'

test('English counts of one are singular', () => {
  assert.equal(translate('en', '{0} 項食材', [1]), '1 ingredient')
  assert.equal(translate('en', '{0} 項食材', [11]), '11 ingredients')
  assert.equal(translate('en', '{0} 項食材', [2]), '2 ingredients')
  assert.equal(translate('zh', '{0} 項食材', [1]), '1 項食材')
})
