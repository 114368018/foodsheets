// Ingredient and tool names between Chinese and English, so groups can type either and summaries still add up.
// The built-in dictionaries cover the ingredient and tool libraries; anything else is machine-translated once and
// saved in the shared data ("learned" translations), where admins can correct it.

// Chinese (as in the ingredient library) -> English.
export const BUILTIN_ZH_EN: Record<string, string> = {
  洋蔥: 'Onion', 青蔥: 'Green onion', 蒜頭: 'Garlic', 薑: 'Ginger', 南薑: 'Galangal', 黃薑: 'Turmeric',
  大白菜: 'Napa cabbage', 高麗菜: 'Cabbage', 青江菜: 'Bok choy', 小白菜: 'Baby bok choy', 萵苣: 'Lettuce',
  菠菜: 'Spinach', 美生菜: 'Iceberg lettuce', 芹菜: 'Chinese celery', 西洋芹: 'Celery', 碧玉筍: 'Green bamboo shoot',
  玉米筍: 'Baby corn', 櫛瓜: 'Zucchini', 小黃瓜: 'Cucumber', 茄子: 'Eggplant', 花椰菜: 'Broccoli',
  白花椰菜: 'Cauliflower', 馬鈴薯: 'Potato', 白蘿蔔: 'Daikon radish', 紅蘿蔔: 'Carrot', 地瓜: 'Sweet potato',
  紅地瓜: 'Red sweet potato', 栗子南瓜: 'Kabocha squash', 南瓜: 'Pumpkin', 芋頭: 'Taro', 甜菜: 'Beetroot',
  豆芽: 'Bean sprouts', 玉米粒: 'Corn kernels', 玉米: 'Corn', 番茄: 'Tomato', 番茄丁: 'Diced tomato',
  牛番茄: 'Beefsteak tomato', 紅小番茄: 'Cherry tomato', 黃小番茄: 'Yellow cherry tomato', 小番茄: 'Cherry tomato',
  青椒: 'Green bell pepper', 甜椒: 'Bell pepper', 黃椒: 'Yellow bell pepper', 紅椒: 'Red bell pepper',
  大辣椒: 'Large chili', 辣椒: 'Chili pepper', 辣椒葉: 'Chili leaves', 四季豆: 'Green beans', 九層塔: 'Thai basil',
  香菜: 'Cilantro', 迷迭香: 'Rosemary', 香茅: 'Lemongrass', 斑蘭葉: 'Pandan leaves',
  蘑菇: 'Mushroom', 黑木耳: 'Wood ear mushroom', 金針菇: 'Enoki mushroom', 鴻喜菇: 'Shimeji mushroom',
  黑鴻喜菇: 'Brown shimeji', 雪白菇: 'White shimeji', 秀珍菇: 'Oyster mushroom', 鮮香菇: 'Fresh shiitake',
  乾香菇: 'Dried shiitake', 香菇: 'Shiitake mushroom', 杏鮑菇: 'King oyster mushroom', 猴頭菇: "Lion's mane mushroom",
  乾猴頭菇: "Dried lion's mane", 太極菇: 'Taiji mushroom',
  蘋果: 'Apple', 青蘋果: 'Green apple', 奇異果: 'Kiwi', 酪梨: 'Avocado', 柳丁: 'Orange', 橘子: 'Tangerine',
  鳳梨: 'Pineapple', 哈密瓜: 'Cantaloupe', 火龍果: 'Dragon fruit', 紅火龍果: 'Red dragon fruit', 葡萄: 'Grape',
  紫葡萄: 'Purple grape', 無子葡萄: 'Seedless grape', 藍莓: 'Blueberry', 石榴: 'Pomegranate', 檸檬: 'Lemon',
  香蕉: 'Banana', 西瓜: 'Watermelon', 草莓: 'Strawberry', 芒果: 'Mango',
  豆干: 'Dried tofu', 豆花: 'Tofu pudding', 嫩豆腐: 'Silken tofu', 板豆腐: 'Firm tofu', 百頁豆腐: 'Bai ye tofu',
  凍豆腐: 'Frozen tofu', 火鍋用豆腐: 'Hot pot tofu', 油豆腐: 'Fried tofu', 三角油豆腐: 'Triangle fried tofu',
  豆腐: 'Tofu', 麵腸: 'Wheat gluten roll', 素肉: 'Plant-based meat', Omnipork新豬肉: 'OmniPork',
  素肉燥: 'Vegetarian minced sauce', 素火腿: 'Vegetarian ham', 素培根: 'Vegetarian bacon', 素熱狗: 'Vegetarian hot dog',
  素鬆: 'Vegetarian floss', 小肉豆: 'Vegetarian meatballs', 火腿漿: 'Ham paste', 滷蛋: 'Braised egg',
  雞蛋: 'Egg', 蛋黃: 'Egg yolk', 蛋白: 'Egg white', 牛奶: 'Milk', 鮮奶油: 'Whipping cream', 奶油: 'Butter',
  無鹽奶油: 'Unsalted butter', 優格: 'Yogurt', 煉乳: 'Condensed milk', 起司: 'Cheese', 起司片: 'Cheese slice',
  起司絲: 'Shredded cheese', 起司粉: 'Grated cheese', 切達起司: 'Cheddar cheese', 紅切達: 'Red cheddar',
  莫札瑞拉起司: 'Mozzarella', 馬斯卡彭: 'Mascarpone', 奶油乳酪: 'Cream cheese',
  白米: 'Rice', 糯米: 'Glutinous rice', 米粉: 'Rice vermicelli', 河粉: 'Rice noodles', 黃麵: 'Yellow noodles',
  麵條: 'Noodles', 義大利麵條: 'Spaghetti', '義大利麵(斜管)': 'Penne', 寬扁義大利麵: 'Fettuccine', 通心粉: 'Macaroni',
  墨西哥通心粉: 'Mexican macaroni', 王子麵: 'Instant noodle snack', 細黃油麵: 'Thin yellow noodles', 年糕: 'Rice cake',
  薯餅: 'Hash brown', 薯條: 'French fries', 嫩油條: 'Fried dough stick', 甜不辣: 'Tempura fish cake (vegetarian)',
  麵包: 'Bread', 法國麵包: 'Baguette', 白吐司: 'White bread', 吐司塊: 'Bread cubes', 鬆餅粉: 'Pancake mix',
  起酥片: 'Puff pastry', 米紙: 'Rice paper', 海苔片: 'Seaweed sheet', pappadam餅: 'Pappadam', 西米: 'Sago',
  麵粉: 'Flour', 中筋麵粉: 'All-purpose flour', 低筋麵粉: 'Cake flour', 高筋麵粉: 'Bread flour', 玉米粉: 'Cornstarch',
  玉米澱粉: 'Cornstarch', 太白粉: 'Potato starch', 地瓜粉: 'Sweet potato starch', 樹薯粉: 'Tapioca starch',
  糯米粉: 'Glutinous rice flour', 豆花粉: 'Tofu pudding powder', 酥炸粉: 'Frying batter mix', 素吉利丁: 'Vegetarian gelatin',
  可可粉: 'Cocoa powder', 巧克力粉: 'Chocolate powder', 巧克力豆: 'Chocolate chips', 糖粉: 'Powdered sugar',
  泡打粉: 'Baking powder', 小蘇打粉: 'Baking soda', 酵母粉: 'Yeast',
  花生: 'Peanut', 花生米: 'Peanut kernels', 花生粉: 'Peanut powder', 芝麻: 'Sesame', 白芝麻: 'White sesame',
  去皮白芝麻: 'Hulled white sesame', 去皮黑芝麻: 'Hulled black sesame', 芝麻粉: 'Sesame powder', 核桃: 'Walnut',
  果乾: 'Dried fruit', 紅豆: 'Red bean', 綠豆: 'Mung bean', 紅豆餡: 'Red bean paste', 花生餡: 'Peanut filling',
  芋頭餡: 'Taro paste', 芝麻餡: 'Sesame filling', 杏仁: 'Almond',
  醬油: 'Soy sauce', 清醬油: 'Light soy sauce', 昆布醬油: 'Kombu soy sauce', 醬油膏: 'Thick soy sauce',
  番茄醬: 'Ketchup', 番茄罐頭: 'Canned tomatoes', 沙拉醬: 'Salad dressing', 美乃滋: 'Mayonnaise', 白醋: 'White vinegar',
  壽司醋: 'Sushi vinegar', 酸瓜: 'Pickled cucumber', 味噌: 'Miso', 辣豆瓣: 'Spicy bean paste', 豆瓣醬: 'Bean paste',
  豆豉辣椒醬: 'Black bean chili sauce', 韓式辣醬: 'Gochujang', 春醬: 'Chunjang', 芝麻醬: 'Sesame paste',
  胡麻醬: 'Roasted sesame dressing', 芥末醬: 'Mustard', 素蠔油: 'Vegetarian oyster sauce', 辣油: 'Chili oil',
  羅望子: 'Tamarind', 泡菜: 'Kimchi', 濃湯粉: 'Soup powder', 蠔油: 'Oyster sauce',
  鹽: 'Salt', 胡椒鹽: 'Pepper salt', 黑胡椒: 'Black pepper', 黑胡椒粒: 'Black peppercorns', 黑胡椒粉: 'Ground black pepper',
  白胡椒粉: 'White pepper', 胡椒粉: 'Ground pepper', 辣椒粉: 'Chili powder', 辣椒乾: 'Dried chili', 紅椒粉: 'Paprika',
  小茴香: 'Cumin', 八角: 'Star anise', 桂皮: 'Cinnamon bark', 肉桂粉: 'Cinnamon powder', 香葉: 'Bay leaf',
  香料包: 'Spice bag', 義式香料: 'Italian seasoning', 南薑粉: 'Galangal powder', 黃薑粉: 'Turmeric powder',
  伯爵茶包: 'Earl Grey tea bag', 紅茶葉: 'Black tea leaves', 決明子: 'Cassia seed', 咖喱: 'Curry', 東南亞咖喱: 'Southeast Asian curry',
  砂糖: 'Sugar', 細砂糖: 'Caster sugar', 二號砂糖: 'Brown sugar (light)', 冰糖: 'Rock sugar', 黑糖: 'Brown sugar',
  焦糖液: 'Caramel syrup', 巧克力: 'Chocolate', 芋園: 'Taro balls', 麗滋起司餅乾: 'Ritz cheese crackers', 燕麥餅乾: 'Oat cookies',
  蜂蜜: 'Honey', 楓糖漿: 'Maple syrup',
  食用油: 'Cooking oil', 橄欖油: 'Olive oil', 玄米油: 'Rice bran oil', 椰子油: 'Coconut oil', 麻油: 'Sesame oil', 香油: 'Sesame oil',
  米酒: 'Rice wine', 檸檬汁: 'Lemon juice', 燕麥奶: 'Oat milk', 無糖豆奶: 'Unsweetened soy milk', 豆漿: 'Soy milk',
  椰奶: 'Coconut milk', 味精: 'MSG', 乾海帶: 'Dried kelp', 乾昆布: 'Dried kombu', 玉米罐頭: 'Canned corn',
  冰塊: 'Ice', 水: 'Water', 鮪魚罐頭: 'Canned tuna', 吉利丁: 'Gelatin', 吉利丁粉: 'Gelatin powder', 牛油: 'Beef tallow',
  // Names that composing from parts would get wrong (紅糖 is not "red sugar").
  紅糖: 'Brown sugar', 黑醋: 'Black vinegar', 白胡椒: 'White pepper', 黑芝麻: 'Black sesame', 大蒜: 'Garlic',
  小麥: 'Wheat', 白飯: 'Cooked rice', 乾辣椒: 'Dried chili', 小米: 'Millet', 大豆: 'Soybeans', 白木耳: 'White fungus',
  木耳: 'Wood ear mushroom', 竹筍: 'Bamboo shoot', 小蘇打: 'Baking soda', 中藥: 'Chinese herbs',
}

// Extra English spellings that should land on a Chinese name.
const EXTRA_EN_ZH: Record<string, string> = {
  tomato: '番茄', 'roma tomato': '番茄', 'cherry tomato': '紅小番茄', eggs: '雞蛋', 'whole egg': '雞蛋',
  scallion: '青蔥', 'spring onion': '青蔥', 'green onions': '青蔥', 'bok choi': '青江菜', 'pak choi': '青江菜',
  'chinese cabbage': '大白菜', 'green cabbage': '高麗菜', 'cabbage head': '高麗菜', aubergine: '茄子', courgette: '櫛瓜',
  capsicum: '甜椒', 'red pepper': '紅椒', 'green pepper': '青椒', 'yellow pepper': '黃椒', chilli: '辣椒', chili: '辣椒',
  coriander: '香菜', basil: '九層塔', shiitake: '鮮香菇', enoki: '金針菇', 'king oyster': '杏鮑菇', 'oyster mushroom': '秀珍菇',
  'sweet potato': '地瓜', yam: '地瓜', 'spring roll wrapper': '米紙', 'heavy cream': '鮮奶油', cream: '鮮奶油',
  'whipped cream': '鮮奶油', 'double cream': '鮮奶油', 'shredded mozzarella': '起司絲', mozzarella: '起司絲',
  'sliced cheese': '起司片', parmesan: '起司粉', cheddar: '切達起司', 'greek yogurt': '優格', yoghurt: '優格',
  'white rice': '白米', 'jasmine rice': '白米', 'sticky rice': '糯米', pasta: '義大利麵條', 'plain flour': '中筋麵粉',
  'all purpose flour': '中筋麵粉', 'low gluten flour': '低筋麵粉', 'corn starch': '玉米粉', 'corn flour': '玉米粉',
  'starch': '太白粉', 'white sugar': '砂糖', 'granulated sugar': '砂糖', 'icing sugar': '糖粉', 'soya sauce': '醬油',
  'sea salt': '鹽', 'table salt': '鹽', pepper: '胡椒粉', 'vegetable oil': '食用油', oil: '食用油', 'salad oil': '食用油',
  'extra virgin olive oil': '橄欖油', 'peanuts': '花生', 'sesame seeds': '白芝麻', 'red beans': '紅豆', 'azuki beans': '紅豆',
  'mung beans': '綠豆', 'soy milk': '豆漿', 'soymilk': '豆漿', 'coconut cream': '椰奶', ice: '冰塊', 'ice cubes': '冰塊',
  'firm tofu': '板豆腐', 'soft tofu': '嫩豆腐', 'dried tofu': '豆干', 'bean curd': '豆腐', 'seaweed': '海苔片', nori: '海苔片',
  'curry powder': '咖喱', 'curry cubes': '咖喱', 'cocoa': '可可粉', 'chocolate chip': '巧克力豆', 'cinnamon': '肉桂粉',
}

const CJK = /[㐀-鿿]/

export const isEnglishName = (name: string): boolean => /[a-z]/i.test(name) && !CJK.test(name)
export const isChineseName = (name: string): boolean => CJK.test(name)

export const normalizeEnglish = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[_,.;:!()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const singular = (word: string): string => {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(oes|ches|shes|xes|sses)$/.test(word)) return word.replace(/es$/, '')
  if (/[^s]s$/.test(word)) return word.slice(0, -1)
  return word
}

const DESCRIPTORS = /^(fresh|organic|large|small|medium|whole|raw|chopped|sliced|diced|minced|ground|frozen|dried|baby)\s+/

const buildEnglishIndex = (zhEn: Record<string, string>, extraEnZh: Record<string, string>): Record<string, string> => {
  const map: Record<string, string> = {}
  Object.entries(zhEn).forEach(([zh, en]) => {
    const key = normalizeEnglish(en)
    if (!map[key]) map[key] = zh
  })
  Object.entries(extraEnZh).forEach(([en, zh]) => {
    map[normalizeEnglish(en)] = zh
  })
  // "Dragonfruit" should find "dragon fruit": also index each multi-word name without spaces.
  Object.entries({ ...map }).forEach(([key, zh]) => {
    const compact = key.replace(/ /g, '')
    if (!map[compact]) map[compact] = zh
  })
  return map
}

const EN_ZH = buildEnglishIndex(BUILTIN_ZH_EN, EXTRA_EN_ZH)

// Learned translations are stored under "en:<normalized English>" and "zh:<normalized Chinese>".
export const learnedKey = (name: string): string =>
  isEnglishName(name) ? `en:${normalizeEnglish(name)}` : `zh:${name.replace(/\s+/g, '').toLowerCase()}`

// English -> Chinese: learned first (admins can correct), then the dictionary with simple plural and
// "fresh/diced/…" handling. Returns null when unknown.
const lookupChinese = (name: string, learned: Record<string, string>, index: Record<string, string>): string | null => {
  const base = normalizeEnglish(name)
  if (!base) return null
  const candidates = [base, base.split(' ').map(singular).join(' ')]
  const stripped = base.replace(DESCRIPTORS, '')
  if (stripped !== base) candidates.push(stripped, stripped.split(' ').map(singular).join(' '))
  for (const candidate of candidates) {
    const hit = learned[`en:${candidate}`] ?? index[candidate] ?? index[candidate.replace(/ /g, '')]
    if (hit) return hit
  }
  return null
}

// Chinese -> English: learned first, then the dictionary, then the English name someone typed that was
// translated into this Chinese name (so it stays readable in English mode). Returns null when unknown.
const lookupExactEnglish = (compact: string, learned: Record<string, string>, zhEn: Record<string, string>): string | null => {
  const direct = learned[`zh:${compact.toLowerCase()}`] ?? zhEn[compact]
  if (direct) return direct
  const typed = Object.keys(learned).find((key) => key.startsWith('en:') && learned[key] === compact)
  return typed ? typed.charAt(3).toUpperCase() + typed.slice(4) : null
}

// Words in front of a known name: 木鍋鏟 = 木 + 鍋鏟 -> "Wooden turner", 中型碗 -> "Medium bowl".
// Longest first, so 大型 wins over 大.
const ZH_PREFIXES: Array<[string, string]> = (
  [
    ['特大', 'Extra large'], ['大型', 'Large'], ['中型', 'Medium'], ['小型', 'Small'], ['迷你', 'Mini'], ['大', 'Large'],
    ['中', 'Medium'], ['小', 'Small'], ['長', 'Long'], ['深', 'Deep'], ['淺', 'Shallow'], ['圓', 'Round'], ['方', 'Square'],
    ['陶瓷', 'Ceramic'], ['瓷', 'Ceramic'], ['陶', 'Clay'], ['木頭', 'Wooden'], ['木', 'Wooden'], ['竹', 'Bamboo'],
    ['紙', 'Paper'], ['塑膠', 'Plastic'], ['玻璃', 'Glass'], ['不鏽鋼', 'Stainless steel'], ['鐵', 'Iron'], ['鋁', 'Aluminum'],
    ['鑄鐵', 'Cast iron'], ['矽膠', 'Silicone'], ['不沾', 'Non-stick'], ['免洗', 'Disposable'], ['一次性', 'Disposable'],
    ['電動', 'Electric'], ['電', 'Electric'], ['手動', 'Manual'], ['白', 'White'], ['黑', 'Black'],
    ['新鮮', 'Fresh'], ['冷凍', 'Frozen'], ['有機', 'Organic'], ['進口', 'Imported'], ['乾燥', 'Dried'], ['乾', 'Dried'],
  ] as Array<[string, string]>
).sort((a, b) => b[0].length - a[0].length)

// Ingredient endings after a known name: 抹茶粉 -> "Matcha powder", 芒果汁 -> "Mango juice".
const ZH_INGREDIENT_SUFFIXES: Array<[string, string]> = [
  ['粉', 'powder'], ['醬', 'sauce'], ['汁', 'juice'], ['片', 'slices'], ['絲', 'shreds'], ['丁', 'cubes'], ['塊', 'chunks'],
  ['泥', 'puree'], ['末', 'minced'], ['罐頭', 'canned'], ['條', 'strips'], ['球', 'balls'],
]

const lowerFirst = (text: string) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text)

const composeEnglish = (
  compact: string,
  learned: Record<string, string>,
  zhEn: Record<string, string>,
  suffixes: Array<[string, string]>,
  depth = 0,
): string | null => {
  if (depth > 3) return null
  const known = (part: string) => lookupExactEnglish(part, learned, zhEn) ?? composeEnglish(part, learned, zhEn, suffixes, depth + 1)
  for (const [prefix, english] of ZH_PREFIXES) {
    const rest = compact.slice(prefix.length)
    if (compact.startsWith(prefix) && rest) {
      const base = known(rest)
      if (base) return `${english} ${lowerFirst(base)}`
    }
  }
  for (const [suffix, english] of suffixes) {
    const head = compact.slice(0, -suffix.length)
    if (compact.endsWith(suffix) && head) {
      const base = known(head)
      if (base) return english === 'canned' ? `Canned ${lowerFirst(base)}` : `${base} ${english}`
    }
  }
  return null
}

const lookupEnglish = (
  name: string,
  learned: Record<string, string>,
  zhEn: Record<string, string>,
  suffixes: Array<[string, string]> = [],
): string | null => {
  const compact = name.replace(/\s+/g, '')
  return lookupExactEnglish(compact, learned, zhEn) ?? composeEnglish(compact, learned, zhEn, suffixes)
}

export const englishToChinese = (name: string, learned: Record<string, string>) => lookupChinese(name, learned, EN_ZH)
export const chineseToEnglish = (name: string, learned: Record<string, string>) =>
  lookupEnglish(name, learned, BUILTIN_ZH_EN, ZH_INGREDIENT_SUFFIXES)

// Tools, the same way: the tool library plus common extras. Learned translations are shared with
// ingredients (a word means the same thing in either list).
export const BUILTIN_TOOL_ZH_EN: Record<string, string> = {
  卡式爐: 'Portable gas stove', 瓦斯爐: 'Gas stove', 電磁爐: 'Induction cooker', 電鍋: 'Electric cooker',
  烤箱: 'Oven', 大烤箱: 'Large oven', 有變溫功能的烤箱: 'Oven with temperature control', 氣炸鍋: 'Air fryer',
  微波爐: 'Microwave', 電熱水壺: 'Electric kettle', 鍋子: 'Pot', 飯鍋: 'Rice cooker', 鐵鍋: 'Iron wok',
  不鏽鋼鍋: 'Stainless steel pot', 炒鍋: 'Wok', 平底鍋: 'Frying pan', 小平底鍋: 'Small frying pan', 湯鍋: 'Soup pot',
  大湯鍋: 'Large soup pot', 大瓷鍋: 'Large ceramic pot', 大的陶瓷鍋子: 'Large ceramic pot', 大鐵盆: 'Large metal basin',
  鍋蓋: 'Pot lid', 蒸籠: 'Steamer basket', 鐵盤: 'Baking tray', 大鐵盤: 'Large baking tray', 烤盤: 'Baking pan',
  圓形模具: 'Round mold', 圓形壓模器: 'Round cookie cutter', 蛋糕模: 'Cake mold', 裝奶酪的容器: 'Panna cotta cups',
  烤布蕾容器: 'Crème brûlée ramekins', 杯子蛋糕容器: 'Cupcake cups', 碗: 'Bowl', 小碗: 'Small bowl', 大碗公: 'Large bowl',
  盤子: 'Plate', 大盤子: 'Large plate', 大白盤: 'Large white plate', 杯子: 'Cup', 保鮮盒: 'Food container',
  砧板: 'Cutting board', 菜刀: 'Kitchen knife', 水果刀: 'Fruit knife', 刨刀: 'Peeler', 削皮刀: 'Vegetable peeler',
  剪刀: 'Scissors', 料理剪刀: 'Kitchen scissors', 刨絲器: 'Grater', 磨泥器: 'Zester', 開罐器: 'Can opener',
  濾網: 'Strainer', 篩網: 'Sieve', 篩子: 'Sifter', 擀麵棍: 'Rolling pin', 夾子: 'Tongs', 洗菜籃: 'Colander',
  果汁機: 'Blender', 攪拌器: 'Mixer', 電動打蛋器: 'Electric hand mixer', 打蛋器: 'Whisk', 分蛋器: 'Egg separator',
  刮刀: 'Spatula', 鍋鏟: 'Turner', 矽膠鍋鏟: 'Silicone turner', 湯勺: 'Ladle', 湯匙: 'Spoon', 小湯匙: 'Small spoon',
  大湯匙: 'Serving spoon', 筷子: 'Chopsticks', 叉子: 'Fork', 毛刷: 'Pastry brush', 量杯: 'Measuring cup',
  量匙: 'Measuring spoons', 電子秤: 'Kitchen scale', 溫度計: 'Thermometer', 計時器: 'Timer', 裱花袋: 'Piping bag',
  噴槍: 'Kitchen torch', 隔熱手套: 'Oven mitts', 手套: 'Gloves', 鋁箔紙: 'Aluminum foil', 烘焙紙: 'Baking paper',
  保鮮膜: 'Plastic wrap', 廚房紙巾: 'Paper towels', 竹籤: 'Skewers', 牙籤: 'Toothpicks', 抹布: 'Dish cloth',
  菜瓜布: 'Scrub sponge', 延長線: 'Extension cord', 托盤: 'Tray',
  // Single base words, so names like 瓷鍋 or 紙碗 can be put together from their parts.
  鍋: 'Pot', 盤: 'Plate', 碟子: 'Small plate', 碟: 'Small plate', 杯: 'Cup', 刀: 'Knife', 盆: 'Basin', 匙: 'Spoon',
  鏟: 'Spatula', 鏟子: 'Spatula', 勺: 'Ladle', 勺子: 'Ladle', 籃: 'Basket', 籃子: 'Basket', 架: 'Rack', 架子: 'Rack',
  夾: 'Tongs', 刷: 'Brush', 刷子: 'Brush', 墊: 'Mat', 蓋: 'Lid', 蓋子: 'Lid', 筷: 'Chopsticks', 叉: 'Fork',
  盒: 'Box', 盒子: 'Box', 罐: 'Jar', 罐子: 'Jar', 瓶: 'Bottle', 瓶子: 'Bottle', 袋: 'Bag', 袋子: 'Bag', 模: 'Mold',
  模具: 'Mold', 容器: 'Container', 壺: 'Kettle', 桶: 'Bucket', 瓢: 'Scoop', 秤: 'Scale', 網: 'Mesh', 烤架: 'Grill rack',
  冷卻架: 'Cooling rack', 刨片器: 'Mandoline slicer', 削皮器: 'Peeler', 壓泥器: 'Masher', 漏勺: 'Slotted spoon',
}

const EXTRA_TOOL_EN_ZH: Record<string, string> = {
  knife: '菜刀', knives: '菜刀', 'chef knife': '菜刀', "chef's knife": '菜刀', 'cooking knife': '菜刀',
  'paring knife': '水果刀', pan: '平底鍋', 'fry pan': '平底鍋', skillet: '平底鍋', 'non stick pan': '平底鍋',
  saucepan: '湯鍋', 'stock pot': '大湯鍋', stockpot: '大湯鍋', 'cooking pot': '鍋子', 'chopping board': '砧板',
  'cutting board': '砧板', board: '砧板', scale: '電子秤', 'digital scale': '電子秤', 'egg beater': '打蛋器',
  'balloon whisk': '打蛋器', 'hand mixer': '電動打蛋器', 'stand mixer': '攪拌器', 'mixing bowl': '大碗公',
  'mesh strainer': '濾網', 'rubber spatula': '刮刀', 'silicone spatula': '刮刀', 'wok spatula': '鍋鏟',
  'spatula turner': '鍋鏟', foil: '鋁箔紙', 'tin foil': '鋁箔紙', 'aluminium foil': '鋁箔紙', 'parchment paper': '烘焙紙',
  'baking sheet': '鐵盤', 'sheet pan': '鐵盤', 'cling film': '保鮮膜', 'cling wrap': '保鮮膜', 'paper towel': '廚房紙巾',
  'kitchen paper': '廚房紙巾', 'microwave oven': '微波爐', 'toaster oven': '烤箱', 'blow torch': '噴槍', blowtorch: '噴槍',
  torch: '噴槍', 'pastry bag': '裱花袋', 'camping stove': '卡式爐', 'portable stove': '卡式爐', 'butane stove': '卡式爐',
  stove: '瓦斯爐', 'induction stove': '電磁爐', kettle: '電熱水壺', steamer: '蒸籠', 'electric steamer': '電鍋',
  ramekin: '烤布蕾容器', ramekins: '烤布蕾容器', 'cupcake liners': '杯子蛋糕容器', 'cookie cutter': '圓形壓模器',
  'serving plate': '大盤子', dish: '盤子', 'oven mitt': '隔熱手套', 'oven gloves': '隔熱手套', container: '保鮮盒',
  tupperware: '保鮮盒', sponge: '菜瓜布', 'extension cable': '延長線', 'power strip': '延長線',
}

const TOOL_EN_ZH = buildEnglishIndex(BUILTIN_TOOL_ZH_EN, EXTRA_TOOL_EN_ZH)

export const toolEnglishToChinese = (name: string, learned: Record<string, string>) => lookupChinese(name, learned, TOOL_EN_ZH)
export const toolChineseToEnglish = (name: string, learned: Record<string, string>) => lookupEnglish(name, learned, BUILTIN_TOOL_ZH_EN)

// Machine-translation result cleanup: one line, no trailing punctuation, sensible capitalization.
export const cleanMachineTranslation = (source: string, result: string, toEnglish: boolean): string | null => {
  const text = result.split(/\r?\n/)[0].replace(/[。．.、,，!！?？]+$/g, '').trim()
  if (!text || text.length > 40 || /MYMEMORY|QUERY LENGTH|INVALID/i.test(text)) return null
  if (normalizeEnglish(text) === normalizeEnglish(source)) return null
  if (toEnglish) {
    if (CJK.test(text)) return null
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
  }
  return CJK.test(text) ? text.replace(/\s+/g, '') : null
}

// Amounts in English mode: "3顆" -> "3 pcs", "1.5 公斤" -> "1.5 kg", "適量" -> "as needed".
const UNIT_EN: Array<[string, string]> = [
  ['公斤', 'kg'], ['千克', 'kg'], ['公克', 'g'], ['毫升', 'ml'], ['公升', 'L'], ['大匙', 'tbsp'], ['湯匙', 'tbsp'],
  ['小匙', 'tsp'], ['茶匙', 'tsp'], ['台斤', 'jin'], ['顆', 'pcs'], ['個', 'pcs'], ['粒', 'pcs'], ['入', 'pcs'],
  ['條', 'pcs'], ['根', 'pcs'], ['支', 'pcs'], ['把', 'bunch'], ['束', 'bunch'], ['包', 'pack'], ['袋', 'bag'],
  ['片', 'slices'], ['張', 'sheets'], ['盒', 'box'], ['瓶', 'bottle'], ['罐', 'can'], ['塊', 'block'], ['杯', 'cup'],
  ['碗', 'bowl'], ['克', 'g'], ['斤', 'jin'], ['兩', 'liang'], ['升', 'L'],
]
const UNIT_EN_MAP = new Map(UNIT_EN)
const AMOUNT_UNIT = new RegExp(String.raw`(\d[\d.,/]*)\s*(${UNIT_EN.map(([zh]) => zh).join('|')})`, 'g')

export const amountToEnglish = (text: string): string =>
  text
    .replace(AMOUNT_UNIT, (_match, qty: string, unit: string) => `${qty} ${UNIT_EN_MAP.get(unit)}`)
    .replace(/適量/g, 'as needed')
    .replace(/少許/g, 'a little')

export const unitToEnglish = (unit: string): string => UNIT_EN_MAP.get(unit.trim()) ?? unit
