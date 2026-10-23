// Usage: npm run i18n:check
// Lists UI text that has no English translation yet (exit code 1 if any).
// It collects: every t('…') key in src/App.tsx (both branches of a ?: too), status messages passed to
// setSyncStatus, and data names that are shown through t(variable): tabs, categories, store kinds,
// default group names.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const keys = new Set()
const CJK = /[㐀-鿿]/

const collectLiterals = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (CJK.test(node.text)) keys.add(node.text)
  } else if (ts.isConditionalExpression(node)) {
    collectLiterals(node.whenTrue)
    collectLiterals(node.whenFalse)
  } else if (ts.isBinaryExpression(node)) {
    collectLiterals(node.left)
    collectLiterals(node.right)
  } else if (ts.isParenthesizedExpression(node)) {
    collectLiterals(node.expression)
  }
}

const appPath = path.join(root, 'src/App.tsx')
const source = fs.readFileSync(appPath, 'utf8')
const sourceFile = ts.createSourceFile(appPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const visit = (node) => {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments[0]) {
    const name = node.expression.text
    if (name === 't' || name === 'setSyncStatus') collectLiterals(node.arguments[0])
    if (name === 'useState' && ts.isConditionalExpression(node.arguments[0])) collectLiterals(node.arguments[0])
  }
  ts.forEachChild(node, visit)
}
visit(sourceFile)

const shopping = fs.readFileSync(path.join(root, 'src/shopping.ts'), 'utf8')
for (const match of shopping.matchAll(/name: '([^']+)',\r?\n\s*defaultStore/g)) keys.add(match[1])
;['其他', '菜市場', '全聯', '萬家福', 'Costco'].forEach((key) => keys.add(key))
for (const match of source.matchAll(/const \w+_TAB = '([^']+)' as const/g)) keys.add(match[1])
;['食材總表', '工具總表', '範例組', '第一組', '第二組', '第三組', '第四組', '第五組', '第六組', '第七組', '學長姐組', '新商店', '未命名商店'].forEach(
  (key) => keys.add(key),
)

const englishText = fs.readFileSync(path.join(root, 'src/i18n-en.ts'), 'utf8')
const objectText = englishText.slice(englishText.indexOf('{', englishText.indexOf('EN')), englishText.lastIndexOf('}') + 1)
const english = new Set(Object.keys(Function(`return (${objectText})`)()))

const missing = [...keys].filter(Boolean).filter((key) => !english.has(key)).sort()
console.log(`i18n: ${keys.size} texts, ${missing.length} without English`)
missing.forEach((key) => console.log('  missing:', JSON.stringify(key)))
process.exitCode = missing.length > 0 ? 1 : 0
