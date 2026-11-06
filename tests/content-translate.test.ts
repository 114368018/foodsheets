import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  machineChunks,
  phraseToEnglish,
  polishMachineEnglish,
  textKey,
  translateChineseRuns,
  translateLine,
  translateText,
  untranslatedLines,
} from '../src/content-translate.ts'
import { PRICE_SEED_BATCHES } from '../src/price-reference.ts'
import { CHANGELOG_ENTRIES } from '../src/changelog.ts'
import { CHANGELOG_EN } from '../src/changelog-en.ts'

test('steps translate line by line and keep their line breaks', () => {
  const steps = '番茄洗淨，切成小丁。\n\n盛起備用。'
  assert.equal(translateText(steps, {}), 'Wash the tomatoes and cut them into small cubes.\n\nRemove and set aside.')
})

test('saved translations come first, and unknown lines wait for the machine', () => {
  assert.equal(translateLine('盛起備用。', { [textKey('盛起備用。')]: 'Set aside.' }), 'Set aside.')
  assert.equal(translateLine('把麵團揉到光滑', {}), null)
  assert.deepEqual(untranslatedLines('盛起備用。\n把麵團揉到光滑\nAdd salt', {}), ['把麵團揉到光滑'])
  assert.equal(translateText('把麵團揉到光滑', {}), '把麵團揉到光滑')
})

test('short phrases', () => {
  assert.equal(phraseToEnglish('約 2.5 顆'), 'about 2.5 pcs')
  assert.equal(phraseToEnglish('適量'), 'as needed')
  assert.equal(phraseToEnglish('室溫'), 'room temperature')
  assert.equal(phraseToEnglish('歐洲(義式)'), 'European (Italian)')
  assert.equal(phraseToEnglish('台式、日式'), 'Taiwanese, Japanese')
  assert.equal(phraseToEnglish('泰式&韓式'), 'Thai & Korean')
  assert.equal(phraseToEnglish('把麵團揉到光滑'), null)
})

test('every starting price note reads in English', () => {
  const missing = PRICE_SEED_BATCHES.flatMap((batch) => batch.entries)
    .map((entry) => entry.spec)
    .filter((spec) => spec && phraseToEnglish(spec) === null)
  assert.deepEqual(Array.from(new Set(missing)), [])
})

test('leftover Chinese in an amount uses saved translations', () => {
  assert.equal(translateChineseRuns('3 盆', { [textKey('盆')]: 'basins' }), '3 basins')
  assert.equal(translateChineseRuns('3 盆', {}), '3 盆')
})

test('long lines are split for the translation service without losing text', () => {
  const line = '第一句話很長。'.repeat(40)
  const chunks = machineChunks(line)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.length <= 150))
  assert.equal(chunks.join(''), line)
  assert.deepEqual(machineChunks('短句。'), ['短句。'])
})

test('machine results are cleaned or rejected', () => {
  assert.equal(polishMachineEnglish('打蛋白霜用', 'For protein cream'), 'For meringue')
  assert.equal(polishMachineEnglish('把香蕉壓成泥', 'Press the banana into mud'), 'Press the banana into a purée')
  assert.equal(polishMachineEnglish('x', 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS'), null)
  assert.equal(polishMachineEnglish('番茄', '番茄'), null)
  assert.equal(polishMachineEnglish('番茄', ''), null)
})

test('text keys are stable and safe as map keys', () => {
  assert.equal(textKey('盛起備用。'), textKey('盛起備用。'))
  assert.notEqual(textKey('盛起備用。'), textKey('盛起備用'))
  assert.match(textKey('a/b.c\n'), /^t[a-z0-9]+$/)
})

test('the English changelog matches the Chinese one entry by entry', () => {
  CHANGELOG_ENTRIES.forEach((entry) => {
    assert.equal(CHANGELOG_EN[entry.version]?.length, entry.changes.length, entry.version)
  })
})
