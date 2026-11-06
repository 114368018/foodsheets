// Free text people typed (dish names, steps, notes, cuisine, price notes) in English mode.
// The stored data is never changed; this only decides what English to show. Order of preference:
// 1. saved translations (admin corrections and earlier machine results, shared with everyone)
// 2. translations written by hand for text the project already has
// 3. rules for short phrases: amounts, "室溫", brands, cuisines
// 4. otherwise the line goes to machine translation once (see polishMachineEnglish).
import { amountToEnglish } from './ingredient-translate.ts'

const CJK = /[㐀-鿿]/
const CJK_RUN = /[㐀-鿿]+/g

export const hasChinese = (text: string): boolean => CJK.test(text)

const BUILTIN_TEXT_EN: Record<string, string> = {
  // Dish names
  'L’Héritage Éternel(法式馬鈴薯千層)': 'L’Héritage Éternel (French potato gratin)',
  '日不落(蘇格蘭蛋)': 'The Sun Never Sets (Scotch eggs)',
  '維也納之夜(薩赫蛋糕)': 'A Night in Vienna (Sachertorte)',
  泰式奶茶20人份: 'Thai milk tea (20 servings)',
  韓式部隊鍋: 'Korean army stew (budae jjigae)',
  韓式煎餅: 'Korean savory pancake',
  台式香菇栗子素油飯: 'Taiwanese vegetarian sticky rice with shiitake and chestnuts',
  日式照燒豆腐佐時蔬: 'Japanese teriyaki tofu with seasonal vegetables',
  日式糰子: 'Japanese dango',
  部隊鍋: 'Army stew (budae jjigae)',
  義大利卡布里沙拉串: 'Italian caprese salad skewers',
  西班牙馬鈴薯烘蛋: 'Spanish potato omelette',
  義式番茄筆管麵: 'Italian tomato penne',
  // Cooking steps
  '【素高湯】取鍋放入所有食材，加水淹過食材，電鍋蒸一個小時即完成。也可以用玉米等甜味較濃的食材代替蘋果。':
    '[Vegetable stock] Put all the ingredients in a pot, add water to cover, and steam in the electric cooker for one hour. Sweeter ingredients such as corn can replace the apple.',
  '【部隊鍋】取鍋下素高湯、辣椒粉、韓式辣醬，拌開，再加入糖、鹽、醬油調味。':
    '[Army stew] In a pot, stir together the vegetable stock, chili powder and gochujang, then season with sugar, salt and soy sauce.',
  '【部隊鍋】放入焗豆、泡菜、豆腐、秀珍菇、年糕、泡麵、金針菇，再將素高湯加到淹過食材煮滾(素高湯:食材=1:1)。':
    '[Army stew] Add the baked beans, kimchi, tofu, oyster mushrooms, rice cakes, instant noodles and enoki mushrooms, then pour in vegetable stock to cover and bring to a boil (stock : ingredients = 1:1).',
  '【部隊鍋】放上起司片，點上香菜即完成。': '[Army stew] Top with cheese slices and a little cilantro. Done.',
  '將小番茄和羅勒葉洗淨，並用廚房紙巾擦乾。起司也要瀝乾，避免串好後盤底積水。':
    'Wash the cherry tomatoes and basil leaves and pat them dry with paper towels. Drain the cheese too, so water does not pool on the plate after skewering.',
  '使用短竹籤，依序串入：': 'Using short bamboo skewers, thread on in this order:',
  '小番茄 → 羅勒葉 → 莫札瑞拉起司。': 'Cherry tomato → basil leaf → mozzarella.',
  '羅勒葉可以稍微折疊，讓綠色葉片自然露出，視覺更漂亮。':
    'Fold the basil leaf slightly so the green shows naturally; it looks prettier.',
  '整齊排列在白色長盤或淺色餐盤上，淋上少量橄欖油，撒一點黑胡椒。巴薩米克醋膏可以細線點綴，增加顏色與酸甜風味。':
    'Line them up neatly on a long white or light-colored plate, drizzle with a little olive oil and sprinkle with black pepper. Add thin lines of balsamic glaze for color and a sweet-sour flavor.',
  '馬鈴薯去皮，切成大小一致的薄片或約 0.5–1 公分小丁。':
    'Peel the potatoes and cut them into even thin slices or small cubes of about 0.5–1 cm.',
  '杏鮑菇切成小丁。': 'Cut the king oyster mushrooms into small cubes.',
  '雞蛋打入大碗中，充分攪拌均勻。': 'Crack the eggs into a large bowl and beat until well combined.',
  '起司絲、鹽、黑胡椒先準備好。': 'Have the shredded cheese, salt and black pepper ready.',
  '加入少量橄欖油，以中小火煎炒。可以加少量水並蓋上鍋蓋燜煮，直到馬鈴薯熟軟。':
    'Add a little olive oil and fry over medium-low heat. You can add a little water and cover with a lid to steam until the potatoes are soft.',
  '外炒至熟透並收乾水分，避免烘蛋內部太濕、不容易凝固。':
    'Stir-fry separately until cooked through and the liquid has evaporated, so the omelette is not too wet inside and sets properly.',
  '雞蛋打散，加入起司、鹽、黑胡椒，再加入馬鈴薯和杏鮑菇，輕輕攪拌均勻。':
    'Beat the eggs, add the cheese, salt and black pepper, then add the potatoes and king oyster mushrooms and stir gently to combine.',
  '平底鍋薄薄抹油，倒入適量蛋液，輕晃鍋子讓表面平整。蓋上鍋蓋，以小火慢煎約 8–12 分鐘，再檢查底部是否定型。':
    'Lightly oil a frying pan, pour in some of the egg mixture and gently shake the pan to level the top. Cover with a lid and cook slowly over low heat for about 8–12 minutes, then check whether the bottom has set.',
  '時間會依烘蛋厚度、鍋具與爐火而變化，不要只依計時判斷熟度。':
    'The time depends on the thickness of the omelette, the pan and the burner, so do not judge doneness by the timer alone.',
  '將烘蛋先滑到大平盤上，再用盤子蓋住、翻轉，讓未熟的一面朝下滑回鍋中。繼續以小火煎至中心完全熟透。':
    'Slide the omelette onto a large flat plate, cover it with another plate and flip it, then slide it back into the pan with the uncooked side down. Keep cooking over low heat until the center is fully cooked.',
  '翻面時要使用比鍋子稍大的平盤，並小心熱油與蒸氣。':
    'When flipping, use a flat plate slightly larger than the pan and watch out for hot oil and steam.',
  '煎好後稍微放涼，確認中心熟透，再切成大小一致的方塊。若要做 20 人份，將各鍋成品合計切成 20 塊即可。':
    'Let it cool slightly, check that the center is cooked, then cut into even squares. For 20 servings, cut the omelettes from all the pans into 20 pieces in total.',
  '番茄洗淨，切成小丁。': 'Wash the tomatoes and cut them into small cubes.',
  '馬鈴薯去皮，切成約 1 公分小丁。': 'Peel the potatoes and cut them into cubes of about 1 cm.',
  '金針菇切除根部，洗淨後切成約 2–3 公分長。':
    'Trim the roots off the enoki mushrooms, wash them and cut into lengths of about 2–3 cm.',
  '鍋中加入部分油。': 'Add some of the oil to the pot.',
  '放入馬鈴薯丁，以中火翻炒。': 'Add the diced potatoes and stir-fry over medium heat.',
  '加少量水並蓋鍋燜煮，直到馬鈴薯熟透。': 'Add a little water, cover and simmer until the potatoes are cooked through.',
  '盛起備用。': 'Remove and set aside.',
  '鍋中加入剩餘的油，放入番茄丁。': 'Add the remaining oil to the pot, then the diced tomatoes.',
  '中火加熱，讓番茄慢慢出汁、軟化。': 'Heat over medium so the tomatoes slowly release their juice and soften.',
  '加入番茄醬，持續攪拌。': 'Add the ketchup and keep stirring.',
  '加入二砂糖，調整番茄酸味。': 'Add light brown sugar to balance the acidity of the tomatoes.',
  '轉中小火熬煮至醬汁濃稠。': 'Turn down to medium-low and simmer until the sauce thickens.',
  '將熟馬鈴薯加入番茄醬汁。': 'Add the cooked potatoes to the tomato sauce.',
  '加入金針菇與玉米粒。': 'Add the enoki mushrooms and corn kernels.',
  '加入部分玫瑰鹽。': 'Add some of the pink salt.',
  '繼續煮至金針菇熟透、醬汁風味融合。': 'Keep cooking until the enoki mushrooms are done and the flavors of the sauce come together.',
  '燒一鍋水 煮筆管麵': 'Boil a pot of water and cook the penne.',
  '將煮好的筆管麵加入醬裡': 'Add the cooked penne to the sauce.',
}

// Short phrases, replaced longest first. A text is only translated this way when no Chinese is left.
const PHRASES: Record<string, string> = {
  // Notes and amounts
  室溫: 'room temperature', 常溫: 'room temperature', 打蛋白霜用: 'for the meringue', 打蛋黃奶油糊用: 'for the yolk and butter batter',
  或迷迭香粉: 'or ground rosemary', 學長自費: 'paid by the alumni', 裝飾用: 'for garnish', 裝飾: 'for garnish', 備用: 'set aside', 自備: 'bring your own',
  切丁: 'diced', 切片: 'sliced', 切絲: 'shredded', 切碎: 'chopped', 切塊: 'cut into chunks', 去皮: 'peeled', 去籽: 'seeded', 冷藏: 'refrigerated',
  冷凍: 'frozen', 新鮮: 'fresh', 融化: 'melted', 軟化: 'softened', 打散: 'beaten', 待確認: 'to be confirmed', 待定: 'to be decided', 無: 'none',
  // Cuisines
  台式: 'Taiwanese', 日式: 'Japanese', 韓式: 'Korean', 泰式: 'Thai', 義式: 'Italian', 法式: 'French', 美式: 'American', 中式: 'Chinese', 港式: 'Hong Kong',
  越式: 'Vietnamese', 德式: 'German', 英式: 'British', 歐洲: 'European', 歐式: 'European', 西式: 'Western', 南洋: 'Southeast Asian', 東南亞: 'Southeast Asian',
  印度: 'Indian', 墨西哥: 'Mexican', 西班牙: 'Spanish', 希臘: 'Greek', 創意料理: 'Fusion', 無國界: 'Fusion', 融合: 'Fusion',
  // Price notes
  小時達: 'PX Hour Delivery', 秤重: 'by weight', 單顆: 'single', 整顆: 'whole', 一顆約: 'one is about', 一盒約: 'one box is about', 一包約: 'one pack is about',
  一小把: 'a small bunch', 夏季可能大漲: 'may rise sharply in summer', 約一台斤: 'about 1 jin', 一斤: 'per jin', 盒裝約: 'box of about', 袋裝約: 'bag of about', 盒裝: 'boxed',
  袋裝: 'bagged', 元不等: ' NT$ depending on the product', '紅／黃椒': 'red/yellow pepper', 豆腐攤: 'tofu stall', 蛋行: 'egg shop', 鮮乳: 'fresh milk', 條狀: 'stick',
  動物性: 'dairy', 片裝: 'slice pack', 披薩用: 'for pizza', 原味: 'plain', 精鹽: 'refined salt', 沙拉油: 'salad oil', 一條: 'one loaf', 半條: 'half loaf', 全脂: 'whole',
  非籠飼: 'cage-free', 希臘式無糖: 'Greek unsweetened', 無鹽: 'unsalted', 洗選蛋: 'washed eggs', 一等米: 'grade 1 rice', 直條: 'spaghetti', 義峰中筋: 'Yi Feng all-purpose',
  葵花油: 'sunflower oil', 莫札瑞拉乳酪絲: 'shredded mozzarella', 安佳披薩用: 'Anchor for pizza', 安博格動物性: 'Emborg dairy', 安博格無鹽: 'Emborg unsalted', 總統牌動物性: 'Président dairy',
  光泉鮮乳: 'Kuang Chuan fresh milk', 瑞穗全脂: 'Ruisui whole', 批發均價: 'wholesale average', '元/公斤換算': ' NT$/kg, converted',
  // Brands
  安博格: 'Emborg', 總統牌: 'Président', 光泉: 'Kuang Chuan', 安佳: 'Anchor', 義美: 'I-Mei', 中華: 'Chung Hwa', 義峰: 'Yi Feng', 台糖: 'Taisugar', 台鹽: 'Taiyen', 萬家香: 'Wan Ja Shan',
  可果美: 'Kagome', 卡貝樂: 'Cabernet', 寶宏安柏: 'Baohong Ambo', 駱駝牌: 'Camel', 龜甲萬: 'Kikkoman', 工研: 'Kung Yen', 佛蒙特: 'Vermont', 科克蘭: 'Kirkland',
}
const PHRASE_ENTRIES = Object.entries(PHRASES).sort((a, b) => b[0].length - a[0].length)

const PUNCTUATION: Array<[RegExp, string]> = [
  [/、/g, ', '], [/，/g, ', '], [/；/g, '; '], [/：/g, ': '], [/。/g, '. '], [/（/g, ' ('], [/）/g, ')'], [/～/g, '–'], [/／/g, '/'], [/＆/g, ' & '],
]

const tidy = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim()

// Words first, so "12 片裝" is not read as 12 slices; then amounts and punctuation. Null when Chinese remains.
export const phraseToEnglish = (text: string): string | null => {
  let result = text
  PHRASE_ENTRIES.forEach(([zh, en]) => {
    result = result.split(zh).join(` ${en} `)
  })
  result = amountToEnglish(tidy(result))
  PUNCTUATION.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement)
  })
  return hasChinese(result) ? null : tidy(result)
}

// Short stable key, so any text (with / . or line breaks) can be a Firestore map key.
export const textKey = (text: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `t${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

export type SavedTexts = Record<string, string>

// The English for one line, or null when it still needs machine translation.
export const translateLine = (line: string, saved: SavedTexts): string | null => {
  const text = line.trim()
  if (!hasChinese(text)) {
    return text
  }
  return saved[textKey(text)] ?? BUILTIN_TEXT_EN[text] ?? phraseToEnglish(text)
}

export const hasBuiltinTranslation = (line: string): boolean => {
  const text = line.trim()
  return Boolean(BUILTIN_TEXT_EN[text]) || phraseToEnglish(text) !== null
}

// Line by line, keeping line breaks; a line without a translation yet stays as written.
export const translateText = (text: string, saved: SavedTexts): string =>
  text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? (translateLine(line, saved) ?? line) : line))
    .join('\n')

export const untranslatedLines = (text: string, saved: SavedTexts): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && translateLine(line, saved) === null)

// What is left in Chinese after amount rules, e.g. the 盆 in "3 盆".
export const chineseRuns = (text: string): string[] => text.match(CJK_RUN) ?? []
export const translateChineseRuns = (text: string, saved: SavedTexts): string =>
  text.replace(CJK_RUN, (run) => translateLine(run, saved) ?? run)

// The free service takes about 500 bytes at a time: split long lines at sentence ends, then commas.
export const machineChunks = (line: string, maxLength = 150): string[] => {
  const split = (text: string, separators: RegExp): string[] => text.split(separators).filter(Boolean)
  const chunks: string[] = []
  const push = (piece: string) => {
    const last = chunks[chunks.length - 1]
    if (last !== undefined && last.length + piece.length <= maxLength) {
      chunks[chunks.length - 1] = last + piece
    } else {
      chunks.push(piece)
    }
  }
  split(line, /(?<=[。！？；])/).forEach((sentence) => {
    if (sentence.length <= maxLength) {
      push(sentence)
      return
    }
    split(sentence, /(?<=[，、])/).forEach((part) => {
      for (let i = 0; i < part.length; i += maxLength) {
        push(part.slice(i, i + maxLength))
      }
    })
  })
  return chunks
}

// Cooking words the machine reliably gets wrong.
const MACHINE_FIXES: Array<[RegExp, string]> = [
  [/\b(?:into|to|in) (?:a )?mud\b/gi, 'into a purée'],
  [/\bmud\b/gi, 'purée'],
  [/\bprotein cream\b/gi, 'meringue'],
  [/\bprotein frost(ing)?\b/gi, 'meringue'],
  [/\bunripe\b/gi, 'uncooked'],
  [/\bbaked eggs?\b/gi, 'omelette'],
  [/\bvegetarian soup\b/gi, 'vegetable stock'],
  [/\begg liquid\b/gi, 'beaten egg'],
  [/\bpen-?tube noodles\b/gi, 'penne'],
  [/\brice cooker\b/gi, 'electric cooker'],
  [/\bhot pot base\b/gi, 'hot pot broth'],
]

// Null when the service sent a warning instead of a translation, or left Chinese in it.
export const polishMachineEnglish = (source: string, result: string): string | null => {
  let text = result.replace(/\s+/g, ' ').trim()
  if (!text || /MYMEMORY|QUERY LENGTH|INVALID|AUTO-?DETECT/i.test(text) || hasChinese(text) || text.trim() === source.trim()) {
    return null
  }
  MACHINE_FIXES.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement)
  })
  return text.charAt(0).toUpperCase() + text.slice(1)
}
