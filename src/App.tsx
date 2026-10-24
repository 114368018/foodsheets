import JSZip from 'jszip'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent, SetStateAction } from 'react'
import { deleteDoc, doc, onSnapshot, runTransaction } from 'firebase/firestore'
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  type IImageOptions,
} from 'docx'
import { INGREDIENT_LIBRARY_BLOCKLIST, INGREDIENT_LIBRARY_SEED } from './ingredient-library'
import { TOOL_LIBRARY_SEED } from './tool-library'
import { CHANGELOG_ENTRIES } from './changelog'
import {
  db,
  firebaseProjectDocId,
  isFirebaseConfigured,
  missingFirebaseEnvKeys,
} from './firebase'
import { deepEqual, stripUndefined, threeWayMerge } from './sync'
import {
  looksLikeIngredientList,
  parseAmount,
  parseIngredientText,
  splitAmountInput,
  type ParsedIngredient,
} from './ingredient-parse'
import { Icon, type IconName } from './icons'
import { translate, type Lang } from './i18n'
import {
  BUILTIN_ZH_EN,
  chineseToEnglish,
  cleanMachineTranslation,
  englishToChinese,
  isChineseName,
  isEnglishName,
  learnedKey,
  amountToEnglish,
  unitToEnglish,
  BUILTIN_TOOL_ZH_EN,
  toolChineseToEnglish,
  toolEnglishToChinese,
} from './ingredient-translate'
import { nextId } from './ids'
import {
  CATEGORY_ORDER,
  STORE_KINDS,
  STORE_KIND_IDS,
  allocateGroupSpending,
  computeStoreStats,
  dedupeStoreItems,
  categorizeIngredient,
  estimateWithEntry,
  findPriceEntries,
  formatMoney,
  formatPack,
  storeKindOf,
  suggestPurchase,
  type GroupShare,
  type PriceEntry,
  type StoreKind,
  type Suggestion,
} from './shopping'
import { PRICE_REFERENCE_UPDATED, PRICE_SEED_BATCHES } from './price-reference'
import {
  BUILTIN_INGREDIENT_ALIASES,
  BUILTIN_TOOL_ALIASES,
  canonicalName,
  canonicalUnit,
  cleanDisplayName,
  formatQuantity,
  normalizeNameText,
  pairKey,
  suggestDuplicateNames,
} from './name-normalize'

// Group ids are stable keys in groupData. Legacy groups use their original name as id.
const SAMPLE_GROUP_TAB = '範例組' as const
const DEFAULT_GROUP_IDS = [
  SAMPLE_GROUP_TAB,
  '第一組',
  '第二組',
  '第三組',
  '第四組',
  '第五組',
  '第六組',
  '第七組',
  '學長姐組',
]
const TOOL_LIBRARY_TAB = '工具庫' as const
const INGREDIENT_LIBRARY_TAB = '食材庫' as const
const GROUP_INGREDIENT_LIBRARY_TAB = '各組食材表' as const
const GROUP_TOOL_LIBRARY_TAB = '各組工具表' as const
const CHANGELOG_TAB = '版本日誌' as const
const SHOPPING_LIST_TAB = '食材採買' as const
const PRICE_TAB = '價格參考' as const
const ADMIN_PASSCODE = 'admin'
const STORAGE_KEY = 'foodsheets.v1.state'
const RESET_CONFIRM_PHRASE = '全部歸零'
const MIN_DISH_COUNT = 2
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const isCloudinaryConfigured = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET)

type GroupTab = string
// Group tabs are group ids; the rest are fixed admin/info tabs.
type TabName = string

const ADMIN_TAB_ICONS: Record<string, IconName> = {
  各組食材表: 'list',
  各組工具表: 'tool',
  食材總表: 'grid',
  工具總表: 'box',
  食材採買: 'cart',
  價格參考: 'tag',
  工具庫: 'book',
  食材庫: 'book',
}

const ADMIN_TABS: TabName[] = [
  GROUP_INGREDIENT_LIBRARY_TAB,
  GROUP_TOOL_LIBRARY_TAB,
  '食材總表',
  '工具總表',
  SHOPPING_LIST_TAB,
  PRICE_TAB,
  TOOL_LIBRARY_TAB,
  INGREDIENT_LIBRARY_TAB,
]

type ShoppingStoreItem = {
  id: number
  ingredient: string
  price: string
  ownedQty?: string
  purchased?: boolean
}

type ShoppingStore = {
  id: number
  storeName: string
  items: ShoppingStoreItem[]
  // What the receipt actually says; when empty, spending is the sum of item prices.
  receiptTotal?: string
}

type IngredientRow = {
  id: number
  dishId: number
  ingredient: string
  perServingQty: string
  perServingUnit: string
  totalQty: string
  totalUnit: string
  note: string
  // Optional product photo so shoppers buy the right thing.
  image?: DishImage
}

type ToolRow = {
  id: number
  tool: string
  qty: string
  unit: string
  note: string
}

type IngredientSummaryRow = {
  // Adjustments and checkmarks are stored under this key: canonical name + canonical unit.
  key: string
  nameKey: string
  ingredient: string
  // Other spellings that were counted as this ingredient (蕃茄 for 番茄).
  variants: string[]
  perServingUnit: string
  perServingMixed: boolean
  totalUnit: string
  note: string
  sumPerServingQty: number
  sumTotalQty: number
  // Amounts that are not numbers, such as 適量.
  vagueAmounts: string[]
  // The same ingredient also appears with a unit that cannot be converted (顆 and g).
  unitConflict: boolean
}

type ToolSummaryRow = {
  key: string
  tool: string
  variants: string[]
  unit: string
  note: string
  sumQty: number
}

type GroupIngredientLibraryRow = {
  id: number
  image?: DishImage
  dishName: string
  ingredient: string
  perServingQty: string
  perServingUnit: string
  totalQty: string
  totalUnit: string
  note: string
}

type GroupToolLibraryRow = {
  id: number
  tool: string
  qty: string
  unit: string
  note: string
}

type GroupData = {
  name: string
  teamName: string
  cuisineType: string
  dishes: Dish[]
  ingredientRows: IngredientRow[]
  toolRows: ToolRow[]
}

type DishImage = {
  url: string
  publicId?: string
}

type WordImageType = Exclude<IImageOptions['type'], 'svg'>

type Dish = {
  id: number
  title: string
  videoUrl: string
  images: DishImage[]
  steps: string
}

type WordExportMode = 'all' | 'single'

// Everything that is shared between users through Firestore.
type SharedState = {
  groupOrder: GroupTab[]
  groupData: Record<GroupTab, GroupData>
  ingredientAdjustments: Record<string, string>
  toolAdjustments: Record<string, string>
  toolLibrary: string[]
  ingredientLibrary: string[]
  preparedSummaryIngredients: Record<string, boolean>
  preparedSummaryTools: Record<string, boolean>
  preparedGroupIngredients: Record<string, boolean>
  preparedGroupTools: Record<string, boolean>
  shoppingStores: ShoppingStore[]
  priceBook: PriceEntry[]
  // Starting price batches already added to priceBook (see normalizePriceBook).
  priceSeedsApplied: string[]
  // Admin-defined spellings to merge in summaries: normalized variant -> canonical name.
  ingredientAliases: Record<string, string>
  toolAliases: Record<string, string>
  // Suggested merges an admin said are different things.
  dismissedNamePairs: string[]
  // Ingredient translations ("zh:番茄" -> "Tomato", "en:tomato" -> "番茄"), machine-made or corrected by admins.
  nameTranslations: Record<string, string>
}

// `data` is what this client shows; `base` is the last cloud state it saw (null = never synced).
// Unsynced edits are exactly the difference between the two.
type SyncState = {
  data: SharedState
  base: SharedState | null
  baseRev: number
}

type PersistedState = SyncState & {
  currentTab: TabName
}

type GroupNeed = {
  groupId: GroupTab
  groupName: string
  qty: number
  dishTitles: string[]
}

type ShoppingIngredientOverviewRow = {
  ingredient: string
  requiredTotal: number
  totalUnit: string
  requiredDisplay: string
  note: string
  category: string
  groupNeeds: GroupNeed[]
  suggestion: Suggestion
  assignedStoreId: number | null
  assignedStoreName: string | null
}

type LightboxItem = {
  url: string
  caption: string
}

type Lightbox = {
  title: string
  items: LightboxItem[]
  // Present only when the viewer may remove the (single) photo being shown.
  onRemove?: () => void
}

type GroupStatus = {
  filledCount: number
  missingCount: number
}

// Written once a day by /api/update-prices into projects/<id>--prices.
type MarketPrices = {
  updatedAt: string
  produceDate: string
  produce: Array<{ ingredient: string; price: number; wholesalePerKg: number; volumeKg: number }>
  products: Record<string, { price: number; name: string; inStock: boolean; fetchedAt: string; url: string }>
  errors: string[]
}

const normalizeMarketPrices = (raw: Record<string, unknown>): MarketPrices => ({
  updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  produceDate: typeof raw.produceDate === 'string' ? raw.produceDate : '',
  produce: Array.isArray(raw.produce)
    ? raw.produce.filter(
        (item): item is MarketPrices['produce'][number] =>
          Boolean(item) && typeof item.ingredient === 'string' && Number(item.price) > 0,
      )
    : [],
  // Older runs stored 全聯 results as "pxmart".
  products: ((raw.products ?? raw.pxmart) && typeof (raw.products ?? raw.pxmart) === 'object'
    ? (raw.products ?? raw.pxmart)
    : {}) as MarketPrices['products'],
  errors: Array.isArray(raw.errors) ? raw.errors.filter((item): item is string => typeof item === 'string') : [],
})

// Where to look a product up, per shop that supports automatic prices.
const PRODUCT_SHOPS: Partial<Record<StoreKind, { search: string; example: string }>> = {
  全聯: { search: 'https://shop.pxgo.com.tw/hourArrive/search/result?q=', example: 'https://shop.pxgo.com.tw/hourArrive/goods/…' },
  萬家福: { search: 'https://online.uni-prosperity.com.tw/zh/search?q=', example: 'https://online.uni-prosperity.com.tw/zh/…/….html' },
}

const isProductLink = (value: string): boolean =>
  /^https:\/\/shop\.pxgo\.com\.tw\/hourArrive\/goods\/[\w-]+\/?$/.test(value.trim()) ||
  /^https:\/\/pxbox\.es\.pxmart\.com\.tw\/product\/\d+\/?$/.test(value.trim()) ||
  /^https:\/\/online\.uni-prosperity\.com\.tw\/zh\/[^/]+\/[A-Z0-9]{8,}\.html$/.test(value.trim())

type GroupCollapseState = {
  dishCollapsedById: Record<number, boolean>
  toolsCollapsed: boolean
  groupIngredientTableCollapsed: boolean
  groupToolTableCollapsed: boolean
}

const EMPTY_COLLAPSE_STATE: GroupCollapseState = {
  dishCollapsedById: {},
  toolsCollapsed: false,
  groupIngredientTableCollapsed: false,
  groupToolTableCollapsed: false,
}

const normalizeIngredientLibrary = (input: unknown): string[] => {
  if (!Array.isArray(input)) {
    return []
  }

  const unique = new Map<string, string>()
  const blocked = new Set(INGREDIENT_LIBRARY_BLOCKLIST)

  input.forEach((item) => {
    if (typeof item !== 'string') {
      return
    }

    const trimmed = item.trim()
    if (!trimmed || blocked.has(trimmed)) {
      return
    }

    const key = trimmed.toLowerCase()
    if (!unique.has(key)) {
      unique.set(key, trimmed)
    }
  })

  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

// Seeds are only used when no library has been saved yet, so admin deletions stay deleted.
const normalizeIngredientLibraryWithSeed = (input: unknown): string[] => {
  return normalizeIngredientLibrary(Array.isArray(input) ? input : INGREDIENT_LIBRARY_SEED)
}

const normalizeToolLibraryWithSeed = (input: unknown): string[] => {
  return normalizeToolLibrary(Array.isArray(input) ? input : TOOL_LIBRARY_SEED)
}

const normalizeToolLibrary = (input: unknown): string[] => {
  if (!Array.isArray(input)) {
    return []
  }

  const unique = new Map<string, string>()

  input.forEach((item) => {
    if (typeof item !== 'string') {
      return
    }

    const trimmed = item.trim()
    if (!trimmed) {
      return
    }

    const key = trimmed.toLowerCase()
    if (!unique.has(key)) {
      unique.set(key, trimmed)
    }
  })

  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

const emptyIngredientRow = (id: number, dishId: number): IngredientRow => ({
  id,
  dishId,
  ingredient: '',
  perServingQty: '',
  perServingUnit: '',
  totalQty: '',
  totalUnit: '',
  note: '',
})

const isBlankIngredientRow = (row: IngredientRow): boolean =>
  !row.image &&
  ![row.ingredient, row.perServingQty, row.perServingUnit, row.totalQty, row.totalUnit, row.note].some((value) =>
    value.trim(),
  )

const emptyToolRow = (id: number): ToolRow => ({
  id,
  tool: '',
  qty: '',
  unit: '',
  note: '',
})

const emptyDish = (id: number): Dish => ({
  id,
  title: '',
  videoUrl: '',
  images: [],
  steps: '',
})

const normalizeDishTitle = (title: unknown): string => {
  if (typeof title !== 'string') {
    return ''
  }

  const trimmed = title.trim()
  // Migrate legacy placeholder titles like "料理1"/"料理2"/"料理3" back to empty.
  if (/^料理[1-3]$/.test(trimmed)) {
    return ''
  }

  return title
}

const normalizeDishSteps = (steps: unknown): string => {
  return typeof steps === 'string' ? steps : ''
}

const isDishContentEmpty = (dish: Dish): boolean => {
  return !dish.title.trim() && !dish.videoUrl.trim() && dish.images.length === 0 && !dish.steps.trim()
}

const normalizeDishImage = (value: unknown): DishImage | null => {
  if (typeof value === 'string') {
    const url = value.trim()
    if (!url) {
      return null
    }
    return { url }
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const imageObj = value as Record<string, unknown>
  const url = typeof imageObj.url === 'string' ? imageObj.url.trim() : ''
  if (!url) {
    return null
  }

  return typeof imageObj.publicId === 'string' ? { url, publicId: imageObj.publicId } : { url }
}

const uniqueDishImages = (images: DishImage[]): DishImage[] => {
  const seen = new Set<string>()
  const result: DishImage[] = []

  for (const image of images) {
    const normalized = normalizeDishImage(image)
    if (!normalized) {
      continue
    }

    if (seen.has(normalized.url)) {
      continue
    }

    seen.add(normalized.url)
    result.push(normalized)
  }

  return result
}

const toNumber = (value: string): number => {
  const fraction = value.trim().match(/^(\d+)\/(\d+)$/)
  const parsed = fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// "6" + "顆" -> "6顆", used wherever an amount is shown as one piece of text.
const formatAmount = (qty: string, unit: string): string => `${qty.trim()}${unit.trim()}`

const formatNumber = (value: number): string => {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

const normalizeUrlInput = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`
  }

  return trimmed
}

const toValidHttpUrl = (value: string): URL | null => {
  const normalized = normalizeUrlInput(value)
  if (!normalized) {
    return null
  }

  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const getYouTubeThumbnailUrl = (parsed: URL): string | null => {
  const host = parsed.hostname.toLowerCase()
  let videoId: string | null = null

  if (host.includes('youtube.com')) {
    videoId = parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1] ?? null
  } else if (host === 'youtu.be') {
    videoId = parsed.pathname.replace(/^\/+/, '') || null
  }

  return videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null
}

const isICookRecipeUrl = (parsed: URL): boolean => {
  const host = parsed.hostname.toLowerCase()
  return host.includes('icook.tw') && /^\/recipes\/\d+/.test(parsed.pathname)
}

const fetchRecipeThumbnailFromApi = async (
  recipeUrl: string,
  signal?: AbortSignal,
): Promise<string | null> => {
  try {
    const response = await fetch(`/api/recipe-thumbnail?url=${encodeURIComponent(recipeUrl)}`, { signal })
    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as { thumbnailUrl?: unknown }
    if (typeof payload.thumbnailUrl !== 'string') {
      return null
    }

    const trimmed = payload.thumbnailUrl.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

const getThumbnailPreviewUrl = (
  urlValue: string,
  resolvedByUrl: Record<string, string>,
  failedByUrl: Record<string, boolean>,
): string | null => {
  const parsed = toValidHttpUrl(urlValue)
  if (!parsed) {
    return null
  }

  const path = parsed.pathname
  const normalizedUrl = parsed.toString()

  if (resolvedByUrl[normalizedUrl]) {
    return resolvedByUrl[normalizedUrl]
  }

  // For iCook links, use API-fetched metadata first; fallback to webpage thumbnail only on API failure.
  if (isICookRecipeUrl(parsed)) {
    const recipeId = path.match(/^\/recipes\/(\d+)/)?.[1]
    const knownICookThumbnailById: Record<string, string> = {
      '488525':
        'https://imgproxy.icook.network/safe/rt:fit/w:1200/el:0/q:80/plain/http://tokyo-kitchen.icook.tw.s3.amazonaws.com/uploads/recipe/cover/488525/6730c04dba3d8d2d.jpg',
    }

    if (recipeId && knownICookThumbnailById[recipeId]) {
      return knownICookThumbnailById[recipeId]
    }

    if (failedByUrl[normalizedUrl]) {
      return null
    }

    return null
  }

  return null
}

const createEmptyGroup = (name: string, idSeed: number): GroupData => {
  const dishes = Array.from({ length: MIN_DISH_COUNT }, (_, dishIndex) => emptyDish(idSeed + 201 + dishIndex))
  return {
    name,
    teamName: '',
    cuisineType: '',
    dishes,
    ingredientRows: dishes.map((dish, dishIndex) => emptyIngredientRow(idSeed + 1 + dishIndex, dish.id)),
    toolRows: [emptyToolRow(idSeed + 101), emptyToolRow(idSeed + 102)],
  }
}

// Legacy groups keep their original id offsets so fallback ids stay stable.
const getGroupIdOffset = (groupId: GroupTab, orderIndex: number): number => {
  const legacyIndex = DEFAULT_GROUP_IDS.indexOf(groupId)
  return (legacyIndex >= 0 ? legacyIndex + 1 : 100 + orderIndex) * 1000
}

// Ids below this were generated from group offsets (e.g. 2201); user-added ones use Date.now().
const LEGACY_DEFAULT_ID_LIMIT = 1_000_000

// Duplicate ids break React keys (a stale card leaked into every group) and id-based merging.
// Exact copies are dropped; a different item sharing an id gets a new, deterministic id.
const dedupeById = <T extends { id: number }>(items: T[]): T[] => {
  const seen = new Map<number, T>()
  const result: T[] = []

  items.forEach((item, index) => {
    const existing = seen.get(item.id)
    if (!existing) {
      seen.set(item.id, item)
      result.push(item)
      return
    }

    if (deepEqual(existing, item)) {
      return
    }

    let nextId = item.id * 100 + index
    while (seen.has(nextId)) {
      nextId += 1
    }
    const renumbered = { ...item, id: nextId }
    seen.set(nextId, renumbered)
    result.push(renumbered)
  })

  return result
}

const normalizeGroup = (source: unknown, groupId: GroupTab, groupOffset: number): GroupData => {
  if (!source || typeof source !== 'object') {
    return createEmptyGroup(groupId, groupOffset)
  }

  const sourceObj = source as Record<string, unknown>

  let normalizedDishes = Array.isArray(sourceObj.dishes)
    ? sourceObj.dishes.map((dish, dishIndex) => {
        const dishObj = (dish ?? {}) as Record<string, unknown>
        return {
          id: Number(dishObj.id) || groupOffset + 201 + dishIndex,
          title: normalizeDishTitle(dishObj.title),
          videoUrl: typeof dishObj.videoUrl === 'string' ? dishObj.videoUrl : '',
          images: Array.isArray(dishObj.images)
            ? uniqueDishImages(dishObj.images.map(normalizeDishImage).filter((value): value is DishImage => Boolean(value))).slice(0, 2)
            : [],
          steps: normalizeDishSteps(dishObj.steps),
        }
      })
    : []

  normalizedDishes = dedupeById(normalizedDishes)

  const legacyThirdDishId = groupOffset + 203
  const legacyThirdDish = normalizedDishes.find((dish) => dish.id === legacyThirdDishId)
  if (legacyThirdDish && isDishContentEmpty(legacyThirdDish)) {
    normalizedDishes = normalizedDishes.filter((dish) => dish.id !== legacyThirdDishId)
  }

  const rawIngredientRows: unknown[] = Array.isArray(sourceObj.ingredientRows) ? sourceObj.ingredientRows : []
  const dishIdsWithContent = new Set(
    rawIngredientRows
      .map((row) => (row ?? {}) as Record<string, unknown>)
      .filter((row) => typeof row.ingredient === 'string' && row.ingredient.trim())
      .map((row) => Number(row.dishId)),
  )
  // Old versions shifted default dish ids when groups were reordered and then merged both
  // sets back together, leaving empty "ghost" dishes in every group. Drop those ghosts.
  const ownDefaultDishIds = new Set([groupOffset + 201, groupOffset + 202, groupOffset + 203])
  normalizedDishes = normalizedDishes.filter(
    (dish) =>
      !(
        dish.id < LEGACY_DEFAULT_ID_LIMIT &&
        !ownDefaultDishIds.has(dish.id) &&
        isDishContentEmpty(dish) &&
        !dishIdsWithContent.has(dish.id)
      ),
  )

  while (normalizedDishes.length < MIN_DISH_COUNT) {
    normalizedDishes.push(emptyDish(groupOffset + 201 + normalizedDishes.length))
  }

  const normalizedIngredientRows = Array.isArray(sourceObj.ingredientRows)
    ? sourceObj.ingredientRows.map((row, rowIndex) => {
        const rowObj = (row ?? {}) as Record<string, unknown>
        const fallbackDishId =
          normalizedDishes[rowIndex % normalizedDishes.length]?.id ?? normalizedDishes[0].id
        const image = normalizeDishImage(rowObj.image)
        return {
          ...(image ? { image } : {}),
          id: Number(rowObj.id) || groupOffset + 1 + rowIndex,
          dishId: Number(rowObj.dishId) || fallbackDishId,
          ingredient: typeof rowObj.ingredient === 'string' ? rowObj.ingredient : '',
          perServingQty: typeof rowObj.perServingQty === 'string' ? rowObj.perServingQty : '',
          perServingUnit: typeof rowObj.perServingUnit === 'string' ? rowObj.perServingUnit : '',
          totalQty: typeof rowObj.totalQty === 'string' ? rowObj.totalQty : '',
          totalUnit: typeof rowObj.totalUnit === 'string' ? rowObj.totalUnit : '',
          note: typeof rowObj.note === 'string' ? rowObj.note : '',
        }
      })
    : []

  const validDishIds = new Set(normalizedDishes.map((dish) => dish.id))

  const normalizedToolRows = Array.isArray(sourceObj.toolRows)
    ? sourceObj.toolRows.map((row, rowIndex) => {
        const rowObj = (row ?? {}) as Record<string, unknown>
        return {
          id: Number(rowObj.id) || groupOffset + 101 + rowIndex,
          tool: typeof rowObj.tool === 'string' ? rowObj.tool : '',
          qty: typeof rowObj.qty === 'string' ? rowObj.qty : '',
          unit: typeof rowObj.unit === 'string' ? rowObj.unit : '',
          note: typeof rowObj.note === 'string' ? rowObj.note : '',
        }
      })
    : []

  return {
    name: typeof sourceObj.name === 'string' && sourceObj.name.trim() ? sourceObj.name : groupId,
    teamName: typeof sourceObj.teamName === 'string' ? sourceObj.teamName : '',
    cuisineType: typeof sourceObj.cuisineType === 'string' ? sourceObj.cuisineType : '',
    dishes: normalizedDishes,
    ingredientRows: dedupeById(normalizedIngredientRows.filter((row) => validDishIds.has(row.dishId))),
    toolRows: dedupeById(normalizedToolRows),
  }
}

const normalizeGroupOrder = (input: unknown): GroupTab[] => {
  const source = Array.isArray(input)
    ? input.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : DEFAULT_GROUP_IDS
  // The sample group always exists and always comes first.
  return [SAMPLE_GROUP_TAB, ...Array.from(new Set(source)).filter((groupId) => groupId !== SAMPLE_GROUP_TAB)]
}

const toStringRecord = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== 'object') {
    return {}
  }
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === 'string'))
}

const toBooleanRecord = (input: unknown): Record<string, boolean> => {
  if (!input || typeof input !== 'object') {
    return {}
  }
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === 'boolean'))
}

const normalizeShoppingStores = (input: unknown): ShoppingStore[] => {
  if (!Array.isArray(input)) {
    return []
  }

  const stores: ShoppingStore[] = input
    .filter((store): store is Record<string, unknown> => Boolean(store) && typeof store === 'object')
    .map((store) => ({
      id: Number(store.id) || 0,
      storeName: typeof store.storeName === 'string' ? store.storeName : '',
      items: Array.isArray(store.items)
        ? store.items
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
            .map((item) => ({
              id: Number(item.id) || 0,
              ingredient: typeof item.ingredient === 'string' ? item.ingredient : '',
              price: typeof item.price === 'string' ? item.price : '',
              ...(typeof item.ownedQty === 'string' ? { ownedQty: item.ownedQty } : {}),
              ...(typeof item.purchased === 'boolean' ? { purchased: item.purchased } : {}),
            }))
        : [],
      ...(typeof store.receiptTotal === 'string' && store.receiptTotal ? { receiptTotal: store.receiptTotal } : {}),
    }))

  return dedupeStoreItems(dedupeById(stores), normalizeNameText)
}

const normalizePriceEntries = (input: unknown[]): PriceEntry[] =>
  input
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      id: Number(entry.id) || 0,
      ingredient: typeof entry.ingredient === 'string' ? entry.ingredient : '',
      store: typeof entry.store === 'string' ? entry.store : '',
      price: typeof entry.price === 'string' ? entry.price : '',
      packQty: typeof entry.packQty === 'string' ? entry.packQty : '',
      packUnit: typeof entry.packUnit === 'string' ? entry.packUnit : '',
      spec: typeof entry.spec === 'string' ? entry.spec : '',
      ...(entry.loose === true ? { loose: true } : {}),
      ...(typeof entry.sourceUrl === 'string' && entry.sourceUrl.trim() ? { sourceUrl: entry.sourceUrl.trim() } : {}),
      ...(typeof entry.updatedAt === 'string' && entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    }))

// Each starting price batch is added once per project and remembered in priceSeedsApplied, so admin
// edits and deletions stick while newly added batches (e.g. 萬家福) still reach existing projects.
// Projects saved before batches were tracked already have the base batch.
const normalizePriceBook = (rawBook: unknown, rawApplied: unknown): { priceBook: PriceEntry[]; priceSeedsApplied: string[] } => {
  const hasSavedBook = Array.isArray(rawBook)
  const applied = new Set(
    Array.isArray(rawApplied)
      ? rawApplied.filter((value): value is string => typeof value === 'string')
      : hasSavedBook
        ? [PRICE_SEED_BATCHES[0].id]
        : [],
  )
  let priceBook = hasSavedBook ? normalizePriceEntries(rawBook) : []

  PRICE_SEED_BATCHES.forEach((batch) => {
    if (applied.has(batch.id)) {
      return
    }
    if (batch.replaces) {
      // Only starting entries nobody has edited (no updatedAt) or deleted are updated.
      const replacements = new Map(batch.entries.map((entry) => [entry.id, entry]))
      priceBook = priceBook.map((entry) => {
        const replacement = replacements.get(entry.id)
        const untouched =
          replacement && !entry.updatedAt && entry.ingredient === replacement.ingredient && entry.store === replacement.store
        return untouched ? replacement : entry
      })
    } else {
      const existingIds = new Set(priceBook.map((entry) => entry.id))
      priceBook = [...priceBook, ...batch.entries.filter((entry) => !existingIds.has(entry.id))]
    }
    applied.add(batch.id)
  })

  return { priceBook, priceSeedsApplied: Array.from(applied).sort() }
}

const normalizeSharedState = (input: unknown): SharedState => {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const groupOrder = normalizeGroupOrder(raw.groupOrder)
  const rawGroupData =
    raw.groupData && typeof raw.groupData === 'object' ? (raw.groupData as Record<string, unknown>) : {}

  return {
    groupOrder,
    groupData: Object.fromEntries(
      groupOrder.map((groupId, index) => [
        groupId,
        normalizeGroup(rawGroupData[groupId], groupId, getGroupIdOffset(groupId, index)),
      ]),
    ),
    ingredientAdjustments: toStringRecord(raw.ingredientAdjustments),
    toolAdjustments: toStringRecord(raw.toolAdjustments),
    toolLibrary: normalizeToolLibraryWithSeed(raw.toolLibrary),
    ingredientLibrary: normalizeIngredientLibraryWithSeed(raw.ingredientLibrary),
    preparedSummaryIngredients: toBooleanRecord(raw.preparedSummaryIngredients),
    preparedSummaryTools: toBooleanRecord(raw.preparedSummaryTools),
    preparedGroupIngredients: toBooleanRecord(raw.preparedGroupIngredients),
    preparedGroupTools: toBooleanRecord(raw.preparedGroupTools),
    shoppingStores: normalizeShoppingStores(raw.shoppingStores),
    ...normalizePriceBook(raw.priceBook, raw.priceSeedsApplied),
    ingredientAliases: toStringRecord(raw.ingredientAliases),
    toolAliases: toStringRecord(raw.toolAliases),
    nameTranslations: toStringRecord(raw.nameTranslations),
    dismissedNamePairs: Array.isArray(raw.dismissedNamePairs)
      ? raw.dismissedNamePairs.filter((value): value is string => typeof value === 'string')
      : [],
  }
}

const createInitialSharedState = (): SharedState => normalizeSharedState({})

const getRemoteRev = (raw: Record<string, unknown>): number => (typeof raw.rev === 'number' ? raw.rev : 0)

const compressImageFile = (file: File, maxSize = 1280, quality = 0.82): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const imageElement = new Image()
    const objectUrl = URL.createObjectURL(file)

    imageElement.onload = () => {
      const ratio = Math.min(1, maxSize / imageElement.width, maxSize / imageElement.height)
      const targetWidth = Math.max(1, Math.round(imageElement.width * ratio))
      const targetHeight = Math.max(1, Math.round(imageElement.height * ratio))

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight

      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('無法建立圖片壓縮畫布'))
        return
      }

      context.drawImage(imageElement, 0, 0, targetWidth, targetHeight)
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl)
          if (!blob) {
            reject(new Error('圖片壓縮失敗'))
            return
          }

          resolve(blob)
        },
        'image/jpeg',
        quality,
      )
    }

    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('圖片讀取失敗'))
    }

    imageElement.src = objectUrl
  })
}

const getUploadErrorMessage = (error: unknown, t: (text: string, params?: Array<string | number>) => string): string => {
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  const errorDetail =
    typeof error === 'object' && error !== null && 'detail' in error
      ? String((error as { detail: unknown }).detail)
      : ''

  if (errorCode === 'cloudinary-not-configured') {
    return t('尚未設定 Cloudinary，上傳功能不可用。')
  }

  if (errorCode === 'upload-timeout' || errorCode === 'upload-no-progress') {
    return t('圖片上傳逾時或長時間無進度，請檢查網路後重試。')
  }

  if (errorCode === 'cloudinary-upload-failed') {
    return errorDetail
      ? t('Cloudinary 上傳失敗：{0}', [errorDetail])
      : t('Cloudinary 上傳失敗，請確認 Upload Preset 設定允許 unsigned upload。')
  }

  return errorCode ? t('圖片上傳失敗（{0}），請稍後再試。', [errorCode]) : t('圖片上傳失敗，請稍後再試。')
}

const uploadCompressedImage = (
  blob: Blob,
  onProgress: (ratio: number) => void,
  timeoutMs = 20000,
): Promise<DishImage> => {
  return new Promise((resolve, reject) => {
    if (!isCloudinaryConfigured) {
      reject({ code: 'cloudinary-not-configured' })
      return
    }

    let settled = false
    let hasProgress = false

    const safeReject = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    const safeResolve = (value: DishImage) => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }

    const formData = new FormData()
    formData.append('file', blob)
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
    formData.append('folder', `foodsheets/${firebaseProjectDocId}`)

    const xhr = new XMLHttpRequest()

    const timeout = window.setTimeout(() => {
      safeReject({ code: 'upload-timeout' })
      xhr.abort()
    }, timeoutMs)

    const noProgressTimeout = window.setTimeout(() => {
      if (!hasProgress) {
        safeReject({ code: 'upload-no-progress' })
        xhr.abort()
      }
    }, 8000)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) {
        onProgress(0)
        return
      }
      if (event.loaded > 0) {
        hasProgress = true
      }
      onProgress(event.loaded / event.total)
    }

    xhr.onerror = () => {
      window.clearTimeout(timeout)
      window.clearTimeout(noProgressTimeout)
      safeReject({ code: 'cloudinary-upload-failed' })
    }

    xhr.onabort = () => {
      window.clearTimeout(timeout)
      window.clearTimeout(noProgressTimeout)
      safeReject({ code: 'upload-timeout' })
    }

    xhr.onload = () => {
      window.clearTimeout(timeout)
      window.clearTimeout(noProgressTimeout)
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = ''
        try {
          const response = JSON.parse(xhr.responseText) as { error?: { message?: string } }
          detail = response.error?.message ?? ''
        } catch {
          detail = ''
        }
        safeReject({ code: 'cloudinary-upload-failed', detail })
        return
      }

      try {
        const response = JSON.parse(xhr.responseText) as { secure_url?: string; public_id?: string }
        if (!response.secure_url) {
          safeReject({ code: 'cloudinary-upload-failed', detail: 'Cloudinary 未回傳 secure_url。' })
          return
        }
        safeResolve({
          url: response.secure_url,
          publicId: typeof response.public_id === 'string' ? response.public_id : undefined,
        })
      } catch {
        safeReject({ code: 'cloudinary-upload-failed' })
      }
    }

    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`)
    xhr.send(formData)
  })
}

const extractPublicIdFromCloudinaryUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    const marker = '/upload/'
    const markerIndex = parsed.pathname.indexOf(marker)
    if (markerIndex === -1) {
      return null
    }

    let rest = parsed.pathname.slice(markerIndex + marker.length)
    if (rest.startsWith('v')) {
      const slashIndex = rest.indexOf('/')
      if (slashIndex !== -1) {
        const version = rest.slice(0, slashIndex)
        if (/^v\d+$/.test(version)) {
          rest = rest.slice(slashIndex + 1)
        }
      }
    }

    rest = rest.replace(/^\/+/, '')
    if (!rest) {
      return null
    }

    return rest.replace(/\.[^/.]+$/, '')
  } catch {
    return null
  }
}

const deleteCloudinaryByPublicId = async (publicId: string): Promise<{ ok: boolean; message?: string }> => {
  if (!publicId) {
    return { ok: false, message: '缺少 publicId' }
  }

  const response = await fetch('/api/cloudinary-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publicId }),
  })

  if (response.ok) {
    return { ok: true }
  }

  try {
    const payload = (await response.json()) as { error?: string }
    return { ok: false, message: payload.error || `HTTP ${response.status}` }
  } catch {
    return { ok: false, message: `HTTP ${response.status}` }
  }
}

const collectCloudinaryPublicIds = (
  data: Record<GroupTab, GroupData>,
  groupIds: GroupTab[] = Object.keys(data),
): string[] => {
  const ids = new Set<string>()

  groupIds.forEach((groupId) => {
    const group = data[groupId]
    if (!group) {
      return
    }

    const images = [
      ...group.dishes.flatMap((dish) => dish.images),
      ...group.ingredientRows.flatMap((row) => (row.image ? [row.image] : [])),
    ]

    images.forEach((image) => {
      const publicId = image.publicId?.trim() || extractPublicIdFromCloudinaryUrl(image.url)
      if (publicId) {
        ids.add(publicId)
      }
    })
  })

  return Array.from(ids)
}

const deleteCloudinaryAssetsForReset = async (
  groupDataForDelete: Record<GroupTab, GroupData>,
): Promise<{ ok: boolean; message?: string }> => {
  const nonSampleGroupIds = Object.keys(groupDataForDelete).filter((groupId) => groupId !== SAMPLE_GROUP_TAB)
  const publicIds = collectCloudinaryPublicIds(groupDataForDelete, nonSampleGroupIds)
  const excludedPublicIds = collectCloudinaryPublicIds(groupDataForDelete, [SAMPLE_GROUP_TAB])
  const response = await fetch('/api/cloudinary-delete-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prefix: `foodsheets/${firebaseProjectDocId}`,
      publicIds,
      excludePublicIds: excludedPublicIds,
    }),
  })

  if (response.ok) {
    return { ok: true }
  }

  try {
    const payload = (await response.json()) as { error?: string }
    return { ok: false, message: payload.error ?? `HTTP ${response.status}` }
  } catch {
    return { ok: false, message: `HTTP ${response.status}` }
  }
}

// Fresh default groups, but the sample group survives a reset.
const createHardResetSharedState = (source: SharedState): SharedState => {
  const fresh = createInitialSharedState()
  return {
    ...fresh,
    groupData: {
      ...fresh.groupData,
      [SAMPLE_GROUP_TAB]: source.groupData[SAMPLE_GROUP_TAB] ?? fresh.groupData[SAMPLE_GROUP_TAB],
    },
  }
}

type UiPrefs = {
  lang: Lang
  navCollapsed: boolean
}

const UI_PREFS_KEY = 'foodsheets.ui'

const loadUiPrefs = (): UiPrefs => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(UI_PREFS_KEY) ?? '{}') as Record<string, unknown>
    return { lang: raw.lang === 'en' ? 'en' : 'zh', navCollapsed: raw.navCollapsed === true }
  } catch {
    return { lang: 'zh', navCollapsed: false }
  }
}

// Canonical ingredient name: English names are first turned into their Chinese ingredient
// (tomato -> 番茄), then aliases and spelling rules apply, so both languages add up together.
const resolveIngredientName = (name: string, aliases: Record<string, string>, learned: Record<string, string>) =>
  canonicalName((isEnglishName(name) && englishToChinese(name, learned)) || name, aliases, BUILTIN_INGREDIENT_ALIASES)

// Same for tools: Frying pan -> 平底鍋, then 煎鍋 -> 平底鍋 and the other aliases.
const resolveToolName = (name: string, aliases: Record<string, string>, learned: Record<string, string>) =>
  canonicalName((isEnglishName(name) && toolEnglishToChinese(name, learned)) || name, aliases, BUILTIN_TOOL_ALIASES)

type NameTranslator = {
  toChinese: (name: string, learned: Record<string, string>) => string | null
  toEnglish: (name: string, learned: Record<string, string>) => string | null
  builtin: Record<string, string>
}
const INGREDIENT_TRANSLATOR: NameTranslator = { toChinese: englishToChinese, toEnglish: chineseToEnglish, builtin: BUILTIN_ZH_EN }
const TOOL_TRANSLATOR: NameTranslator = { toChinese: toolEnglishToChinese, toEnglish: toolChineseToEnglish, builtin: BUILTIN_TOOL_ZH_EN }

// Short label for the collapsed sidebar, in whatever language the name is shown in:
// 第一組 -> 一, 學長姐組 -> 學長, Group 1 -> 1, Sample group -> SG.
const CHINESE_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

// 一 … 九十九 -> number, anything else -> null.
const chineseNumber = (text: string): number | null => {
  const match = text.match(/^([一二兩三四五六七八九]?)(十?)([一二三四五六七八九]?)$/)
  if (!match || !text) {
    return null
  }
  const [, tensOrOnes, ten, ones] = match
  if (!ten) {
    return ones ? null : CHINESE_DIGITS[tensOrOnes]
  }
  return (tensOrOnes ? CHINESE_DIGITS[tensOrOnes] : 1) * 10 + (ones ? CHINESE_DIGITS[ones] : 0)
}

const shortGroupLabel = (name: string): string => {
  const digits = name.match(/\d+/)?.[0]
  if (digits) {
    return digits
  }
  if (/[㐀-鿿]/.test(name)) {
    const core = name.replace(/^第/, '').replace(/組$/, '').trim() || name
    // 第一組 -> 1, 第十二組 -> 12: a lone 一 reads like a dash in the narrow rail.
    const numeral = chineseNumber(core)
    if (numeral !== null) {
      return String(numeral)
    }
    return Array.from(core).slice(0, 2).join('')
  }
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join('') : name.trim().slice(0, 2)).toUpperCase()
}

const loadPersistedState = (): PersistedState | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const currentTab = typeof parsed.currentTab === 'string' ? parsed.currentTab : SAMPLE_GROUP_TAB

    // Older versions stored the shared fields at the top level and had no sync base.
    if (!parsed.data) {
      return parsed.groupData
        ? { currentTab, data: normalizeSharedState(parsed), base: null, baseRev: 0 }
        : null
    }

    return {
      currentTab,
      data: normalizeSharedState(parsed.data),
      base: parsed.base ? normalizeSharedState(parsed.base) : null,
      baseRev: typeof parsed.baseRev === 'number' ? parsed.baseRev : 0,
    }
  } catch {
    return null
  }
}

const inferDocxImageType = (url: string, contentType: string | null): WordImageType => {
  const normalizedType = (contentType ?? '').toLowerCase()
  if (normalizedType.includes('png')) {
    return 'png'
  }
  if (normalizedType.includes('gif')) {
    return 'gif'
  }
  if (normalizedType.includes('bmp')) {
    return 'bmp'
  }

  const normalizedUrl = url.toLowerCase()
  if (normalizedUrl.endsWith('.png')) {
    return 'png'
  }
  if (normalizedUrl.endsWith('.gif')) {
    return 'gif'
  }
  if (normalizedUrl.endsWith('.bmp')) {
    return 'bmp'
  }

  return 'jpg'
}

const fetchImageForDocx = async (
  url: string,
): Promise<{ data: Uint8Array; type: WordImageType } | null> => {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength === 0) {
      return null
    }

    return {
      data: new Uint8Array(arrayBuffer),
      type: inferDocxImageType(url, response.headers.get('Content-Type')),
    }
  } catch {
    return null
  }
}

const downloadBlobFile = (blob: Blob, fileName: string) => {
  const link = document.createElement('a')
  const objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(objectUrl)
}

const sanitizeFileName = (value: string): string => {
  return value.replace(/[<>:"/\\|?*]/g, '_').trim()
}

function App() {
  const persistedState = useMemo(loadPersistedState, [])
  const [currentTab, setCurrentTab] = useState<TabName>(persistedState?.currentTab ?? SAMPLE_GROUP_TAB)
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(loadUiPrefs)
  const { lang, navCollapsed } = uiPrefs
  const t = useCallback(
    (text: string, params?: Record<string, string | number> | Array<string | number>) => translate(lang, text, params),
    [lang],
  )
  const [syncState, setSyncState] = useState<SyncState>(() => ({
    data: persistedState?.data ?? createInitialSharedState(),
    base: persistedState?.base ?? null,
    baseRev: persistedState?.baseRev ?? 0,
  }))
  const {
    groupOrder,
    groupData,
    ingredientAdjustments,
    toolAdjustments,
    toolLibrary,
    ingredientLibrary,
    preparedSummaryIngredients,
    preparedSummaryTools,
    preparedGroupIngredients,
    preparedGroupTools,
    shoppingStores,
    priceBook,
    ingredientAliases,
    toolAliases,
    dismissedNamePairs,
    nameTranslations,
  } = syncState.data

  // Per-field setters over the single shared state, so call sites read like plain useState setters.
  const sharedFieldSetter =
    <K extends keyof SharedState>(key: K) =>
    (action: SetStateAction<SharedState[K]>) => {
      setSyncState((previous) => {
        const current = previous.data[key]
        const next =
          typeof action === 'function' ? (action as (value: SharedState[K]) => SharedState[K])(current) : action
        return next === current ? previous : { ...previous, data: { ...previous.data, [key]: next } }
      })
    }
  const setGroupOrder = sharedFieldSetter('groupOrder')
  const setGroupData = sharedFieldSetter('groupData')
  const setIngredientAdjustments = sharedFieldSetter('ingredientAdjustments')
  const setToolAdjustments = sharedFieldSetter('toolAdjustments')
  const setToolLibrary = sharedFieldSetter('toolLibrary')
  const setIngredientLibrary = sharedFieldSetter('ingredientLibrary')
  const setPreparedSummaryIngredients = sharedFieldSetter('preparedSummaryIngredients')
  const setPreparedSummaryTools = sharedFieldSetter('preparedSummaryTools')
  const setPreparedGroupIngredients = sharedFieldSetter('preparedGroupIngredients')
  const setPreparedGroupTools = sharedFieldSetter('preparedGroupTools')
  const setShoppingStores = sharedFieldSetter('shoppingStores')
  const setPriceBook = sharedFieldSetter('priceBook')
  const setIngredientAliases = sharedFieldSetter('ingredientAliases')
  const setToolAliases = sharedFieldSetter('toolAliases')
  const setDismissedNamePairs = sharedFieldSetter('dismissedNamePairs')
  const setNameTranslations = sharedFieldSetter('nameTranslations')

  const [groupCollapseState, setGroupCollapseState] = useState<Record<GroupTab, GroupCollapseState>>({})
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminPasscode, setAdminPasscode] = useState('')
  const [adminError, setAdminError] = useState('')
  const [showHardResetPanel, setShowHardResetPanel] = useState(false)
  const [resetConfirmPhrase, setResetConfirmPhrase] = useState('')
  const [resetConfirmPasscode, setResetConfirmPasscode] = useState('')
  const [resetAcknowledged, setResetAcknowledged] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetCooldownSeconds, setResetCooldownSeconds] = useState(0)
  const [toolLibraryInput, setToolLibraryInput] = useState('')
  const [toolLibraryError, setToolLibraryError] = useState('')
  const [libraryInput, setLibraryInput] = useState('')
  const [libraryError, setLibraryError] = useState('')
  const [uploadingDishIds, setUploadingDishIds] = useState<Record<number, boolean>>({})
  const [uploadProgressByDish, setUploadProgressByDish] = useState<Record<number, number>>({})
  const [dragOverDishId, setDragOverDishId] = useState<number | null>(null)
  const [uploadingRowIds, setUploadingRowIds] = useState<Record<number, boolean>>({})
  const [quickAddDrafts, setQuickAddDrafts] = useState<Record<number, string>>({})
  const [quickAddNotices, setQuickAddNotices] = useState<Record<number, string>>({})
  const [lightbox, setLightbox] = useState<Lightbox | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [resolvedThumbnailByUrl, setResolvedThumbnailByUrl] = useState<Record<string, string>>({})
  const [thumbnailFetchFailedByUrl, setThumbnailFetchFailedByUrl] = useState<Record<string, boolean>>({})
  const [imageUploadError, setImageUploadError] = useState('')
  const [wordExportError, setWordExportError] = useState('')
  const [exportingWord, setExportingWord] = useState(false)
  const [showWordExportOptions, setShowWordExportOptions] = useState(false)
  const [wordExportMode, setWordExportMode] = useState<WordExportMode>('all')
  const [selectedDishIdForWord, setSelectedDishIdForWord] = useState<number | null>(null)
  const [shoppingOverviewExpanded, setShoppingOverviewExpanded] = useState(true)
  const [shoppingOverviewFilter, setShoppingOverviewFilter] = useState<'unassigned' | 'all'>('unassigned')
  const [shoppingOverviewQuery, setShoppingOverviewQuery] = useState('')
  const [copiedStoreId, setCopiedStoreId] = useState<number | null>(null)
  const [shoppingModeStoreId, setShoppingModeStoreId] = useState<number | null>(null)
  const [shoppingModeHideDone, setShoppingModeHideDone] = useState(false)
  const [priceQuery, setPriceQuery] = useState('')
  const [marketPrices, setMarketPrices] = useState<MarketPrices | null>(null)
  const [priceUpdating, setPriceUpdating] = useState(false)
  const [priceUpdateMessage, setPriceUpdateMessage] = useState('')
  const [aliasDraft, setAliasDraft] = useState({ from: '', to: '' })
  const [translationsExpanded, setTranslationsExpanded] = useState<Record<string, boolean>>({})
  const [remoteReady, setRemoteReady] = useState(false)
  const [syncRetryTick, setSyncRetryTick] = useState(0)
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured
      ? '雲端同步初始化中…'
      : '尚未設定 Firebase，目前僅本機保存（缺少：{0}）',
  )

  const writeInFlightRef = useRef(false)
  const thumbnailInFlightRef = useRef<Set<string>>(new Set())
  const dangerHoldTimerRef = useRef<number | null>(null)

  const nonSampleGroupIds = useMemo(
    () => groupOrder.filter((groupId) => groupId !== SAMPLE_GROUP_TAB),
    [groupOrder],
  )
  const isGroupTab = (tab: TabName) => groupOrder.includes(tab)
  const getGroupName = (groupId: GroupTab) => t(groupData[groupId]?.name || groupId)
  const getCollapse = (groupId: GroupTab) => groupCollapseState[groupId] ?? EMPTY_COLLAPSE_STATE

  const activeGroup: GroupTab = isGroupTab(currentTab) ? currentTab : (groupOrder[1] ?? SAMPLE_GROUP_TAB)
  const isActiveGroupSample = activeGroup === SAMPLE_GROUP_TAB
  const canEditActiveGroup = !isActiveGroupSample || adminUnlocked

  const activeIngredientRows = groupData[activeGroup].ingredientRows
  const activeToolRows = groupData[activeGroup].toolRows
  const activeDishes = groupData[activeGroup].dishes

  useEffect(() => {
    const firstDishId = activeDishes[0]?.id ?? null
    if (selectedDishIdForWord === null) {
      setSelectedDishIdForWord(firstDishId)
      return
    }

    const hasSelectedDish = activeDishes.some((dish) => dish.id === selectedDishIdForWord)
    if (!hasSelectedDish) {
      setSelectedDishIdForWord(firstDishId)
    }
  }, [activeDishes, selectedDishIdForWord])

  useEffect(() => {
    const candidateUrls = new Set<string>()

    groupOrder.forEach((groupName) => {
      groupData[groupName].dishes.forEach((dish) => {
        const parsed = toValidHttpUrl(normalizeUrlInput(dish.videoUrl))
        if (parsed && isICookRecipeUrl(parsed)) {
          candidateUrls.add(parsed.toString())
        }
      })
    })

    const pendingUrls = Array.from(candidateUrls).filter(
      (url) =>
        !resolvedThumbnailByUrl[url] &&
        !thumbnailFetchFailedByUrl[url] &&
        !thumbnailInFlightRef.current.has(url),
    )

    if (pendingUrls.length === 0) {
      return
    }

    const controller = new AbortController()

    pendingUrls.forEach((url) => {
      thumbnailInFlightRef.current.add(url)
      void fetchRecipeThumbnailFromApi(url, controller.signal)
        .then((thumbnailUrl) => {
          if (controller.signal.aborted) {
            return
          }

          if (thumbnailUrl) {
            setResolvedThumbnailByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: thumbnailUrl }))
          } else {
            setThumbnailFetchFailedByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: true }))
          }
        })
        .finally(() => {
          thumbnailInFlightRef.current.delete(url)
        })
    })

    return () => {
      controller.abort()
    }
  }, [groupData, groupOrder, resolvedThumbnailByUrl, thumbnailFetchFailedByUrl])

  const allIngredientRows = useMemo(
    () => nonSampleGroupIds.flatMap((groupId) => groupData[groupId].ingredientRows),
    [groupData, nonSampleGroupIds],
  )

  const allToolRows = useMemo(
    () => nonSampleGroupIds.flatMap((groupId) => groupData[groupId].toolRows),
    [groupData, nonSampleGroupIds],
  )

  const canonicalIngredient = (name: string) => resolveIngredientName(name, ingredientAliases, nameTranslations)

  const canonicalTool = (name: string) => resolveToolName(name, toolAliases, nameTranslations)

  // A name in the language being shown: 番茄 reads "Tomato" in English mode, and an English name
  // reads in Chinese in Chinese mode, when a translation is known.
  const nameLabel = (name: string, resolve: typeof canonicalIngredient, translator: NameTranslator) => {
    const display = resolve(name).display || name.trim()
    if (lang === 'en') {
      return isChineseName(display) ? (translator.toEnglish(display, nameTranslations) ?? display) : display
    }
    return isEnglishName(display) ? (translator.toChinese(display, nameTranslations) ?? display) : display
  }
  const ingredientLabel = (name: string) => nameLabel(name, canonicalIngredient, INGREDIENT_TRANSLATOR)
  const toolLabel = (name: string) => nameLabel(name, canonicalTool, TOOL_TRANSLATOR)

  // Small hint under an entry cell: what a typed English name counts as (Dragonfruit → 火龍果), otherwise
  // the name in the current language. Empty when it would only repeat what was typed.
  const nameHint = (name: string, resolve: typeof canonicalIngredient, label: (name: string) => string) => {
    const typed = name.trim()
    const hint = isEnglishName(typed) ? resolve(name).display : label(name)
    return typed && hint !== typed ? hint : ''
  }
  const entryHint = (name: string) => nameHint(name, canonicalIngredient, ingredientLabel)
  const toolEntryHint = (name: string) => nameHint(name, canonicalTool, toolLabel)

  // For exports in English mode: "Tomato (番茄)" or "Tomatoes (番茄)" when it was typed in English, so the
  // shopper can still read the Chinese name.
  const bilingualName = (name: string, resolve: typeof canonicalIngredient, label: (name: string) => string) => {
    const typed = name.trim()
    if (lang !== 'en') {
      return label(name)
    }
    const english = isEnglishName(typed) ? typed : label(name)
    const chinese = resolve(name).display || typed
    return english !== chinese && isChineseName(chinese) ? `${english} (${chinese})` : english
  }
  const bilingualIngredient = (name: string) => bilingualName(name, canonicalIngredient, ingredientLabel)
  const bilingualTool = (name: string) => bilingualName(name, canonicalTool, toolLabel)
  const amountLabel = (text: string) => (lang === 'en' ? amountToEnglish(text) : text)
  // "Frying pan" and "frying  pan" are the same name; "含：…" and "統計為…" only list real differences.
  const sameName = (a: string, b: string) => cleanDisplayName(a).toLowerCase() === cleanDisplayName(b).toLowerCase()
  const renderVariants = (variants: string[], label: string) => {
    const others = variants.filter((variant) => !sameName(variant, label))
    return others.length > 0 && <span className="merged-from">{t('含：{0}', [others.join('、')])}</span>
  }

  // Totals per ingredient after unifying spellings (蕃茄 = 番茄) and units (克 = g, 1 公斤 = 1000 g).
  const ingredientSummaryRows = useMemo<IngredientSummaryRow[]>(() => {
    const map = new Map<string, IngredientSummaryRow>()
    const notesByKey = new Map<string, string[]>()

    const vagueByName = new Map<string, { display: string; amounts: string[] }>()

    allIngredientRows.forEach((row) => {
      const original = row.ingredient.trim()
      if (!original || !row.totalQty.trim()) {
        return
      }

      const name = resolveIngredientName(original, ingredientAliases, nameTranslations)
      // "適量" and other non-numbers: remembered per ingredient and shown on its main row.
      if (!/^\s*\d/.test(row.totalQty)) {
        const vague = vagueByName.get(name.key) ?? { display: name.display, amounts: [] }
        if (!vague.amounts.includes(row.totalQty.trim())) {
          vague.amounts.push(row.totalQty.trim())
        }
        vagueByName.set(name.key, vague)
        return
      }

      const total = canonicalUnit(row.totalUnit)
      const key = `${name.key}|${total.unit}`
      let target = map.get(key)
      if (!target) {
        target = {
          key,
          nameKey: name.key,
          ingredient: name.display,
          variants: [],
          perServingUnit: '',
          perServingMixed: false,
          totalUnit: total.unit,
          note: '',
          sumPerServingQty: 0,
          sumTotalQty: 0,
          vagueAmounts: [],
          unitConflict: false,
        }
        map.set(key, target)
      }

      target.sumTotalQty += toNumber(row.totalQty) * total.factor

      if (original !== name.display && !target.variants.includes(original)) {
        target.variants.push(original)
      }

      const notes = notesByKey.get(key) ?? []
      if (row.note.trim() && !notes.includes(row.note.trim())) {
        notes.push(row.note.trim())
      }
      notesByKey.set(key, notes)

      if (row.perServingQty.trim()) {
        const perServing = canonicalUnit(row.perServingUnit)
        if (!target.perServingUnit && target.sumPerServingQty === 0) {
          target.perServingUnit = perServing.unit
        }
        if (perServing.unit === target.perServingUnit) {
          target.sumPerServingQty += toNumber(row.perServingQty) * perServing.factor
        } else {
          target.perServingMixed = true
        }
      }
    })

    vagueByName.forEach((vague, nameKey) => {
      const main = Array.from(map.values()).find((row) => row.nameKey === nameKey)
      if (main) {
        main.vagueAmounts.push(...vague.amounts)
        return
      }
      map.set(`${nameKey}|`, {
        key: `${nameKey}|`,
        nameKey,
        ingredient: vague.display,
        variants: [],
        perServingUnit: '',
        perServingMixed: false,
        totalUnit: '',
        note: '',
        sumPerServingQty: 0,
        sumTotalQty: 0,
        vagueAmounts: vague.amounts,
        unitConflict: false,
      })
    })

    const unitCountByName = new Map<string, number>()
    map.forEach((row) => unitCountByName.set(row.nameKey, (unitCountByName.get(row.nameKey) ?? 0) + 1))

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        note: (notesByKey.get(row.key) ?? []).join(' / '),
        unitConflict: (unitCountByName.get(row.nameKey) ?? 0) > 1,
      }))
      .sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'zh-Hant'))
  }, [allIngredientRows, ingredientAliases, nameTranslations])

  // Tools are counted per tool regardless of the counting word (個／把／支); the most common one is shown.
  const toolSummaryRows = useMemo<ToolSummaryRow[]>(() => {
    const map = new Map<string, ToolSummaryRow>()
    const unitCounts = new Map<string, Map<string, number>>()
    const notesByKey = new Map<string, string[]>()

    allToolRows.forEach((row) => {
      const original = row.tool.trim()
      if (!original || !row.qty.trim()) {
        return
      }

      const name = resolveToolName(original, toolAliases, nameTranslations)
      let target = map.get(name.key)
      if (!target) {
        target = { key: name.key, tool: name.display, variants: [], unit: '', note: '', sumQty: 0 }
        map.set(name.key, target)
      }

      target.sumQty += toNumber(row.qty)
      if (original !== name.display && !target.variants.includes(original)) {
        target.variants.push(original)
      }

      const rawUnit = cleanDisplayName(row.unit)
      const unit = /^(pcs?|pieces?|ea|each|sets?|units?)$/i.test(rawUnit) ? '個' : rawUnit
      if (unit) {
        const counts = unitCounts.get(name.key) ?? new Map<string, number>()
        counts.set(unit, (counts.get(unit) ?? 0) + 1)
        unitCounts.set(name.key, counts)
      }

      const notes = notesByKey.get(name.key) ?? []
      if (row.note.trim() && !notes.includes(row.note.trim())) {
        notes.push(row.note.trim())
      }
      notesByKey.set(name.key, notes)
    })

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        unit: Array.from(unitCounts.get(row.key)?.entries() ?? []).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
        note: (notesByKey.get(row.key) ?? []).join(' / '),
      }))
      .sort((a, b) => a.tool.localeCompare(b.tool, 'zh-Hant'))
  }, [allToolRows, nameTranslations, toolAliases])

  const invalidIngredientRowIds = useMemo(
    () =>
      new Set(
        activeIngredientRows
          .filter((row) => row.ingredient.trim() && !row.totalQty.trim())
          .map((row) => row.id),
      ),
    [activeIngredientRows],
  )

  const invalidToolRowIds = useMemo(
    () => new Set(activeToolRows.filter((row) => row.tool.trim() && !row.qty.trim()).map((row) => row.id)),
    [activeToolRows],
  )

  const ingredientLibraryByGroup = useMemo(
    () =>
      nonSampleGroupIds.map((groupId) => {
        const group = groupData[groupId]
        const dishNameById = new Map(
          group.dishes.map((dish, index) => [dish.id, dish.title.trim() || t('料理 {0}', [index + 1])]),
        )

        const rows: GroupIngredientLibraryRow[] = group.ingredientRows
          .filter((row) => row.ingredient.trim())
          .map((row) => ({
            id: row.id,
            image: row.image,
            dishName: dishNameById.get(row.dishId) ?? t('未指定料理'),
            ingredient: row.ingredient.trim(),
            perServingQty: row.perServingQty.trim(),
            perServingUnit: row.perServingUnit.trim(),
            totalQty: row.totalQty.trim(),
            totalUnit: row.totalUnit.trim(),
            note: row.note.trim(),
          }))

        return {
          groupId,
          groupName: t(group.name),
          rows,
        }
      }),
    [groupData, nonSampleGroupIds, t],
  )

  const toolLibraryByGroup = useMemo(
    () =>
      nonSampleGroupIds.map((groupId) => {
        const group = groupData[groupId]

        const rows: GroupToolLibraryRow[] = group.toolRows
          .filter((row) => row.tool.trim())
          .map((row) => ({
            id: row.id,
            tool: row.tool.trim(),
            qty: row.qty.trim(),
            unit: row.unit.trim(),
            note: row.note.trim(),
          }))

        return {
          groupId,
          groupName: t(group.name),
          rows,
        }
      }),
    [groupData, nonSampleGroupIds, t],
  )

  // What is still missing per group, so the navigation can show progress at a glance.
  const groupStatusById = useMemo(
    () =>
      Object.fromEntries(
        groupOrder.map((groupId): [GroupTab, GroupStatus] => {
          const group = groupData[groupId]
          const missingCount =
            Number(!group.teamName.trim()) +
            Number(!group.cuisineType.trim()) +
            group.dishes.filter((dish) => !dish.title.trim()).length +
            group.ingredientRows.filter((row) => row.ingredient.trim() && !row.totalQty.trim()).length +
            group.toolRows.filter((row) => row.tool.trim() && !row.qty.trim()).length

          return [
            groupId,
            { filledCount: group.ingredientRows.filter((row) => row.ingredient.trim()).length, missingCount },
          ]
        }),
      ),
    [groupData, groupOrder],
  )

  // Reference photos the groups attached, keyed by ingredient name, for the shopping views.
  const ingredientReferencesByName = useMemo(() => {
    const map = new Map<string, LightboxItem[]>()

    nonSampleGroupIds.forEach((groupId) => {
      const group = groupData[groupId]
      group.ingredientRows.forEach((row) => {
        const name = row.ingredient.trim()
        if (!name || !row.image) {
          return
        }

        const dishTitle = group.dishes.find((dish) => dish.id === row.dishId)?.title.trim()
        const caption = [t(group.name), dishTitle, formatAmount(row.totalQty, row.totalUnit), row.note.trim()]
          .filter(Boolean)
          .join(' · ')
        const key = resolveIngredientName(name, ingredientAliases, nameTranslations).key
        map.set(key, [...(map.get(key) ?? []), { url: row.image.url, caption }])
      })
    })

    return map
  }, [groupData, nonSampleGroupIds, ingredientAliases, nameTranslations, t])

  const getIngredientReferences = (name: string): LightboxItem[] =>
    ingredientReferencesByName.get(canonicalIngredient(name).key) ?? []

  const uniqueSummaryIngredients = useMemo(() => {
    const list = new Set<string>()
    ingredientSummaryRows.forEach((r) => list.add(r.ingredient))
    return Array.from(list).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [ingredientSummaryRows])

  // Prices used for suggestions and estimates:
  // - entries linked to a 全聯 (小時達／全電商) or 萬家福 product take the price fetched this morning;
  // - market produce takes today's wholesale-based price unless an admin entered one by hand;
  // - produce the list doesn't have yet is added from the market data.
  const effectivePriceBook = useMemo<PriceEntry[]>(() => {
    if (!marketPrices) {
      return priceBook
    }

    const book = priceBook.map((entry): PriceEntry => {
      const fetched = marketPrices.products[String(entry.id)]
      return entry.sourceUrl && fetched
        ? { ...entry, price: String(fetched.price), auto: 'product', autoAt: fetched.fetchedAt }
        : entry
    })

    marketPrices.produce.forEach((item, index) => {
      const autoEntry: PriceEntry = {
        id: -(index + 1),
        ingredient: item.ingredient,
        store: '菜市場',
        price: String(item.price),
        packQty: '1',
        packUnit: '斤',
        spec: `批發均價 ${item.wholesalePerKg} 元/公斤換算`,
        loose: true,
        auto: 'produce',
        autoAt: marketPrices.updatedAt,
      }
      const existing = book.findIndex(
        (entry) => normalizeNameText(entry.ingredient) === normalizeNameText(item.ingredient) && storeKindOf(entry.store) === '菜市場',
      )
      if (existing < 0) {
        book.push(autoEntry)
      } else if (!book[existing].updatedAt) {
        book[existing] = { ...autoEntry, id: book[existing].id, spec: book[existing].spec || autoEntry.spec }
      }
    })

    return book
  }, [marketPrices, priceBook])

  // One row per ingredient (name + unit): total needed, which groups need it, where to buy it and what it should cost.
  const shoppingIngredientOverviewRows = useMemo<ShoppingIngredientOverviewRow[]>(() => {
    const assignedStoreByIngredient = new Map<string, ShoppingStore>()
    shoppingStores.forEach((store) => {
      store.items.forEach((item) => {
        const name = item.ingredient.trim() && resolveIngredientName(item.ingredient, ingredientAliases, nameTranslations).key
        if (name && !assignedStoreByIngredient.has(name)) {
          assignedStoreByIngredient.set(name, store)
        }
      })
    })

    const needsByKey = new Map<string, Map<GroupTab, GroupNeed>>()
    nonSampleGroupIds.forEach((groupId) => {
      const group = groupData[groupId]
      group.ingredientRows.forEach((row) => {
        const name = row.ingredient.trim()
        if (!name || !row.totalQty.trim()) {
          return
        }

        const unit = canonicalUnit(row.totalUnit)
        const key = `${resolveIngredientName(name, ingredientAliases, nameTranslations).key}|${unit.unit}`
        const byGroup = needsByKey.get(key) ?? new Map<GroupTab, GroupNeed>()
        const need = byGroup.get(groupId) ?? { groupId, groupName: t(group.name), qty: 0, dishTitles: [] }
        need.qty += toNumber(row.totalQty) * unit.factor
        const dishTitle = group.dishes.find((dish) => dish.id === row.dishId)?.title.trim()
        if (dishTitle && !need.dishTitles.includes(dishTitle)) {
          need.dishTitles.push(dishTitle)
        }
        byGroup.set(groupId, need)
        needsByKey.set(key, byGroup)
      })
    })

    return ingredientSummaryRows
      .map((summary) => {
        const row = {
          ingredient: summary.ingredient,
          requiredTotal: summary.sumTotalQty + toNumber(ingredientAdjustments[summary.key] ?? ''),
          totalUnit: summary.totalUnit,
          note: [summary.note, ...summary.vagueAmounts].filter(Boolean).join(' / '),
        }
        const key = summary.key
        const store = assignedStoreByIngredient.get(summary.nameKey) ?? null
        return {
          ...row,
          requiredDisplay: formatQuantity(row.requiredTotal, row.totalUnit),
          category: categorizeIngredient(row.ingredient),
          groupNeeds: Array.from(needsByKey.get(key)?.values() ?? []),
          suggestion: suggestPurchase(row.ingredient, row.requiredTotal, row.totalUnit, effectivePriceBook),
          assignedStoreId: store?.id ?? null,
          assignedStoreName: store ? store.storeName.trim() || t('未命名商店') : null,
        }
      })
      .sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
          a.ingredient.localeCompare(b.ingredient, 'zh-Hant'),
      )
  }, [groupData, ingredientAdjustments, ingredientAliases, nameTranslations, ingredientSummaryRows, nonSampleGroupIds, effectivePriceBook, shoppingStores, t])

  // Canonical name -> its overview rows (more than one when groups used units that cannot be converted).
  const overviewByIngredient = useMemo(() => {
    const map = new Map<string, ShoppingIngredientOverviewRow[]>()
    shoppingIngredientOverviewRows.forEach((row) => {
      const key = normalizeNameText(row.ingredient)
      map.set(key, [...(map.get(key) ?? []), row])
    })
    return map
  }, [shoppingIngredientOverviewRows])

  // Store items may still carry the spelling a group used; look them up by canonical name.
  const findOverviewRows = (name: string) => overviewByIngredient.get(canonicalIngredient(name).key) ?? []
  const findOverview = (name: string): ShoppingIngredientOverviewRow | undefined => findOverviewRows(name)[0]

  // What is still to buy for a store item, e.g. "4 顆", or "6 顆 + 300 g" when units differ.
  const describeNeed = (name: string, ownedQty: string) => {
    const rows = findOverviewRows(name)
    if (rows.length === 0) {
      return null
    }

    if (rows.length === 1) {
      const remaining = Math.max(rows[0].requiredTotal - toNumber(ownedQty), 0)
      return {
        need: amountLabel(rows[0].requiredDisplay),
        remaining: amountLabel(formatQuantity(remaining, rows[0].totalUnit)),
        mixed: false,
      }
    }

    const text = amountLabel(rows.map((row) => row.requiredDisplay).join(' + '))
    return { need: text, remaining: text, mixed: true }
  }

  const unassignedShoppingIngredientCount = shoppingIngredientOverviewRows.filter((row) => !row.assignedStoreId).length

  const shoppingKeyword = shoppingOverviewQuery.trim().toLowerCase()
  const filteredShoppingIngredientOverviewRows = shoppingIngredientOverviewRows.filter((row) => {
    if (shoppingOverviewFilter === 'unassigned' && row.assignedStoreId) {
      return false
    }

    return (
      !shoppingKeyword ||
      [row.ingredient, ingredientLabel(row.ingredient), row.note, row.category, t(row.category), row.assignedStoreName ?? '', ...row.groupNeeds.map((need) => need.groupName)]
        .join(' ')
        .toLowerCase()
        .includes(shoppingKeyword)
    )
  })

  // Cheapest estimate for an item at this particular store, after subtracting what is already at home.
  // An ingredient requested in two units (5 顆 and 300 g) is estimated per unit and added up;
  // "have at home" only applies when there is a single unit.
  const estimateItemAtStore = (item: ShoppingStoreItem, storeName: string) => {
    const rows = findOverviewRows(item.ingredient)
    if (rows.length === 0) {
      return null
    }

    const kind = storeKindOf(storeName)
    const parts = rows.map((row) => {
      const needQty = Math.max(row.requiredTotal - (rows.length === 1 ? toNumber(item.ownedQty ?? '') : 0), 0)
      if (needQty === 0) {
        return { cost: 0, label: t('家裡已有足夠數量') }
      }

      const best = findPriceEntries(row.ingredient, effectivePriceBook)
        .filter((entry) => entry.store === storeName.trim() || (kind !== null && storeKindOf(entry.store) === kind))
        .map((entry) => estimateWithEntry(needQty, row.totalUnit, entry))
        .filter((estimate) => estimate !== null)
        .sort((a, b) => a.cost - b.cost)[0]
      if (!best) {
        return null
      }

      const packs = best.entry.loose ? '' : ` × ${best.packs}`
      return { cost: best.cost, label: t('參考 ${0}/{1}{2}', [best.entry.price, formatPack(best.entry), packs]) }
    })

    const known = parts.filter((part) => part !== null)
    if (known.length === 0) {
      return null
    }

    return { cost: known.reduce((sum, part) => sum + part.cost, 0), label: known.map((part) => part.label).join(' ＋ ') }
  }

  const getStoreStats = (store: ShoppingStore) =>
    computeStoreStats(store, (item) => estimateItemAtStore(item, store.storeName)?.cost ?? 0)

  // Each group's share of an item. When an ingredient was requested in units that cannot be added
  // (顆 and g), every unit row counts as one equal part, split by that row's quantities.
  const groupSharesOf = (item: ShoppingStoreItem): GroupShare[] => {
    const shares = new Map<string, number>()
    findOverviewRows(item.ingredient).forEach((row) => {
      const rowTotal = row.groupNeeds.reduce((sum, need) => sum + need.qty, 0)
      row.groupNeeds.forEach((need) => {
        if (rowTotal > 0) {
          shares.set(need.groupId, (shares.get(need.groupId) ?? 0) + need.qty / rowTotal)
        }
      })
    })
    return Array.from(shares.entries()).map(([groupId, qty]) => ({ groupId, qty }))
  }

  const spendingAllocation = allocateGroupSpending(shoppingStores, groupSharesOf, (item, store) =>
    estimateItemAtStore(item, shoppingStores.find((entry) => entry.id === store.id)?.storeName ?? '')?.cost ?? 0,
  )
  const groupSpending = nonSampleGroupIds.map((groupId) => ({
    groupId,
    name: getGroupName(groupId),
    actual: spendingAllocation.byGroup.get(groupId)?.actual ?? 0,
    estimated: spendingAllocation.byGroup.get(groupId)?.estimated ?? 0,
  }))

  const updateIngredientRow = (
    groupName: GroupTab,
    id: number,
    field: keyof IngredientRow,
    value: string,
  ) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: previous[groupName].ingredientRows.map((row) =>
          row.id === id ? { ...row, [field]: value } : row,
        ),
      },
    }))
  }

  const updateToolRow = (groupName: GroupTab, id: number, field: keyof ToolRow, value: string) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolRows: previous[groupName].toolRows.map((row) =>
          row.id === id ? { ...row, [field]: value } : row,
        ),
      },
    }))
  }

  const addIngredientRow = (groupName: GroupTab, dishId: number) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: [...previous[groupName].ingredientRows, emptyIngredientRow(nextId(), dishId)],
      },
    }))
  }

  const addToolRow = (groupName: GroupTab) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolRows: [...previous[groupName].toolRows, emptyToolRow(nextId())],
      },
    }))
  }

  const removeIngredientRow = (groupName: GroupTab, row: IngredientRow) => {
    if (!isBlankIngredientRow(row) && !window.confirm(t('確定要刪除「{0}」嗎？', [row.ingredient.trim() || t('此食材列')]))) {
      return
    }

    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: previous[groupName].ingredientRows.filter((item) => item.id !== row.id),
      },
    }))
    if (row.image) {
      void deleteImageFromCloud(row.image)
    }
  }

  const removeToolRow = (groupName: GroupTab, row: ToolRow) => {
    const hasContent = [row.tool, row.qty, row.unit, row.note].some((value) => value.trim())
    if (hasContent && !window.confirm(t('確定要刪除「{0}」嗎？', [row.tool.trim() || t('此工具列')]))) {
      return
    }

    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolRows: previous[groupName].toolRows.filter((item) => item.id !== row.id),
      },
    }))
  }

  const updateGroupMeta = (groupName: GroupTab, field: 'teamName' | 'cuisineType', value: string) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        [field]: value,
      },
    }))
  }

  const updateDish = (
    groupName: GroupTab,
    dishId: number,
    field: 'title' | 'videoUrl' | 'steps',
    value: string,
  ) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishes: previous[groupName].dishes.map((dish) =>
          dish.id === dishId ? { ...dish, [field]: value } : dish,
        ),
      },
    }))
  }

  const addDish = (groupName: GroupTab) => {
    const newDishId = nextId()

    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishes: [...previous[groupName].dishes, emptyDish(newDishId)],
        ingredientRows: [...previous[groupName].ingredientRows, emptyIngredientRow(nextId(), newDishId)],
      },
    }))
  }

  const removeDish = (groupName: GroupTab, dishId: number) => {
    const dishIndex = groupData[groupName].dishes.findIndex((dish) => dish.id === dishId)
    const dishTitle = groupData[groupName].dishes[dishIndex]?.title.trim()
    const dishLabel = dishTitle ? `「${dishTitle}」` : dishIndex >= 0 ? t('料理 {0}', [dishIndex + 1]) : t('此料理')
    const confirmed = window.confirm(t('確定要刪除{0}嗎？該料理下的食材將一併刪除。', [dishLabel]))
    if (!confirmed) {
      return
    }

    setGroupData((previous) => {
      const currentDishes = previous[groupName].dishes
      if (currentDishes.length <= MIN_DISH_COUNT) return previous

      return {
        ...previous,
        [groupName]: {
          ...previous[groupName],
          dishes: currentDishes.filter((dish) => dish.id !== dishId),
          ingredientRows: previous[groupName].ingredientRows.filter((row) => row.dishId !== dishId),
        },
      }
    })
  }

  const addGroup = () => {
    const name = window.prompt(t('新組別名稱'), t('第{0}組', [nonSampleGroupIds.length + 1]))?.trim()
    if (!name) {
      return
    }

    const groupId = `g${nextId()}`
    setGroupData((previous) => ({ ...previous, [groupId]: createEmptyGroup(name, nextId()) }))
    setGroupOrder((previous) => [...previous, groupId])
    setCurrentTab(groupId)
  }

  const renameGroup = (groupId: GroupTab) => {
    const name = window.prompt(t('修改組別名稱'), getGroupName(groupId))?.trim()
    if (!name) {
      return
    }

    setGroupData((previous) => ({ ...previous, [groupId]: { ...previous[groupId], name } }))
  }

  const removeGroup = (groupId: GroupTab) => {
    if (groupId === SAMPLE_GROUP_TAB) {
      return
    }

    const name = getGroupName(groupId)
    const confirmed = window.confirm(t('確定要刪除「{0}」嗎？此組的料理、食材與工具會全部刪除，且無法復原。', [name]))
    if (!confirmed) {
      return
    }

    const remaining = groupOrder.filter((id) => id !== groupId)
    setGroupOrder(remaining)
    setGroupData((previous) => {
      const next = { ...previous }
      delete next[groupId]
      return next
    })
    if (currentTab === groupId) {
      setCurrentTab(remaining[1] ?? SAMPLE_GROUP_TAB)
    }
  }

  const getImageFiles = (files: Iterable<File>): File[] =>
    Array.from(files).filter((file) => file.type.startsWith('image/'))

  // Ctrl+V / long-press paste anywhere inside a dish card uploads clipboard images to that dish.
  const handleDishPaste = (groupName: GroupTab, dishId: number, event: ReactClipboardEvent) => {
    const files = getImageFiles(event.clipboardData.files)
    if (files.length === 0) {
      return
    }

    event.preventDefault()
    void handleDishImageUpload(groupName, dishId, files)
  }

  const handleDishDrop = (groupName: GroupTab, dishId: number, event: ReactDragEvent) => {
    event.preventDefault()
    setDragOverDishId(null)
    void handleDishImageUpload(groupName, dishId, getImageFiles(event.dataTransfer.files))
  }

  const pasteImageFromClipboard = async (groupName: GroupTab, dishId: number) => {
    if (!navigator.clipboard?.read) {
      setImageUploadError(t('此瀏覽器不支援按鈕貼上，請點選圖片區後按 Ctrl+V（手機可長按貼上）。'))
      return
    }

    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          files.push(new File([blob], `clipboard.${imageType.split('/')[1] ?? 'png'}`, { type: imageType }))
        }
      }

      if (files.length === 0) {
        setImageUploadError(t('剪貼簿裡沒有圖片，請先複製一張圖片。'))
        return
      }

      await handleDishImageUpload(groupName, dishId, files)
    } catch {
      setImageUploadError(t('無法讀取剪貼簿，請允許剪貼簿權限，或點選圖片區後按 Ctrl+V。'))
    }
  }

  const handleDishImageUpload = async (groupName: GroupTab, dishId: number, fileList: File[]) => {
    if (fileList.length === 0) {
      return
    }

    if (uploadingDishIds[dishId]) {
      return
    }

    if (!isCloudinaryConfigured) {
      setImageUploadError(t('尚未設定 Cloudinary，請先設定雲端名稱與 Upload Preset。'))
      return
    }

    setImageUploadError('')
    setUploadingDishIds((previous) => ({ ...previous, [dishId]: true }))
    setUploadProgressByDish((previous) => ({ ...previous, [dishId]: 0 }))

    try {
      const currentDish = groupData[groupName].dishes.find((dish) => dish.id === dishId)
      const remainSlots = currentDish ? Math.max(0, 2 - currentDish.images.length) : 0

      if (remainSlots === 0) {
        setImageUploadError(t('此料理圖片已達 2 張上限，請先刪除後再上傳。'))
        setUploadingDishIds((previous) => ({ ...previous, [dishId]: false }))
        return
      }

      const files = Array.from(fileList).slice(0, remainSlots)
      const uploadedImages: DishImage[] = []
      const totalFiles = files.length

      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex]
        const compressedBlob = await compressImageFile(file)
        const uploadedImage = await uploadCompressedImage(compressedBlob, (ratio) => {
          const overall = ((fileIndex + ratio) / totalFiles) * 100
          setUploadProgressByDish((previous) => ({
            ...previous,
            [dishId]: Math.min(100, Math.max(0, Math.round(overall))),
          }))
        })
        uploadedImages.push(uploadedImage)
      }

      if (uploadedImages.length > 0) {
        setGroupData((previous) => ({
          ...previous,
          [groupName]: {
            ...previous[groupName],
            dishes: previous[groupName].dishes.map((dish) => {
              if (dish.id !== dishId) {
                return dish
              }

              return {
                ...dish,
                images: uniqueDishImages([...dish.images, ...uploadedImages]).slice(0, 2),
              }
            }),
          },
        }))
      }
    } catch (error) {
      setImageUploadError(getUploadErrorMessage(error, t))
    } finally {
      setUploadingDishIds((previous) => ({ ...previous, [dishId]: false }))
      setUploadProgressByDish((previous) => ({ ...previous, [dishId]: 0 }))
    }
  }

  const removeDishImage = async (groupName: GroupTab, dishId: number, imageIndex: number) => {
    const confirmed = window.confirm(t('確定要刪除這張圖片嗎？'))
    if (!confirmed) {
      return
    }

    const targetImage =
      groupData[groupName].dishes.find((dish) => dish.id === dishId)?.images[imageIndex] ?? null

    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishes: previous[groupName].dishes.map((item) =>
          item.id === dishId
            ? {
                ...item,
                images: item.images.filter((_, index) => index !== imageIndex),
              }
            : item,
        ),
      },
    }))

    const publicId = targetImage?.publicId ?? (targetImage?.url ? extractPublicIdFromCloudinaryUrl(targetImage.url) : null)

    if (!publicId) {
      setImageUploadError(t('已從表單移除圖片，但缺少 Cloudinary public_id，無法同步刪除雲端檔案。'))
      return
    }

    try {
      const deleteResult = await deleteCloudinaryByPublicId(publicId)
      if (!deleteResult.ok) {
        setImageUploadError(
          t('圖片已從表單移除，但 Cloudinary 同步刪除失敗（{0}）。', [deleteResult.message ?? t('請確認已部署 API 與伺服器端金鑰')]),
        )
      }
    } catch {
      setImageUploadError(t('圖片已從表單移除，但 Cloudinary 同步刪除失敗（請確認已部署 API 與伺服器端金鑰）。'))
    }
  }

  const openLightbox = (next: Lightbox, index = 0) => {
    setLightbox(next)
    setLightboxIndex(index)
  }

  const deleteImageFromCloud = async (image: DishImage) => {
    const publicId = image.publicId ?? extractPublicIdFromCloudinaryUrl(image.url)
    if (!publicId) {
      return
    }

    try {
      const result = await deleteCloudinaryByPublicId(publicId)
      if (!result.ok) {
        setImageUploadError(t('照片已移除，但雲端檔案刪除失敗（{0}）。', [result.message ?? t('請確認 API 設定')]))
      }
    } catch {
      setImageUploadError(t('照片已移除，但雲端檔案刪除失敗（請確認 API 設定）。'))
    }
  }

  const updateIngredientRowFields = (groupName: GroupTab, rowId: number, fields: Partial<IngredientRow>) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: previous[groupName].ingredientRows.map((row) =>
          row.id === rowId ? { ...row, ...fields } : row,
        ),
      },
    }))
  }

  // Amount fields hold quantity + unit as one text ("6顆"). While typing the split keeps the text
  // intact; on blur it is normalized ("兩包" -> 2 包).
  const updateIngredientAmount = (
    groupName: GroupTab,
    rowId: number,
    kind: 'total' | 'perServing',
    text: string,
    normalize = false,
  ) => {
    const { qty, unit } = normalize ? parseAmount(text) : splitAmountInput(text)
    updateIngredientRowFields(
      groupName,
      rowId,
      kind === 'total' ? { totalQty: qty, totalUnit: unit } : { perServingQty: qty, perServingUnit: unit },
    )
  }

  // Fills the target row (if any) and the dish's blank rows first, then appends new rows.
  const addParsedIngredients = (
    groupName: GroupTab,
    dishId: number,
    items: ParsedIngredient[],
    targetRowId?: number,
  ) => {
    if (items.length === 0) {
      return
    }

    setGroupData((previous) => {
      const group = previous[groupName]
      const blankRowIds = group.ingredientRows
        .filter((row) => row.dishId === dishId && row.id !== targetRowId && isBlankIngredientRow(row))
        .map((row) => row.id)
      const fillTargets = targetRowId === undefined ? blankRowIds : [targetRowId, ...blankRowIds]
      const toFields = (item: ParsedIngredient): Partial<IngredientRow> => ({
        ingredient: item.ingredient,
        ...(item.totalQty || item.totalUnit ? { totalQty: item.totalQty, totalUnit: item.totalUnit } : {}),
        ...(item.note ? { note: item.note } : {}),
      })
      let rows = group.ingredientRows

      items.forEach((item, index) => {
        const targetId = fillTargets[index]
        rows =
          targetId === undefined
            ? [...rows, { ...emptyIngredientRow(nextId(), dishId), ...toFields(item) }]
            : rows.map((row) => (row.id === targetId ? { ...row, ...toFields(item) } : row))
      })

      return { ...previous, [groupName]: { ...group, ingredientRows: rows } }
    })
  }

  const submitQuickAdd = (groupName: GroupTab, dishId: number, text: string) => {
    const items = parseIngredientText(text)
    if (items.length === 0) {
      return
    }

    addParsedIngredients(groupName, dishId, items)
    setQuickAddDrafts((previous) => ({ ...previous, [dishId]: '' }))
    const withoutAmount = items.filter((item) => !item.totalQty).length
    setQuickAddNotices((previous) => ({
      ...previous,
      [dishId]: withoutAmount
        ? t('已加入 {0} 項，{1} 項還沒有數量（已標示黃色）', [items.length, withoutAmount])
        : t('已加入 {0} 項', [items.length]),
    }))
  }

  // Pasting a list into a row's name cell spreads it over this row and new rows.
  const handleIngredientNamePaste = (
    groupName: GroupTab,
    dishId: number,
    rowId: number,
    event: ReactClipboardEvent<HTMLInputElement>,
  ) => {
    const text = event.clipboardData.getData('text')
    if (!looksLikeIngredientList(text)) {
      return
    }

    event.preventDefault()
    addParsedIngredients(groupName, dishId, parseIngredientText(text), rowId)
  }

  const uploadIngredientImage = async (groupName: GroupTab, rowId: number, files: File[]) => {
    const file = files[0]
    if (!file || uploadingRowIds[rowId]) {
      return
    }

    if (!isCloudinaryConfigured) {
      setImageUploadError(t('尚未設定 Cloudinary，無法上傳照片。'))
      return
    }

    const previousImage = groupData[groupName].ingredientRows.find((row) => row.id === rowId)?.image
    setImageUploadError('')
    setUploadingRowIds((previous) => ({ ...previous, [rowId]: true }))

    try {
      const blob = await compressImageFile(file, 900, 0.8)
      const uploaded = await uploadCompressedImage(blob, () => {})
      updateIngredientRowFields(groupName, rowId, { image: uploaded })
      if (previousImage) {
        void deleteImageFromCloud(previousImage)
      }
    } catch (error) {
      setImageUploadError(getUploadErrorMessage(error, t))
    } finally {
      setUploadingRowIds((previous) => ({ ...previous, [rowId]: false }))
    }
  }

  const removeIngredientImage = (groupName: GroupTab, rowId: number) => {
    const image = groupData[groupName].ingredientRows.find((row) => row.id === rowId)?.image
    if (!image || !window.confirm(t('確定要移除這張食材照片嗎？'))) {
      return
    }

    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: previous[groupName].ingredientRows.map((row) => {
          if (row.id !== rowId) {
            return row
          }
          const next = { ...row }
          delete next.image
          return next
        }),
      },
    }))
    setLightbox(null)
    void deleteImageFromCloud(image)
  }

  const handleRowImagePaste = (groupName: GroupTab, rowId: number, event: ReactClipboardEvent) => {
    const files = getImageFiles(event.clipboardData.files)
    if (files.length === 0) {
      return
    }

    // Keep the image on this ingredient instead of letting the dish card take it.
    event.preventDefault()
    event.stopPropagation()
    void uploadIngredientImage(groupName, rowId, files)
  }

  const handleRowImageDrop = (groupName: GroupTab, rowId: number, event: ReactDragEvent) => {
    const files = getImageFiles(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setDragOverDishId(null)
    void uploadIngredientImage(groupName, rowId, files)
  }

  const unlockAdminAccess = () => {
    if (adminPasscode !== ADMIN_PASSCODE) {
      setAdminError(t('管理員密碼錯誤。'))
      return
    }

    setAdminError('')
    setAdminUnlocked(true)
    setAdminPasscode('')
  }

  const lockAdminAccess = () => {
    setAdminUnlocked(false)
    setAdminPasscode('')
    setAdminError('')
    setShowHardResetPanel(false)
    setResetConfirmPhrase('')
    setResetConfirmPasscode('')
    setResetAcknowledged(false)
    setResetError('')
    setResetCooldownSeconds(0)
  }

  const startDangerHold = () => {
    if (!adminUnlocked || showHardResetPanel || dangerHoldTimerRef.current) {
      return
    }

    setResetError('')
    dangerHoldTimerRef.current = window.setTimeout(() => {
      setShowHardResetPanel(true)
      setResetCooldownSeconds(5)
      dangerHoldTimerRef.current = null
    }, 3000)
  }

  const cancelDangerHold = () => {
    if (!dangerHoldTimerRef.current) {
      return
    }

    window.clearTimeout(dangerHoldTimerRef.current)
    dangerHoldTimerRef.current = null
  }

  const closeHardResetPanel = () => {
    setShowHardResetPanel(false)
    setResetConfirmPhrase('')
    setResetConfirmPasscode('')
    setResetAcknowledged(false)
    setResetError('')
    setResetCooldownSeconds(0)
  }

  const executeHardReset = async () => {
    if (!adminUnlocked) {
      setResetError(t('僅管理員可執行此操作。'))
      return
    }

    if (resetCooldownSeconds > 0) {
      setResetError(t('請再等待 {0} 秒後才能執行。', [resetCooldownSeconds]))
      return
    }

    if (resetConfirmPasscode !== ADMIN_PASSCODE) {
      setResetError(t('管理員密碼驗證失敗。'))
      return
    }

    if (resetConfirmPhrase.trim() !== RESET_CONFIRM_PHRASE) {
      setResetError(t('請輸入正確確認字串：{0}', [RESET_CONFIRM_PHRASE]))
      return
    }

    if (!resetAcknowledged) {
      setResetError(t('請先勾選風險確認。'))
      return
    }

    const confirmed = window.confirm(t('最後確認：此操作會刪除所有組別資料、食材庫調整與採買資料，且無法復原。'))
    if (!confirmed) {
      return
    }

    setResetError('')

    if (isCloudinaryConfigured) {
      const deleteResult = await deleteCloudinaryAssetsForReset(groupData)
      if (!deleteResult.ok) {
        setResetError(t('Cloudinary 全刪除失敗：{0}', [deleteResult.message ?? t('請確認 API 與伺服器金鑰設定')]))
        return
      }
    }

    let firestoreDeleteFailed = false

    if (isFirebaseConfigured && db) {
      try {
        const projectRef = doc(db, 'projects', firebaseProjectDocId)
        await deleteDoc(projectRef)
      } catch {
        firestoreDeleteFailed = true
      }
    }

    setCurrentTab(SAMPLE_GROUP_TAB)
    // If the cloud delete failed, keep the old base so the next sync pushes the reset as local edits.
    setSyncState((previous) => ({
      data: createHardResetSharedState(previous.data),
      base: firestoreDeleteFailed ? previous.base : createInitialSharedState(),
      baseRev: firestoreDeleteFailed ? previous.baseRev : 0,
    }))
    setGroupCollapseState({})
    setToolLibraryInput('')
    setToolLibraryError('')
    setLibraryInput('')
    setLibraryError('')
    setUploadingDishIds({})
    setUploadProgressByDish({})
    setResolvedThumbnailByUrl({})
    setThumbnailFetchFailedByUrl({})
    setImageUploadError('')

    setSyncStatus(
      firestoreDeleteFailed
        ? '已完成本機與 Cloudinary 歸零；Firestore 刪除失敗，已保留本機刪除結果，請稍後重試同步。'
        : '已完成本機 + Firestore + Cloudinary 全部歸零',
    )

    closeHardResetPanel()
  }

  const addLibraryIngredient = () => {
    const trimmed = libraryInput.trim()
    if (!trimmed) {
      setLibraryError(t('請先輸入食材名稱。'))
      return
    }

    if (ingredientLibrary.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
      setLibraryError(t('食材庫已存在相同名稱。'))
      return
    }

    if (INGREDIENT_LIBRARY_BLOCKLIST.includes(trimmed)) {
      setLibraryError(t('此食材不符合蛋奶素（五辛或葷食），無法加入。'))
      return
    }

    setLibraryError('')
    setIngredientLibrary((previous) => [...previous, trimmed].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
    setLibraryInput('')
  }

  const removeLibraryIngredient = (name: string) => {
    const confirmed = window.confirm(t('確定要從食材庫刪除「{0}」嗎？', [name]))
    if (!confirmed) {
      return
    }

    setIngredientLibrary((previous) => previous.filter((item) => item !== name))
  }

  const addLibraryTool = () => {
    const trimmed = toolLibraryInput.trim()
    if (!trimmed) {
      setToolLibraryError(t('請先輸入工具名稱。'))
      return
    }

    if (toolLibrary.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
      setToolLibraryError(t('工具庫已存在相同名稱。'))
      return
    }

    setToolLibraryError('')
    setToolLibrary((previous) => [...previous, trimmed].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
    setToolLibraryInput('')
  }

  const removeLibraryTool = (name: string) => {
    const confirmed = window.confirm(t('確定要從工具庫刪除「{0}」嗎？', [name]))
    if (!confirmed) {
      return
    }

    setToolLibrary((previous) => previous.filter((item) => item !== name))
  }

  const updateCollapse = (
    groupName: GroupTab,
    update: (state: GroupCollapseState) => Partial<GroupCollapseState>,
  ) => {
    setGroupCollapseState((previous) => {
      const current = previous[groupName] ?? EMPTY_COLLAPSE_STATE
      return { ...previous, [groupName]: { ...current, ...update(current) } }
    })
  }

  const toggleDishCollapse = (groupName: GroupTab, dishId: number) => {
    updateCollapse(groupName, (state) => ({
      dishCollapsedById: { ...state.dishCollapsedById, [dishId]: !state.dishCollapsedById[dishId] },
    }))
  }

  const setAllDishesCollapsed = (groupName: GroupTab, collapsed: boolean) => {
    updateCollapse(groupName, () => ({
      dishCollapsedById: Object.fromEntries(groupData[groupName].dishes.map((dish) => [dish.id, collapsed])),
    }))
  }

  const toggleToolsCollapse = (groupName: GroupTab) => {
    updateCollapse(groupName, (state) => ({ toolsCollapsed: !state.toolsCollapsed }))
  }

  const toggleGroupIngredientTableCollapse = (groupName: GroupTab) => {
    updateCollapse(groupName, (state) => ({ groupIngredientTableCollapsed: !state.groupIngredientTableCollapsed }))
  }

  const toggleGroupToolTableCollapse = (groupName: GroupTab) => {
    updateCollapse(groupName, (state) => ({ groupToolTableCollapsed: !state.groupToolTableCollapsed }))
  }

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'
    document.title = t('聖誕趴 · 廚藝競賽')
    try {
      window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs))
    } catch {
      // Preferences are a convenience; ignore blocked storage.
    }
  }, [lang, t, uiPrefs])

  useEffect(() => {
    const payload: PersistedState = { currentTab, ...syncState }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Storage can be full or blocked; the cloud copy is the source of truth anyway.
    }
  }, [currentTab, syncState])

  useEffect(() => {
    const isKnownTab =
      groupOrder.includes(currentTab) || currentTab === CHANGELOG_TAB || (adminUnlocked && ADMIN_TABS.includes(currentTab))

    if (!isKnownTab) {
      setCurrentTab(groupOrder[1] ?? SAMPLE_GROUP_TAB)
    }
  }, [adminUnlocked, currentTab, groupOrder])

  // Apply cloud snapshots by three-way merging them into local state, so unsynced local
  // edits survive and deletions made anywhere are never undone by a stale copy.
  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const unsubscribe = onSnapshot(
      projectRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setSyncState((previous) => ({
            data: createHardResetSharedState(previous.data),
            base: createInitialSharedState(),
            baseRev: 0,
          }))
          setRemoteReady(true)
          setSyncStatus('已連線雲端：尚無資料，已建立初始狀態')
          return
        }

        const raw = snapshot.data() as Record<string, unknown>
        const remote = normalizeSharedState(raw)
        const remoteRev = getRemoteRev(raw)

        setSyncState((previous) => {
          // Ignore snapshots older than a write this client already confirmed.
          if (previous.base && remoteRev < previous.baseRev) {
            return previous
          }

          return {
            data: previous.base ? normalizeSharedState(threeWayMerge(previous.base, previous.data, remote)) : remote,
            base: remote,
            baseRev: remoteRev,
          }
        })
        setRemoteReady(true)
        setSyncStatus('已連線雲端：即時同步中')
      },
      () => {
        setSyncStatus('雲端同步失敗，目前為本機模式')
      },
    )

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return
    }

    const pricesRef = doc(db, 'projects', `${firebaseProjectDocId}--prices`)
    return onSnapshot(
      pricesRef,
      (snapshot) => setMarketPrices(snapshot.exists() ? normalizeMarketPrices(snapshot.data() as Record<string, unknown>) : null),
      () => setMarketPrices(null),
    )
  }, [])

  // Names nobody has translated yet go to the free MyMemory service once; results are shared with
  // everyone through the project data. English names are always translated (needed for merging);
  // Chinese names only while someone is using the English interface.
  const translationsInFlightRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const untranslated = (
      name: string,
      translator: NameTranslator,
      resolve: (name: string, aliases: Record<string, string>, learned: Record<string, string>) => { display: string },
      aliases: Record<string, string>,
    ) => {
      if (isEnglishName(name)) {
        return translator.toChinese(name, nameTranslations) ? null : name
      }
      const display = resolve(name, aliases, nameTranslations).display
      return lang === 'en' && isChineseName(display) && !translator.toEnglish(display, nameTranslations) ? display : null
    }
    const names = new Set<string>()
    const addIngredient = (raw: string) => {
      const name = raw.trim() && untranslated(raw.trim(), INGREDIENT_TRANSLATOR, resolveIngredientName, ingredientAliases)
      if (name) names.add(name)
    }
    const addTool = (raw: string) => {
      const name = raw.trim() && untranslated(raw.trim(), TOOL_TRANSLATOR, resolveToolName, toolAliases)
      if (name) names.add(name)
    }
    // Every name someone can see: all groups (範例組 too), shopping lists, and the libraries.
    groupOrder.forEach((groupId) => {
      groupData[groupId]?.ingredientRows.forEach((row) => addIngredient(row.ingredient))
      groupData[groupId]?.toolRows.forEach((row) => addTool(row.tool))
    })
    shoppingStores.forEach((store) => store.items.forEach((item) => addIngredient(item.ingredient)))
    ingredientLibrary.forEach(addIngredient)
    toolLibrary.forEach(addTool)

    const pending = Array.from(names)
      .filter((name) => !translationsInFlightRef.current.has(learnedKey(name)))
      .slice(0, 8)
    if (pending.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      pending.forEach((name) => translationsInFlightRef.current.add(learnedKey(name)))
      void (async () => {
        const results: Record<string, string> = {}
        for (const name of pending) {
          const toEnglish = !isEnglishName(name)
          try {
            const response = await fetch(
              `https://api.mymemory.translated.net/get?q=${encodeURIComponent(name)}&langpair=${toEnglish ? 'zh-TW|en' : 'en|zh-TW'}`,
            )
            const payload = (await response.json()) as { responseData?: { translatedText?: string } }
            const cleaned = cleanMachineTranslation(name, payload.responseData?.translatedText ?? '', toEnglish)
            if (cleaned) {
              results[learnedKey(name)] = cleaned
            }
          } catch {
            // Offline or rate-limited: the name simply stays untranslated for now.
          }
        }
        if (Object.keys(results).length > 0) {
          // Existing (possibly admin-corrected) translations win over new machine ones.
          setSyncState((previous) => ({
            ...previous,
            data: { ...previous.data, nameTranslations: { ...results, ...previous.data.nameTranslations } },
          }))
        }
      })()
    }, 1500)

    return () => window.clearTimeout(timer)
  }, [groupData, groupOrder, ingredientAliases, ingredientLibrary, lang, nameTranslations, shoppingStores, toolAliases, toolLibrary])

  // Push unsynced edits. The transaction merges them onto the latest cloud state,
  // so concurrent edits from other groups are never overwritten.
  useEffect(() => {
    if (!isFirebaseConfigured || !db || !remoteReady || writeInFlightRef.current) {
      return
    }

    const { data: local, base, baseRev } = syncState
    if (base && deepEqual(local, base)) {
      return
    }

    const firestore = db
    const timer = window.setTimeout(() => {
      writeInFlightRef.current = true
      const projectRef = doc(firestore, 'projects', firebaseProjectDocId)

      runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(projectRef)
        if (!snapshot.exists() && baseRev > 0) {
          // The project was reset elsewhere; the reset snapshot rebuilds local state.
          return null
        }

        const raw = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {}
        const merged =
          snapshot.exists() && base ? normalizeSharedState(threeWayMerge(base, local, normalizeSharedState(raw))) : local
        const rev = getRemoteRev(raw) + 1
        transaction.set(projectRef, { ...stripUndefined(merged), rev })
        return { merged, rev }
      })
        .then((result) => {
          writeInFlightRef.current = false
          if (result) {
            setSyncState((previous) => {
              if (previous.baseRev > result.rev) {
                return previous
              }

              return {
                data: normalizeSharedState(threeWayMerge(local, previous.data, result.merged)),
                base: result.merged,
                baseRev: result.rev,
              }
            })
            setSyncStatus('已連線雲端：即時同步中')
          }
          setSyncRetryTick((tick) => tick + 1)
        })
        .catch(() => {
          writeInFlightRef.current = false
          setSyncStatus('雲端寫入失敗，稍後自動重試（本機修改已保留）')
          window.setTimeout(() => setSyncRetryTick((tick) => tick + 1), 3000)
        })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [syncState, remoteReady, syncRetryTick])

  useEffect(() => {
    if (!lightbox) {
      return
    }

    const count = lightbox.items.length
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightbox(null)
      } else if (event.key === 'ArrowRight') {
        setLightboxIndex((index) => (index + 1) % count)
      } else if (event.key === 'ArrowLeft') {
        setLightboxIndex((index) => (index - 1 + count) % count)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightbox])

  useEffect(() => {
    if (resetCooldownSeconds <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setResetCooldownSeconds((previous) => Math.max(previous - 1, 0))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [resetCooldownSeconds])

  useEffect(() => {
    return () => {
      if (dangerHoldTimerRef.current) {
        window.clearTimeout(dangerHoldTimerRef.current)
      }
    }
  }, [])

  // --- Shopping List Functions ---
  // Stores created for a known kind (菜市場／全聯／Costco) get a fixed id, so two admins pressing
  // "assign all" at the same moment end up with one store instead of two.
  const newStoreId = (storeName: string, stores: ShoppingStore[]) => {
    const kind = storeKindOf(storeName)
    const fixedId = kind ? STORE_KIND_IDS[kind] : null
    return fixedId && !stores.some((store) => store.id === fixedId) ? fixedId : nextId()
  }

  const addShoppingStore = (storeName = t('新商店')) => {
    setShoppingStores((prev) => [...prev, { id: newStoreId(storeName, prev), storeName, items: [] }])
  }

  const removeShoppingStore = (storeId: number) => {
    const confirmed = window.confirm(t('確定要刪除此商店嗎？商店內的食材會回到「待分配」。'))
    if (!confirmed) {
      return
    }

    setShoppingStores((prev) => prev.filter((s) => s.id !== storeId))
  }

  const updateShoppingStoreName = (storeId: number, newName: string) => {
    setShoppingStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, storeName: newName } : s)),
    )
  }

  const updateStoreReceipt = (storeId: number, value: string) => {
    setShoppingStores((prev) => prev.map((s) => (s.id === storeId ? { ...s, receiptTotal: value } : s)))
  }

  const addShoppingStoreItem = (storeId: number) => {
    setShoppingStores((prev) =>
      prev.map((s) => {
        if (s.id !== storeId) return s
        return {
          ...s,
          items: [...s.items, { id: nextId(), ingredient: '', price: '', ownedQty: '' }],
        }
      }),
    )
  }

  // Moves an ingredient to another store (or back to unassigned), keeping what was already entered.
  // An ingredient is only ever in one store.
  const assignIngredientToStore = (ingredient: string, storeId: number | null) => {
    setShoppingStores((prev) => {
      const target = canonicalIngredient(ingredient).key
      const sameIngredient = (name: string) => canonicalIngredient(name).key === target
      const existing = prev.flatMap((store) => store.items).find((item) => sameIngredient(item.ingredient))
      const item = existing ?? { id: nextId(), ingredient, price: '', ownedQty: '' }

      return prev.map((store) => {
        const items = store.items.filter((entry) => !sameIngredient(entry.ingredient))
        return store.id === storeId ? { ...store, items: [...items, item] } : { ...store, items }
      })
    })
  }

  const assignIngredientToNewStore = (ingredient: string, storeName: string) => {
    setShoppingStores((prev) => {
      const target = canonicalIngredient(ingredient).key
      const existing = prev.flatMap((store) => store.items).find((item) => canonicalIngredient(item.ingredient).key === target)
      const kind = storeKindOf(storeName)
      // If a store of this kind already exists, use it rather than creating a second one.
      const sameKindStore = kind ? prev.find((store) => storeKindOf(store.storeName) === kind) : undefined
      const storeId = sameKindStore?.id ?? newStoreId(storeName, prev)
      const item = existing ?? { id: nextId(), ingredient, price: '', ownedQty: '' }
      const stores = prev.map((store) => ({
        ...store,
        items: store.items.filter((entry) => canonicalIngredient(entry.ingredient).key !== target),
      }))

      return sameKindStore
        ? stores.map((store) => (store.id === storeId ? { ...store, items: [...store.items, item] } : store))
        : [...stores, { id: storeId, storeName, items: [item] }]
    })
  }

  // One click: every unassigned ingredient goes to its suggested store; missing stores are created.
  const assignAllBySuggestion = () => {
    // An ingredient listed under two units has two overview rows: assign it once, by its first row.
    const seen = new Set<string>()
    const unassigned = shoppingIngredientOverviewRows.filter((row) => {
      const key = canonicalIngredient(row.ingredient).key
      if (row.assignedStoreId || seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    if (unassigned.length === 0) {
      return
    }

    setShoppingStores((prev) => {
      const stores = prev.map((store) => ({ ...store, items: [...store.items] }))
      const assigned = new Set(stores.flatMap((store) => store.items.map((item) => canonicalIngredient(item.ingredient).key)))

      unassigned.forEach((row) => {
        const key = canonicalIngredient(row.ingredient).key
        if (assigned.has(key)) {
          return
        }

        const target = row.suggestion.store
        const targetKind = storeKindOf(target)
        let store = stores.find(
          (entry) => entry.storeName.trim() === target || (targetKind !== null && storeKindOf(entry.storeName) === targetKind),
        )
        if (!store) {
          store = { id: newStoreId(target, stores), storeName: target, items: [] }
          stores.push(store)
        }
        store.items.push({ id: nextId(), ingredient: row.ingredient, price: '', ownedQty: '' })
        assigned.add(key)
      })

      return stores
    })
  }

  const removeShoppingStoreItem = (storeId: number, itemId: number) => {
    const item = shoppingStores.find((store) => store.id === storeId)?.items.find((entry) => entry.id === itemId)
    if (item && (item.purchased || item.price.trim()) && !window.confirm(t('這項已有購買紀錄，確定要移除嗎？'))) {
      return
    }

    setShoppingStores((prev) =>
      prev.map((s) => {
        if (s.id !== storeId) return s
        return { ...s, items: s.items.filter((entry) => entry.id !== itemId) }
      }),
    )
  }

  const updateShoppingStoreItem = (
    storeId: number,
    itemId: number,
    field: keyof ShoppingStoreItem,
    value: string | boolean,
  ) => {
    setShoppingStores((prev) =>
      prev.map((s) => {
        if (s.id !== storeId) return s
        const updatedItems = s.items.map((item) =>
          item.id === itemId ? { ...item, [field]: value } : item,
        )
        return { ...s, items: updatedItems }
      }),
    )
  }

  // Store items grouped by category in shopping order; items no longer in the summary come last.
  const groupStoreItemsByCategory = (items: ShoppingStoreItem[]) =>
    [...CATEGORY_ORDER, ''].map((category) => ({
      category,
      items: items.filter((item) =>
        category ? findOverview(item.ingredient)?.category === category : !findOverview(item.ingredient),
      ),
    })).filter((section) => section.items.length > 0)

  // Plain-text list to paste into LINE for whoever goes shopping.
  const copyStoreList = async (store: ShoppingStore) => {
    const items = store.items.filter((item) => item.ingredient.trim())
    const lines = [t('【{0}】共 {1} 項', [store.storeName.trim() || t('採買清單'), items.length])]
    groupStoreItemsByCategory(items).forEach(({ category, items: sectionItems }) => {
      lines.push('', `▍${t(category || '其他')}`)
      sectionItems.forEach((item) => {
        const row = findOverview(item.ingredient)
        const amount = describeNeed(item.ingredient, item.ownedQty ?? '')?.remaining ?? ''
        const note = row?.note ? `（${row.note}）` : ''
        lines.push(`${item.purchased ? '☑' : '☐'} ${bilingualIngredient(item.ingredient)} ${amount}${note}`.trim())
      })
    })

    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedStoreId(store.id)
      window.setTimeout(() => setCopiedStoreId((current) => (current === store.id ? null : current)), 2000)
    } catch {
      window.prompt(t('複製下面的文字貼到 LINE：'), text)
    }
  }

  const addPriceEntry = () => {
    setPriceBook((prev) => [
      { id: nextId(), ingredient: '', store: '全聯', price: '', packQty: '1', packUnit: '', spec: '' },
      ...prev,
    ])
  }

  // Editing anything but the product link counts as a hand-entered price, which daily market
  // prices then leave alone.
  const updatePriceEntry = (id: number, fields: Partial<PriceEntry>) => {
    const isManualPrice = Object.keys(fields).some((key) => key !== 'sourceUrl')
    setPriceBook((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, ...fields, ...(isManualPrice ? { updatedAt: new Date().toISOString() } : {}) } : entry,
      ),
    )
  }

  const runPriceUpdate = async () => {
    setPriceUpdating(true)
    setPriceUpdateMessage('')
    try {
      const response = await fetch('/api/update-prices', { method: 'POST' })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
        produceCount?: number
        productCount?: number
        linkedCount?: number
        errors?: string[]
      }
      if (!response.ok) {
        setPriceUpdateMessage(
          result.error ??
            (response.status === 404
              ? t('找不到更新程式（404），自動更新需要部署在 Vercel 上才能使用。')
              : t('伺服器錯誤（{0}），請稍後再試；若一直失敗，可到 Vercel 專案的 Logs 查看 update-prices 的錯誤訊息。', [response.status])),
        )
        return
      }
      const problems = result.errors?.length ? t('，{0} 項有問題', [result.errors.length]) : ''
      setPriceUpdateMessage(
        t('已更新：市場行情 {0} 項、網路商店 {1}/{2} 項{3}', [result.produceCount ?? 0, result.productCount ?? 0, result.linkedCount ?? 0, problems]),
      )
    } catch {
      setPriceUpdateMessage(t('連不到更新服務；本機開發時請用 npm run dev:vercel，或部署到 Vercel 後再試。'))
    } finally {
      setPriceUpdating(false)
    }
  }

  const removePriceEntry = (id: number) => {
    setPriceBook((prev) => prev.filter((entry) => entry.id !== id))
  }

  // Canonical keys of every ingredient already placed in a store.
  const allAssignedIngredients = new Set(
    shoppingStores.flatMap((store) =>
      store.items.filter((item) => item.ingredient.trim()).map((item) => canonicalIngredient(item.ingredient).key),
    ),
  )

  // ---------- Name merging (admin) ----------
  const addNameAlias = (kind: 'ingredient' | 'tool', from: string, to: string) => {
    const fromKey = normalizeNameText(from)
    const target = cleanDisplayName(to)
    const resolve = kind === 'ingredient' ? canonicalIngredient : canonicalTool
    // Skip empty input and anything that would point a name back at itself.
    if (!fromKey || !target || resolve(target).key === fromKey) {
      return
    }

    const setAliases = kind === 'ingredient' ? setIngredientAliases : setToolAliases
    setAliases((previous) => ({ ...previous, [fromKey]: target }))
  }

  const removeNameAlias = (kind: 'ingredient' | 'tool', fromKey: string) => {
    const setAliases = kind === 'ingredient' ? setIngredientAliases : setToolAliases
    setAliases((previous) => {
      const next = { ...previous }
      delete next[fromKey]
      return next
    })
  }

  const dismissNamePair = (a: string, b: string) => {
    setDismissedNamePairs((previous) => Array.from(new Set([...previous, pairKey(a, b)])))
  }

  // Local date (YYYY-MM-DD); toISOString would give yesterday's date before 8 am in Taiwan.
  const exportDate = () => new Date().toLocaleDateString('sv-SE')

  const docTitle = (title: string, subtitle: string): Paragraph[] => [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 220 },
      thematicBreak: true,
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, color: '64748B' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 340 },
    }),
  ]

  const recipeParagraphs = async (
    groupId: GroupTab,
    dishEntries: Array<{ dish: Dish; dishNumber: number }>,
    headingLevel: (typeof HeadingLevel)[keyof typeof HeadingLevel],
    firstDishOnNewPage: boolean,
  ): Promise<Paragraph[]> => {
    const children: Paragraph[] = []

    for (let index = 0; index < dishEntries.length; index += 1) {
      const { dish, dishNumber } = dishEntries[index]
      const stepLines = dish.steps
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const ingredients = groupData[groupId].ingredientRows.filter((row) => row.dishId === dish.id && row.ingredient.trim())

      children.push(
        new Paragraph({
          text: t('第{0}道料理：{1}', [dishNumber, dish.title.trim() || t('未命名料理')]),
          heading: headingLevel,
          pageBreakBefore: index > 0 || firstDishOnNewPage,
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, color: '0F766E', size: 8 } },
        }),
      )

      for (const image of dish.images) {
        const imagePayload = await fetchImageForDocx(image.url)
        if (imagePayload) {
          children.push(
            new Paragraph({
              children: [new ImageRun({ data: imagePayload.data, type: imagePayload.type, transformation: { width: 420, height: 260 } })],
              alignment: AlignmentType.CENTER,
              spacing: { after: 140 },
            }),
          )
        }
      }

      children.push(
        new Paragraph({ children: [new TextRun({ text: t('食材'), bold: true, color: '334155' })], spacing: { before: 80, after: 80 } }),
      )
      if (ingredients.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: t('尚未填寫食材'), italics: true, color: '94A3B8' })], spacing: { after: 160 } }))
      } else {
        ingredients.forEach((row) => {
          const amount = amountLabel(formatAmount(row.totalQty, row.totalUnit))
          const perServing = amountLabel(formatAmount(row.perServingQty, row.perServingUnit))
          const details = [amount, perServing && t('一份 {0}', [perServing]), row.note.trim()].filter(Boolean).join('，')
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: '• ', color: '0F766E' }),
                new TextRun({ text: bilingualIngredient(row.ingredient), bold: true, color: '111827' }),
                ...(details ? [new TextRun({ text: `  ${details}`, color: '374151' })] : []),
              ],
              spacing: { after: 60 },
            }),
          )
        })
      }

      children.push(
        new Paragraph({ children: [new TextRun({ text: t('料理步驟'), bold: true, color: '334155' })], spacing: { before: 160, after: 80 } }),
      )
      if (stepLines.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: t('尚未填寫步驟'), italics: true, color: '94A3B8' })], spacing: { after: 160 } }))
      } else {
        stepLines.forEach((line, stepIndex) => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `${stepIndex + 1}. `, bold: true, color: '0F766E' }), new TextRun({ text: line, color: '111827' })],
              spacing: { after: 100 },
            }),
          )
        })
      }
    }

    return children
  }

  const toolParagraphs = (groupId: GroupTab): Paragraph[] => {
    const tools = groupData[groupId].toolRows.filter((row) => row.tool.trim())
    if (tools.length === 0) {
      return [new Paragraph({ children: [new TextRun({ text: t('尚未填寫工具'), italics: true, color: '94A3B8' })], spacing: { after: 160 } })]
    }

    return tools.flatMap((row, index) => [
      new Paragraph({
        children: [
          new TextRun({ text: `${index + 1}. `, bold: true, color: '0F766E' }),
          new TextRun({ text: bilingualTool(row.tool), bold: true, color: '0F172A' }),
          new TextRun({ text: `  ${row.qty.trim() ? amountLabel(`${row.qty.trim()} ${row.unit.trim()}`) : `${t('未填數量')} ${row.unit.trim()}`}`, color: '111827' }),
        ],
        spacing: { after: row.note.trim() ? 40 : 120 },
      }),
      ...(row.note.trim()
        ? [new Paragraph({ children: [new TextRun({ text: `${t('備註')}：${row.note.trim()}`, color: '475569' })], spacing: { after: 120 } })]
        : []),
    ])
  }


  // Wraps an export with the busy flag and a readable error message.
  const runExport = async (task: () => Promise<string | void>, failure: string) => {
    setWordExportError('')
    setExportingWord(true)
    try {
      const problem = await task()
      if (problem) {
        setWordExportError(problem)
      } else {
        setShowWordExportOptions(false)
      }
    } catch {
      setWordExportError(failure)
    } finally {
      setExportingWord(false)
    }
  }

  const exportGroupRecipesToWord = (groupId: GroupTab, mode: WordExportMode, selectedDishId: number | null) =>
    runExport(async () => {
      const dishes = groupData[groupId].dishes
      const dishEntries = dishes
        .map((dish, index) => ({ dish, dishNumber: index + 1 }))
        .filter((entry) => mode === 'all' || entry.dish.id === selectedDishId)
      if (dishEntries.length === 0) {
        return t('找不到要下載的料理，請重新選擇。')
      }

      const today = exportDate()
      const title = mode === 'all' ? t('{0} 料理步驟手冊', [getGroupName(groupId)]) : t('{0} 單道料理步驟', [getGroupName(groupId)])
      const children = [
        ...docTitle(title, t('匯出日期：{0}', [today])),
        ...(await recipeParagraphs(groupId, dishEntries, HeadingLevel.HEADING_1, false)),
      ]
      const dishName = dishes.find((dish) => dish.id === selectedDishId)?.title.trim() || t('單道料理')
      await downloadDocx(
        children,
        mode === 'all'
          ? `${getGroupName(groupId)}-${t('料理步驟')}-${today}.docx`
          : `${getGroupName(groupId)}-${dishName}-${t('料理步驟')}-${today}.docx`,
      )
    }, t('匯出 Word 失敗，請稍後再試。'))

  const exportGroupToolsToWord = (groupId: GroupTab) =>
    runExport(async () => {
      if (!groupData[groupId].toolRows.some((row) => row.tool.trim())) {
        return t('目前沒有可匯出的工具資料。')
      }
      const today = exportDate()
      await downloadDocx(
        [...docTitle(t('{0} 所需工具清單', [getGroupName(groupId)]), t('匯出日期：{0}', [today])), ...toolParagraphs(groupId)],
        `${getGroupName(groupId)}-${t('所需工具')}-${today}.docx`,
      )
    }, t('匯出工具 Word 失敗，請稍後再試。'))

  const docxBlob = (children: Paragraph[]) =>
    Packer.toBlob(
      new DocxDocument({
        sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, children }],
      }),
    )

  const downloadDocx = async (children: Paragraph[], fileName: string) => {
    downloadBlobFile(await docxBlob(children), sanitizeFileName(fileName))
  }

  // One Word file per group, all inside one ZIP (第一組-料理步驟.docx, 第二組-料理步驟.docx, …).
  const downloadGroupZip = async (
    fileLabel: string,
    buildGroupFile: (groupId: GroupTab, today: string) => Promise<Paragraph[]>,
  ) => {
    const today = exportDate()
    const zip = new JSZip()
    const usedNames = new Set<string>()
    for (const groupId of nonSampleGroupIds) {
      // Two groups could share a name; keep both files.
      let name = sanitizeFileName(`${getGroupName(groupId)}-${fileLabel}.docx`)
      for (let copy = 2; usedNames.has(name); copy += 1) {
        name = sanitizeFileName(`${getGroupName(groupId)}-${fileLabel}-${copy}.docx`)
      }
      usedNames.add(name)
      zip.file(name, await docxBlob(await buildGroupFile(groupId, today)))
    }
    downloadBlobFile(await zip.generateAsync({ type: 'blob' }), sanitizeFileName(`${t('全部組別')}-${fileLabel}-${today}.zip`))
  }

  const groupMetaParagraph = (groupId: GroupTab): Paragraph[] => {
    const group = groupData[groupId]
    const meta = [group.teamName.trim() && `${t('廚神')}：${group.teamName.trim()}`, group.cuisineType.trim() && `${t('料理種類')}：${group.cuisineType.trim()}`]
      .filter(Boolean)
      .join('　')
    return meta ? [new Paragraph({ children: [new TextRun({ text: meta, color: '475569' })], alignment: AlignmentType.CENTER, spacing: { after: 240 } })] : []
  }

  // Admin: a ZIP with each group's dishes and steps as its own Word file.
  const exportAllGroupsRecipes = () =>
    runExport(
      () =>
        downloadGroupZip(t('料理步驟'), async (groupId, today) => {
          const dishEntries = groupData[groupId].dishes.map((dish, dishIndex) => ({ dish, dishNumber: dishIndex + 1 }))
          return [
            ...docTitle(t('{0} 料理步驟手冊', [getGroupName(groupId)]), t('匯出日期：{0}', [today])),
            ...groupMetaParagraph(groupId),
            ...(await recipeParagraphs(groupId, dishEntries, HeadingLevel.HEADING_1, false)),
          ]
        }),
      t('匯出 Word 失敗，請稍後再試。'),
    )

  // Admin: a ZIP with each group's tool list as its own Word file.
  const exportAllGroupsTools = () =>
    runExport(
      () =>
        downloadGroupZip(t('所需工具'), async (groupId, today) => [
          ...docTitle(t('{0} 所需工具清單', [getGroupName(groupId)]), t('匯出日期：{0}', [today])),
          ...groupMetaParagraph(groupId),
          ...toolParagraphs(groupId),
        ]),
      t('匯出工具 Word 失敗，請稍後再試。'),
    )

  const syncText = t(syncStatus, [missingFirebaseEnvKeys.join(', ')])
  const syncTone = syncStatus.includes('失敗') ? 'error' : syncStatus.includes('同步中') ? 'ok' : 'idle'
  const activeCollapse = getCollapse(activeGroup)
  const allDishesCollapsed = activeDishes.every((dish) => activeCollapse.dishCollapsedById[dish.id])

  const renderCollapseButton = (collapsed: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      className="icon-btn"
      onClick={onClick}
      aria-expanded={!collapsed}
      aria-label={t(collapsed ? '展開{0}' : '收合{0}', [label])}
      title={collapsed ? t('展開') : t('收合')}
    >
      <span className={`chevron ${collapsed ? 'is-collapsed' : ''}`}>
        <Icon name="chevron" />
      </span>
    </button>
  )

  const renderGroupStatus = (groupId: GroupTab) => {
    const status = groupStatusById[groupId]
    if (groupId === SAMPLE_GROUP_TAB) {
      return <span className="nav-badge">{t('範例')}</span>
    }
    if (status.filledCount === 0) {
      return <span className="nav-badge">{t('未填')}</span>
    }
    if (status.missingCount > 0) {
      return <span className="nav-badge nav-badge-warn">{t('缺 {0}', [status.missingCount])}</span>
    }
    return (
      <span className="nav-badge nav-badge-ok" aria-label={t('已完成')}>
        <Icon name="check" size={13} />
      </span>
    )
  }

  // Small photo button that opens every reference photo the groups attached to this ingredient.
  const renderReferenceThumb = (name: string, size: 'sm' | 'md' = 'sm') => {
    const references = getIngredientReferences(name)
    if (references.length === 0) {
      return null
    }

    return (
      <button
        type="button"
        className={`ref-thumb ref-thumb-${size}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openLightbox({ title: name, items: references })
        }}
        aria-label={t('查看 {0} 的參考照片（{1} 張）', [name, references.length])}
        title={t('查看參考照片')}
      >
        <img src={references[0].url} alt="" loading="lazy" />
        {references.length > 1 && <span className="ref-count">{references.length}</span>}
      </button>
    )
  }

  const renderIngredientPhoto = (groupName: GroupTab, row: IngredientRow) => {
    if (uploadingRowIds[row.id]) {
      return (
        <span className="photo-slot is-loading" aria-label={t('照片上傳中')}>
          <span className="spinner" />
        </span>
      )
    }

    if (row.image) {
      const image = row.image
      return (
        <button
          type="button"
          className="photo-slot has-image"
          onClick={() =>
            openLightbox({
              title: row.ingredient.trim() || t('食材照片'),
              items: [{ url: image.url, caption: [formatAmount(row.totalQty, row.totalUnit), row.note.trim()].filter(Boolean).join(' · ') }],
              onRemove: canEditActiveGroup ? () => removeIngredientImage(groupName, row.id) : undefined,
            })
          }
          aria-label={t('查看食材照片')}
        >
          <img src={image.url} alt="" loading="lazy" />
        </button>
      )
    }

    if (!canEditActiveGroup) {
      return <span className="photo-slot is-empty" aria-hidden="true" />
    }

    return (
      <label className="photo-slot is-empty" title={t('附上食材照片（也可以在這一列按 Ctrl+V 貼上）')}>
        <Icon name="camera" size={16} />
        <span className="visually-hidden">{t('附上食材照片')}</span>
        <input
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={async (event) => {
            const input = event.currentTarget
            await uploadIngredientImage(groupName, row.id, getImageFiles(input.files ?? []))
            input.value = ''
          }}
        />
      </label>
    )
  }

  const renderLinkPreview = (dish: Dish) => {
    if (!dish.videoUrl.trim()) {
      return null
    }

    const parsedUrl = toValidHttpUrl(dish.videoUrl)
    if (!parsedUrl) {
      return <p className="field-hint is-error">{t('網址格式不正確，請輸入 http(s) 連結。')}</p>
    }

    const normalizedPreviewUrl = parsedUrl.toString()
    const thumbnailUrl =
      getYouTubeThumbnailUrl(parsedUrl) ??
      getThumbnailPreviewUrl(normalizedPreviewUrl, resolvedThumbnailByUrl, thumbnailFetchFailedByUrl)
    const isThumbnailLoading =
      isICookRecipeUrl(parsedUrl) && !thumbnailUrl && !thumbnailFetchFailedByUrl[normalizedPreviewUrl]

    return (
      <a href={normalizedPreviewUrl} target="_blank" rel="noreferrer" className="link-card">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="link-card-thumb" loading="lazy" />
        ) : (
          <span className="link-card-icon">
            <Icon name="link" />
          </span>
        )}
        <span className="link-card-body">
          <span className="link-card-host">{parsedUrl.hostname.replace(/^www\./, '')}</span>
          <span className="link-card-sub">{isThumbnailLoading ? t('正在載入縮圖…') : t('開啟連結 ↗')}</span>
        </span>
      </a>
    )
  }

  // Admin panel to treat different spellings as one item in summaries and shopping.
  const renderNameMerge = (kind: 'ingredient' | 'tool') => {
    const isIngredient = kind === 'ingredient'
    const names = isIngredient
      ? Array.from(new Set(ingredientSummaryRows.map((row) => row.ingredient)))
      : toolSummaryRows.map((row) => row.tool)
    const typedNames = Array.from(
      new Set(
        nonSampleGroupIds.flatMap((groupId) =>
          isIngredient
            ? groupData[groupId].ingredientRows.map((row) => cleanDisplayName(row.ingredient))
            : groupData[groupId].toolRows.map((row) => cleanDisplayName(row.tool)),
        ),
      ),
    ).filter(Boolean)
    // Offer the spelling that is in the library first (砂糖 rather than 沙糖).
    const libraryKeys = new Set((isIngredient ? ingredientLibrary : toolLibrary).map(normalizeNameText))
    const suggestions = suggestDuplicateNames(names, new Set(dismissedNamePairs)).map(([a, b]): [string, string] =>
      libraryKeys.has(normalizeNameText(b)) && !libraryKeys.has(normalizeNameText(a)) ? [b, a] : [a, b],
    )
    const aliases = Object.entries(isIngredient ? ingredientAliases : toolAliases)
    const conflicts = isIngredient
      ? Array.from(new Set(ingredientSummaryRows.filter((row) => row.unitConflict).map((row) => row.ingredient)))
      : []
    const label = isIngredient ? t('食材') : t('工具')
    const datalistId = `merge-${kind}-names`

    return (
      <section className="card">
        <header className="card-head">
          <span className="store-icon" aria-hidden="true">
            <Icon name="link" size={15} />
          </span>
          <h3 className="card-title">{t('名稱整併')}</h3>
          <span className="muted small merge-intro">{t('寫法不同但其實是同一樣{0}時，在這裡合併，總表和採買就會一起加總；各組填的原始內容不會被改動。', [label])}</span>
          {suggestions.length > 0 && <span className="chip chip-warn">{t('待確認 {0}', [suggestions.length])}</span>}
        </header>
        <div className="card-body">
          {suggestions.length > 0 && (
            <div className="merge-suggestions">
              <p className="field-label">{t('可能是同一樣{0}', [label])}</p>
              {suggestions.map(([a, b]) => (
                <div key={pairKey(a, b)} className="merge-suggestion">
                  <span className="merge-pair">
                    <strong>{a}</strong>
                    <span className="muted">{t('／')}</span>
                    <strong>{b}</strong>
                  </span>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => addNameAlias(kind, b, a)}>{t('合併為「{0}」', [a])}</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => addNameAlias(kind, a, b)}>{t('合併為「{0}」', [b])}</button>
                  <button type="button" className="btn-link" onClick={() => dismissNamePair(a, b)}>
                    {t('不是同一樣')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <p className="merge-warning">{t('「{0}」有些組用重量、有些用個數（例如 g 和顆），無法自動相加，已分開列出並標示「單位不一」。 可以用調整量補正，或請該組改成同一種單位。', [conflicts.join('、')])}</p>
          )}

          <form
            className="merge-form"
            onSubmit={(event) => {
              event.preventDefault()
              addNameAlias(kind, aliasDraft.from, aliasDraft.to)
              setAliasDraft({ from: '', to: '' })
            }}
          >
            <span>{t('把')}</span>
            <input
              className="input input-sm"
              list={datalistId}
              value={aliasDraft.from}
              onChange={(event) => setAliasDraft((previous) => ({ ...previous, from: event.target.value }))}
              placeholder={isIngredient ? t('例如：洋芋') : t('例如：煎鍋')}
              aria-label={t('要合併的寫法')}
            />
            <span>{t('算成')}</span>
            <input
              className="input input-sm"
              list={datalistId}
              value={aliasDraft.to}
              onChange={(event) => setAliasDraft((previous) => ({ ...previous, to: event.target.value }))}
              placeholder={isIngredient ? t('例如：馬鈴薯') : t('例如：平底鍋')}
              aria-label={t('統一成的名稱')}
            />
            <button type="submit" className="btn btn-sm" disabled={!aliasDraft.from.trim() || !aliasDraft.to.trim()}>
              {t('合併')}
            </button>
            <datalist id={datalistId}>
              {Array.from(new Set([...names, ...typedNames])).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </form>

          {aliases.length > 0 && (
            <ul className="tag-list">
              {aliases.map(([fromKey, to]) => (
                <li key={fromKey} className="tag">
                  {fromKey} → {to}
                  <button
                    type="button"
                    className="tag-remove"
                    onClick={() => removeNameAlias(kind, fromKey)}
                    aria-label={t('取消「{0}」的合併', [fromKey])}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="muted small">
            {isIngredient
              ? t('已內建常見寫法，不用另外設定：蕃茄→番茄、起士→起司、鮮奶→牛奶、洋芋→馬鈴薯、全形／半形與空白。單位會自動換算：克、公克、公斤、斤→g；cc、毫升、公升→ml；大匙＝15ml、小匙＝5ml；個＝顆、袋＝包。')
              : t('已內建常見寫法，不用另外設定：刀子→菜刀、煎鍋→平底鍋、切菜板→砧板。工具的「個／把／支」視為同一種計數，會直接相加。')}
          </p>
        </div>
      </section>
    )
  }

  // Admin list of every ingredient (or tool) with its translation; built-in ones show as placeholders.
  const renderTranslationTable = (kind: 'ingredient' | 'tool') => {
    const isIngredient = kind === 'ingredient'
    const translator = isIngredient ? INGREDIENT_TRANSLATOR : TOOL_TRANSLATOR
    const names = Array.from(
      new Set(isIngredient ? ingredientSummaryRows.map((row) => row.ingredient) : toolSummaryRows.map((row) => row.tool)),
    )
    const missing = names.filter((name) =>
      isChineseName(name) ? !translator.toEnglish(name, nameTranslations) : !translator.toChinese(name, nameTranslations),
    ).length
    const expanded = translationsExpanded[kind] === true
    const title = isIngredient ? t('食材中英對照') : t('工具中英對照')

    return (
      <section className="card">
        <header className="card-head">
          {renderCollapseButton(!expanded, () => setTranslationsExpanded((previous) => ({ ...previous, [kind]: !expanded })), title)}
          <h3 className="card-title">{title}</h3>
          <span className="muted small merge-intro">
            {isIngredient
              ? t('英文和中文輸入的同一種食材會自動合併；沒有內建翻譯的會自動翻譯一次，翻錯可以在這裡改。')
              : t('英文和中文輸入的同一種工具會自動合併；沒有內建翻譯的會自動翻譯一次，翻錯可以在這裡改。')}
          </span>
          {missing > 0 && <span className="chip chip-warn">{t('{0} 項待翻譯', [missing])}</span>}
        </header>
        {expanded && (
          <div className="card-body">
            <div className="translation-grid">
              {names.map((name) => {
                const key = learnedKey(name)
                const builtin = isChineseName(name) ? translator.builtin[name.replace(/\s+/g, '')] : translator.toChinese(name, {})
                const learned = nameTranslations[key]
                return (
                  <label key={name} className="translation-row">
                    <span className="translation-source">{name}</span>
                    <input
                      className="cell-input"
                      value={learned ?? ''}
                      placeholder={builtin ?? t('翻譯中…')}
                      onChange={(event) => {
                        const value = event.target.value
                        setNameTranslations((previous) => {
                          const next = { ...previous }
                          if (value.trim()) {
                            next[key] = value
                          } else {
                            delete next[key]
                          }
                          return next
                        })
                      }}
                      aria-label={t('{0} 的翻譯', [name])}
                    />
                    <span className="muted small">{learned ? t('已儲存') : builtin ? t('內建') : t('等待翻譯')}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </section>
    )
  }

  const lightboxCount = lightbox?.items.length ?? 0
  const lightboxItem = lightbox ? lightbox.items[Math.min(lightboxIndex, lightboxCount - 1)] : null

  return (
    <div className={`app-shell ${navCollapsed ? 'is-nav-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setUiPrefs((previous) => ({ ...previous, navCollapsed: !previous.navCollapsed }))}
            aria-expanded={!navCollapsed}
            aria-label={navCollapsed ? t('展開選單') : t('收合選單')}
            title={navCollapsed ? t('展開選單') : t('收合選單')}
          >
            <Icon name="menu" size={18} />
          </button>
          <div className="brand-text">
            <p className="brand-eyebrow">{t('聖誕趴 · 廚藝競賽')}</p>
            <h1>{t('食材登記')}</h1>
            <span className={`sync-status sync-${syncTone}`} title={syncText}>
              <span className="sync-dot" aria-hidden="true" />
              <span className="sync-text">{syncText}</span>
            </span>
          </div>
          <span className={`sync-dot sync-dot-compact sync-${syncTone}`} title={syncText} aria-hidden="true" />
        </div>

        <nav className="nav-section nav-groups" aria-label={t('組別')}>
          <p className="nav-label">{t('組別')}</p>
          <div className="nav-list">
            {groupOrder.map((groupId) => (
              <button
                key={groupId}
                type="button"
                className={`nav-item ${currentTab === groupId ? 'is-active' : ''}`}
                aria-current={currentTab === groupId ? 'page' : undefined}
                onClick={() => setCurrentTab(groupId)}
                title={getGroupName(groupId)}
              >
                <span className="nav-item-short" aria-hidden="true">
                  {shortGroupLabel(getGroupName(groupId))}
                </span>
                <span className="nav-item-name">{getGroupName(groupId)}</span>
                {renderGroupStatus(groupId)}
              </button>
            ))}
            {adminUnlocked && (
              <button type="button" className="nav-item nav-item-add" onClick={addGroup} title={t('新增組別')}>
                <Icon name="plus" size={14} />
                <span className="nav-item-name">{t('新增組別')}</span>
              </button>
            )}
          </div>
        </nav>

        {adminUnlocked && (
          <nav className="nav-section nav-admin" aria-label={t('管理')}>
            <p className="nav-label">{t('管理')}</p>
            <div className="nav-list">
              {ADMIN_TABS.map((tabName) => (
                <button
                  key={tabName}
                  type="button"
                  className={`nav-item ${currentTab === tabName ? 'is-active' : ''}`}
                  aria-current={currentTab === tabName ? 'page' : undefined}
                  onClick={() => setCurrentTab(tabName)}
                  title={t(tabName)}
                >
                  <Icon name={ADMIN_TAB_ICONS[tabName] ?? 'list'} size={15} />
                  <span className="nav-item-name">{t(tabName)}</span>
                </button>
              ))}
            </div>
          </nav>
        )}

        <div className="sidebar-footer">
          <div className="lang-switch" role="group" aria-label={t('語言')}>
            <Icon name="globe" size={14} />
            <button
              type="button"
              className={lang === 'zh' ? 'is-active' : ''}
              onClick={() => setUiPrefs((previous) => ({ ...previous, lang: 'zh' }))}
              aria-pressed={lang === 'zh'}
            >
              {navCollapsed ? '中' : '中文'}
            </button>
            <button
              type="button"
              className={lang === 'en' ? 'is-active' : ''}
              onClick={() => setUiPrefs((previous) => ({ ...previous, lang: 'en' }))}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
          </div>
          <button
            type="button"
            className={`nav-item nav-item-quiet ${currentTab === CHANGELOG_TAB ? 'is-active' : ''}`}
            onClick={() => setCurrentTab(CHANGELOG_TAB)}
            title={t(CHANGELOG_TAB)}
          >
            <Icon name="history" size={15} />
            <span className="nav-item-name">{t(CHANGELOG_TAB)}</span>
          </button>
          <div className="admin-access">
            {adminUnlocked ? (
              <>
                <span className="admin-badge">{t('管理員模式')}</span>
                {navCollapsed ? (
                  <button
                    type="button"
                    className="sidebar-button sidebar-button-quiet"
                    onClick={lockAdminAccess}
                    aria-label={t('登出')}
                    title={t('登出')}
                  >
                    <Icon name="lock" size={14} />
                  </button>
                ) : (
                  <button type="button" className="sidebar-link" onClick={lockAdminAccess}>
                    {t('登出')}
                  </button>
                )}
              </>
            ) : navCollapsed ? (
              <button
                type="button"
                className="sidebar-button"
                onClick={() => setUiPrefs((previous) => ({ ...previous, navCollapsed: false }))}
                aria-label={t('管理員登入')}
                title={t('管理員登入')}
              >
                <Icon name="lock" size={14} />
              </button>
            ) : (
              <form
                className="lock-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  unlockAdminAccess()
                }}
              >
                <input
                  type="password"
                  className="sidebar-input"
                  placeholder={t('管理員密碼')}
                  aria-label={t('管理員密碼')}
                  value={adminPasscode}
                  onChange={(event) => setAdminPasscode(event.target.value)}
                />
                <button type="submit" className="sidebar-button" aria-label={t('解鎖管理員')}>
                  <Icon name="lock" size={14} />
                </button>
              </form>
            )}
          </div>
          {adminError && <p className="sidebar-error">{adminError}</p>}
        </div>
      </aside>

      <main className="main">
        {imageUploadError && (
          <div className="alert alert-error" role="alert">
            <span>{imageUploadError}</span>
            <button type="button" className="icon-btn" onClick={() => setImageUploadError('')} aria-label={t('關閉訊息')}>
              <Icon name="close" />
            </button>
          </div>
        )}

        <datalist id="ingredient-library-options">
          {ingredientLibrary.map((name) => (
            <option key={name} value={name} label={lang === 'en' ? ingredientLabel(name) : undefined} />
          ))}
        </datalist>

        <datalist id="tool-library-options">
          {toolLibrary.map((name) => (
            <option key={name} value={name} label={lang === 'en' ? toolLabel(name) : undefined} />
          ))}
        </datalist>

        {isGroupTab(currentTab) && (
          // Keyed by group so switching groups remounts the page and no card can carry over.
          <Fragment key={activeGroup}>
            <section className="group-header">
              <div className="group-title-row">
                <h2 className="group-title">{getGroupName(activeGroup)}</h2>
                {isActiveGroupSample && <span className="badge">{adminUnlocked ? t('範例組') : t('範例 · 唯讀')}</span>}
                <div className="group-toolbar">
                  {adminUnlocked && !isActiveGroupSample && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => renameGroup(activeGroup)}>
                        <Icon name="pencil" size={14} />
                        {t('改名')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-danger-text"
                        onClick={() => removeGroup(activeGroup)}
                      >
                        <Icon name="trash" size={14} />
                        {t('刪除組別')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAllDishesCollapsed(activeGroup, !allDishesCollapsed)}
                  >
                    {allDishesCollapsed ? t('全部展開') : t('全部收合')}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm ${showWordExportOptions ? 'is-pressed' : ''}`}
                    onClick={() => {
                      setWordExportError('')
                      setShowWordExportOptions((previous) => !previous)
                    }}
                  >
                    <Icon name="download" size={14} />
                    {t('匯出 Word')}
                  </button>
                </div>
              </div>

              {showWordExportOptions && (
                <div className="export-panel">
                  <div className="segmented" role="group" aria-label={t('料理匯出範圍')}>
                    <button
                      type="button"
                      className={wordExportMode === 'all' ? 'is-active' : ''}
                      onClick={() => setWordExportMode('all')}
                    >
                      {t('全部料理')}
                    </button>
                    <button
                      type="button"
                      className={wordExportMode === 'single' ? 'is-active' : ''}
                      onClick={() => setWordExportMode('single')}
                    >
                      {t('單道料理')}
                    </button>
                  </div>
                  {wordExportMode === 'single' && (
                    <select
                      className="input input-sm"
                      aria-label={t('選擇要下載的料理')}
                      value={selectedDishIdForWord ?? ''}
                      onChange={(event) => setSelectedDishIdForWord(Number(event.target.value) || null)}
                    >
                      {activeDishes.map((dish, index) => (
                        <option key={dish.id} value={dish.id}>
                          {index + 1}. {dish.title.trim() || t('未命名料理')}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void exportGroupRecipesToWord(activeGroup, wordExportMode, selectedDishIdForWord)
                    }}
                    disabled={exportingWord || (wordExportMode === 'single' && selectedDishIdForWord === null)}
                  >
                    {exportingWord ? t('產生中…') : t('下載料理步驟')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void exportGroupToolsToWord(activeGroup)
                    }}
                    disabled={exportingWord}
                  >
                    {t('下載工具清單')}
                  </button>
                  {adminUnlocked && (
                    <>
                      <span className="export-divider" aria-hidden="true" />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportAllGroupsRecipes()} disabled={exportingWord}>
                        {t('全部組別料理')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportAllGroupsTools()} disabled={exportingWord}>
                        {t('全部組別工具')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {wordExportError && <p className="field-hint is-error">{wordExportError}</p>}

              <fieldset className="plain-fieldset meta-row" disabled={!canEditActiveGroup}>
                <label className="field">
                  <span className="field-label">
                    {t('廚神')}{' '}<span className="req">*</span>
                  </span>
                  <input
                    className={`input ${!groupData[activeGroup].teamName.trim() ? 'is-missing' : ''}`}
                    value={groupData[activeGroup].teamName}
                    onChange={(event) => updateGroupMeta(activeGroup, 'teamName', event.target.value)}
                    placeholder={t('隊名或成員名字')}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    {t('料理種類')}{' '}<span className="req">*</span>
                  </span>
                  <input
                    className={`input ${!groupData[activeGroup].cuisineType.trim() ? 'is-missing' : ''}`}
                    value={groupData[activeGroup].cuisineType}
                    onChange={(event) => updateGroupMeta(activeGroup, 'cuisineType', event.target.value)}
                    placeholder={t('例如：義式、台式、日式')}
                  />
                </label>
              </fieldset>

              {canEditActiveGroup && (
                <ul className="tip-list">
                  <li>
                    <strong>{t('最快的填法：')}</strong>{t('在料理下方的輸入框打「番茄 6顆」按 Enter，或把整份食材清單直接貼上，會自動拆成一列一列。')}
                  </li>
                  <li>
                    <strong>{t('怕買錯？')}</strong>{t('點食材左邊的')}{' '}<Icon name="camera" size={13} />{' '}{t('附上照片，或點一下該列再按 Ctrl+V 貼上圖片。')}
                  </li>
                </ul>
              )}
            </section>

            {activeDishes.map((dish, dishIndex) => {
              const dishIngredientRows = activeIngredientRows.filter((row) => row.dishId === dish.id)
              const filledIngredientCount = dishIngredientRows.filter((row) => row.ingredient.trim()).length
              const missingTotalCount = dishIngredientRows.filter((row) => invalidIngredientRowIds.has(row.id)).length
              const isDishCollapsed = Boolean(activeCollapse.dishCollapsedById[dish.id])
              const isUploading = Boolean(uploadingDishIds[dish.id])
              const canAddImage = canEditActiveGroup && dish.images.length < 2 && !isUploading
              const quickAddDraft = quickAddDrafts[dish.id] ?? ''

              return (
                <section
                  key={`input-${dish.id}`}
                  className={`card dish-card ${dragOverDishId === dish.id ? 'is-drag-over' : ''}`}
                  onPaste={canAddImage ? (event) => handleDishPaste(activeGroup, dish.id, event) : undefined}
                  onDragOver={
                    canAddImage
                      ? (event) => {
                          event.preventDefault()
                          setDragOverDishId(dish.id)
                        }
                      : undefined
                  }
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverDishId(null)
                    }
                  }}
                  onDrop={canAddImage ? (event) => handleDishDrop(activeGroup, dish.id, event) : undefined}
                >
                  <header className="card-head dish-head">
                    {renderCollapseButton(isDishCollapsed, () => toggleDishCollapse(activeGroup, dish.id), t('料理'))}
                    <span className="dish-index">{dishIndex + 1}</span>
                    <input
                      className={`dish-title-input ${!dish.title.trim() ? 'is-missing' : ''}`}
                      value={dish.title}
                      onChange={(event) => updateDish(activeGroup, dish.id, 'title', event.target.value)}
                      placeholder={t('料理名稱（必填）')}
                      aria-label={t('料理 {0} 名稱', [dishIndex + 1])}
                      disabled={!canEditActiveGroup}
                    />
                    <div className="dish-meta">
                      <span className="chip">{t('{0} 項食材', [filledIngredientCount])}</span>
                      {missingTotalCount > 0 && <span className="chip chip-warn">{t('缺數量 {0}', [missingTotalCount])}</span>}
                      <span className="chip chip-optional">{t('{0}/2 圖', [dish.images.length])}</span>
                    </div>
                    {dishIndex >= MIN_DISH_COUNT && canEditActiveGroup && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => removeDish(activeGroup, dish.id)}
                        aria-label={t('刪除料理 {0}', [dishIndex + 1])}
                        title={t('刪除料理')}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </header>

                  <div className={`collapse ${isDishCollapsed ? 'is-collapsed' : ''}`}>
                    <div className="collapse-inner">
                      <fieldset className="plain-fieldset dish-body" disabled={!canEditActiveGroup}>
                        <div className="dish-main">
                          {dishIngredientRows.length > 0 && (
                            <table className="grid-table ingredient-table">
                              <thead>
                                <tr>
                                  <th aria-label={t('照片')} />
                                  <th>{t('食材')}</th>
                                  <th>
                                    {t('總量')}{' '}<span className="req">*</span>
                                  </th>
                                  <th>{t('一份量')}</th>
                                  <th>{t('備註')}</th>
                                  <th aria-label={t('操作')} />
                                </tr>
                              </thead>
                              <tbody>
                                {dishIngredientRows.map((row) => {
                                  const isInvalid = invalidIngredientRowIds.has(row.id)
                                  const isBlankRow = isBlankIngredientRow(row)

                                  return (
                                    <tr
                                      key={row.id}
                                      className={isInvalid ? 'is-invalid' : ''}
                                      onPaste={
                                        canEditActiveGroup ? (event) => handleRowImagePaste(activeGroup, row.id, event) : undefined
                                      }
                                      onDragOver={
                                        canEditActiveGroup
                                          ? (event) => {
                                              if (event.dataTransfer.types.includes('Files')) {
                                                event.preventDefault()
                                                event.stopPropagation()
                                              }
                                            }
                                          : undefined
                                      }
                                      onDrop={
                                        canEditActiveGroup ? (event) => handleRowImageDrop(activeGroup, row.id, event) : undefined
                                      }
                                    >
                                      <td className="cell-photo">{renderIngredientPhoto(activeGroup, row)}</td>
                                      <td className="cell-name">
                                        <input
                                          className="cell-input"
                                          value={row.ingredient}
                                          onChange={(event) =>
                                            updateIngredientRow(activeGroup, row.id, 'ingredient', event.target.value)
                                          }
                                          onPaste={(event) =>
                                            handleIngredientNamePaste(activeGroup, dish.id, row.id, event)
                                          }
                                          placeholder={isBlankRow ? t('例如：番茄') : t('食材名稱')}
                                          aria-label={t('食材')}
                                          list="ingredient-library-options"
                                        />
                                        {entryHint(row.ingredient) && (
                                          <span className="name-translation" aria-hidden="true">
                                            {entryHint(row.ingredient)}
                                          </span>
                                        )}
                                      </td>
                                      <td className="cell-amount" data-label={t('總量 *')}>
                                        <input
                                          className={`cell-input ${isInvalid ? 'is-missing' : ''}`}
                                          value={row.totalQty + row.totalUnit}
                                          onChange={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'total', event.target.value)
                                          }
                                          onBlur={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'total', event.target.value, true)
                                          }
                                          placeholder={isInvalid ? t('必填，如 6顆') : isBlankRow ? t('6顆') : ''}
                                          aria-label={t('總量（數字加單位，例如 6顆）')}
                                          aria-invalid={isInvalid}
                                        />
                                      </td>
                                      <td className="cell-amount" data-label={t('一份量')}>
                                        <input
                                          className="cell-input"
                                          value={row.perServingQty + row.perServingUnit}
                                          onChange={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'perServing', event.target.value)
                                          }
                                          onBlur={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'perServing', event.target.value, true)
                                          }
                                          placeholder={isBlankRow ? t('1顆（選填）') : ''}
                                          aria-label={t('一份量（選填，例如 1顆）')}
                                        />
                                      </td>
                                      <td className="cell-note">
                                        <input
                                          className="cell-input"
                                          value={row.note}
                                          onChange={(event) =>
                                            updateIngredientRow(activeGroup, row.id, 'note', event.target.value)
                                          }
                                          placeholder={t('備註')}
                                          aria-label={t('備註')}
                                        />
                                      </td>
                                      <td className="cell-action">
                                        <button
                                          type="button"
                                          className="icon-btn icon-btn-danger"
                                          onClick={() => removeIngredientRow(activeGroup, row)}
                                          aria-label={t('刪除食材')}
                                          title={t('刪除')}
                                        >
                                          <Icon name="close" size={14} />
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          )}

                          {canEditActiveGroup ? (
                            <div className="quick-add">
                              <div className="quick-add-box">
                                <Icon name="plus" size={16} />
                                <textarea
                                  className="quick-add-input"
                                  rows={1}
                                  value={quickAddDraft}
                                  onChange={(event) => {
                                    setQuickAddDrafts((previous) => ({ ...previous, [dish.id]: event.target.value }))
                                    setQuickAddNotices((previous) => ({ ...previous, [dish.id]: '' }))
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                      event.preventDefault()
                                      submitQuickAdd(activeGroup, dish.id, quickAddDraft)
                                    }
                                  }}
                                  onPaste={(event) => {
                                    const text = event.clipboardData.getData('text')
                                    if (looksLikeIngredientList(text)) {
                                      event.preventDefault()
                                      submitQuickAdd(activeGroup, dish.id, `${quickAddDraft}\n${text}`)
                                    }
                                  }}
                                  placeholder={t('輸入「番茄 6顆」按 Enter，或貼上整份清單')}
                                  aria-label={t('快速新增食材')}
                                />
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => submitQuickAdd(activeGroup, dish.id, quickAddDraft)}
                                  disabled={!quickAddDraft.trim()}
                                >
                                  {t('加入')}
                                </button>
                              </div>
                              <div className="quick-add-foot">
                                {quickAddNotices[dish.id] ? (
                                  <span className="quick-add-notice">
                                    <Icon name="check" size={14} />
                                    {quickAddNotices[dish.id]}
                                  </span>
                                ) : (
                                  <span className="muted small">{t('可用「、」或換行分隔多項食材')}</span>
                                )}
                                <button
                                  type="button"
                                  className="btn-link"
                                  onClick={() => addIngredientRow(activeGroup, dish.id)}
                                >
                                  {t('新增空白列')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            dishIngredientRows.length === 0 && <p className="empty-inline">{t('尚未填寫食材')}</p>
                          )}
                        </div>

                        <div className="dish-side">
                          <label className="field">
                            <span className="field-label">{t('食譜／影片網址')}</span>
                            <input
                              className="input input-sm"
                              value={dish.videoUrl}
                              onChange={(event) => updateDish(activeGroup, dish.id, 'videoUrl', event.target.value)}
                              onBlur={(event) =>
                                updateDish(activeGroup, dish.id, 'videoUrl', normalizeUrlInput(event.target.value))
                              }
                              placeholder={t('YouTube 或食譜網址（選填）')}
                            />
                          </label>
                          {renderLinkPreview(dish)}

                          <div className="field">
                            <span className="field-label">
                              {t('成品參考圖')}{' '}<span className="muted">{dish.images.length}/2</span>
                            </span>
                            <div className="image-strip">
                              {dish.images.map((image, imageIndex) => (
                                <figure key={`${dish.id}-${imageIndex}`} className="thumb">
                                  <button
                                    type="button"
                                    className="thumb-open"
                                    onClick={() =>
                                      openLightbox(
                                        {
                                          title: dish.title.trim() || t('料理 {0}', [dishIndex + 1]),
                                          items: dish.images.map((item) => ({ url: item.url, caption: '' })),
                                        },
                                        imageIndex,
                                      )
                                    }
                                    aria-label={t('查看圖片 {0}', [imageIndex + 1])}
                                  >
                                    <img
                                      src={image.url}
                                      alt={t('{0} 圖片 {1}', [dish.title || t('料理 {0}', [dishIndex + 1]), imageIndex + 1])}
                                    />
                                  </button>
                                  {canEditActiveGroup && (
                                    <button
                                      type="button"
                                      className="thumb-remove"
                                      onClick={() => removeDishImage(activeGroup, dish.id, imageIndex)}
                                      aria-label={t('刪除圖片')}
                                      title={t('刪除圖片')}
                                    >
                                      <Icon name="close" size={12} />
                                    </button>
                                  )}
                                </figure>
                              ))}
                              {canAddImage && (
                                <div
                                  className="image-drop"
                                  tabIndex={0}
                                  aria-label={t('新增圖片：點這裡後按 Ctrl+V 貼上、拖曳圖片，或使用下方按鈕')}
                                >
                                  <span className="image-drop-text">
                                    <Icon name="image" size={18} />
                                    {t('點這裡後 Ctrl+V 貼上，或拖曳圖片')}
                                  </span>
                                  <span className="image-drop-actions">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs"
                                      onClick={() => {
                                        void pasteImageFromClipboard(activeGroup, dish.id)
                                      }}
                                    >
                                      <Icon name="clipboard" size={13} />
                                      {t('貼上')}
                                    </button>
                                    <label className="btn btn-ghost btn-xs">
                                      <Icon name="image" size={13} />
                                      {t('選擇檔案')}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="visually-hidden"
                                        onChange={async (event) => {
                                          const input = event.currentTarget
                                          await handleDishImageUpload(activeGroup, dish.id, getImageFiles(input.files ?? []))
                                          input.value = ''
                                        }}
                                      />
                                    </label>
                                  </span>
                                </div>
                              )}
                              {isUploading && (
                                <div className="image-uploading">
                                  <span className="muted small">{t('上傳中… {0}%', [uploadProgressByDish[dish.id] ?? 0])}</span>
                                  <div className="progress-track">
                                    <div
                                      className="progress-bar"
                                      style={{ width: `${uploadProgressByDish[dish.id] ?? 0}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                              {!canEditActiveGroup && dish.images.length === 0 && <p className="empty-inline">{t('尚無圖片')}</p>}
                            </div>
                          </div>

                          <label className="field">
                            <span className="field-label">
                              {t('料理步驟')}{' '}<span className="muted">{t('每行一個步驟')}</span>
                            </span>
                            {canEditActiveGroup ? (
                              <textarea
                                className="input textarea"
                                value={dish.steps}
                                onChange={(event) => updateDish(activeGroup, dish.id, 'steps', event.target.value)}
                                placeholder={t('例如：\n番茄切塊、雞蛋打散\n熱鍋下油炒蛋\n加入番茄拌炒調味')}
                                rows={4}
                              />
                            ) : (
                              <pre className="steps-readonly">{dish.steps.trim() || t('（尚未填寫）')}</pre>
                            )}
                          </label>
                        </div>
                      </fieldset>
                    </div>
                  </div>
                </section>
              )
            })}

            {canEditActiveGroup && (
              <button type="button" className="btn-add-dish" onClick={() => addDish(activeGroup)}>
                <Icon name="plus" size={16} />
                {t('新增料理')}
              </button>
            )}

            <section className="card">
              <header className="card-head">
                {renderCollapseButton(activeCollapse.toolsCollapsed, () => toggleToolsCollapse(activeGroup), t('工具'))}
                <h3 className="card-title">{t('工具')}</h3>
                <span className="muted small">{t('不分料理')}</span>
                <div className="dish-meta">
                  <span className="chip">{t('{0} 項', [activeToolRows.filter((row) => row.tool.trim()).length])}</span>
                  {invalidToolRowIds.size > 0 && <span className="chip chip-warn">{t('缺數量 {0}', [invalidToolRowIds.size])}</span>}
                </div>
              </header>

              <div className={`collapse ${activeCollapse.toolsCollapsed ? 'is-collapsed' : ''}`}>
                <div className="collapse-inner">
                  <fieldset className="plain-fieldset card-body" disabled={!canEditActiveGroup}>
                    <table className="grid-table tool-table">
                      <thead>
                        <tr>
                          <th>{t('工具')}</th>
                          <th>
                            {t('數量')}{' '}<span className="req">*</span>
                          </th>
                          <th>{t('單位')}</th>
                          <th>{t('備註')}</th>
                          <th aria-label={t('操作')} />
                        </tr>
                      </thead>
                      <tbody>
                        {activeToolRows.map((row) => {
                          const isInvalid = invalidToolRowIds.has(row.id)
                          const isBlankRow = ![row.tool, row.qty, row.unit, row.note].some((value) => value.trim())

                          return (
                            <tr key={row.id} className={isInvalid ? 'is-invalid' : ''}>
                              <td className="cell-name" data-label={t('工具')}>
                                <input
                                  className="cell-input"
                                  value={row.tool}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'tool', event.target.value)}
                                  placeholder={isBlankRow ? t('例如：炒鍋') : t('工具名稱')}
                                  aria-label={t('工具')}
                                  list="tool-library-options"
                                />
                                {toolEntryHint(row.tool) && (
                                  <span className="name-translation" aria-hidden="true">
                                    {toolEntryHint(row.tool)}
                                  </span>
                                )}
                              </td>
                              <td className="cell-qty" data-label={t('數量 *')}>
                                <input
                                  className={`cell-input ${isInvalid ? 'is-missing' : ''}`}
                                  inputMode="decimal"
                                  value={row.qty}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'qty', event.target.value)}
                                  placeholder={isInvalid ? t('必填') : isBlankRow ? '1' : ''}
                                  aria-label={t('數量')}
                                  aria-invalid={isInvalid}
                                />
                              </td>
                              <td className="cell-unit" data-label={t('單位')}>
                                <input
                                  className="cell-input"
                                  value={row.unit}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'unit', event.target.value)}
                                  placeholder={isBlankRow ? t('個') : ''}
                                  aria-label={t('單位')}
                                />
                              </td>
                              <td className="cell-note" data-label={t('備註')}>
                                <input
                                  className="cell-input"
                                  value={row.note}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'note', event.target.value)}
                                  placeholder={t('備註')}
                                  aria-label={t('備註')}
                                />
                              </td>
                              <td className="cell-action">
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-danger"
                                  onClick={() => removeToolRow(activeGroup, row)}
                                  aria-label={t('刪除工具')}
                                  title={t('刪除')}
                                >
                                  <Icon name="close" size={14} />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {activeToolRows.length === 0 && <p className="empty-inline">{t('尚未填寫工具')}</p>}
                    {canEditActiveGroup && (
                      <button type="button" className="btn-add-row" onClick={() => addToolRow(activeGroup)}>
                        <Icon name="plus" size={14} />
                        {t('新增工具')}
                      </button>
                    )}
                  </fieldset>
                </div>
              </div>
            </section>

            {(invalidIngredientRowIds.size > 0 || invalidToolRowIds.size > 0) && (
              <div className="alert alert-warn">
                {invalidIngredientRowIds.size > 0 && (
                  <span>{t('有 {0} 項食材還沒填總量，不會列入食材總表。', [invalidIngredientRowIds.size])}</span>
                )}
                {invalidToolRowIds.size > 0 && <span>{t('有 {0} 項工具還沒填數量，不會列入工具總表。', [invalidToolRowIds.size])}</span>}
              </div>
            )}
          </Fragment>
        )}

        {currentTab === '食材總表' && adminUnlocked && (
          <>
          {renderNameMerge('ingredient')}
          {renderTranslationTable('ingredient')}
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">{t('食材總表')}</h2>
              <span className="muted small">{t('共 {0} 項 · 有相機圖示的可點開看各組附的照片', [ingredientSummaryRows.length])}</span>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="col-check">{t('備料')}</th>
                    <th>{t('食材')}</th>
                    <th className="num">{t('一份數量總和')}</th>
                    <th>{t('單位')}</th>
                    <th className="num">{t('總量總和')}</th>
                    <th className="num">{t('調整量')}</th>
                    <th className="num">{t('最終總量')}</th>
                    <th>{t('總量單位')}</th>
                    <th>{t('備註')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="empty">
                        {t('尚無可彙總資料')}
                      </td>
                    </tr>
                  )}
                  {ingredientSummaryRows.map((row) => {
                    const key = row.key
                    const adjustment = toNumber(ingredientAdjustments[key] ?? '')
                    const finalTotal = row.sumTotalQty + adjustment
                    const isPrepared = Boolean(preparedSummaryIngredients[key])

                    return (
                      <tr key={key} className={isPrepared ? 'is-done' : ''}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={isPrepared}
                            onChange={(event) =>
                              setPreparedSummaryIngredients((previous) => ({
                                ...previous,
                                [key]: event.target.checked,
                              }))
                            }
                            aria-label={t('標記 {0} 是否已備料', [row.ingredient])}
                          />
                        </td>
                        <td className="strong">
                          <span className="name-with-thumb">
                            {renderReferenceThumb(row.ingredient)}
                            <span className="merged-name">
                              {ingredientLabel(row.ingredient)}
                              {row.unitConflict && <span className="chip chip-warn">{t('單位不一')}</span>}
                              {renderVariants(row.variants, ingredientLabel(row.ingredient))}
                            </span>
                          </span>
                        </td>
                        <td className="num">{row.perServingMixed ? t('單位不一') : formatNumber(row.sumPerServingQty)}</td>
                        <td>{row.perServingMixed ? '' : row.perServingUnit}</td>
                        <td className="num">
                          {formatNumber(row.sumTotalQty)}
                          {row.vagueAmounts.length > 0 && <span className="merged-from">{t('另有：{0}', [row.vagueAmounts.join('、')])}</span>}
                        </td>
                        <td className="num">
                          <input
                            className="cell-input cell-input-num"
                            inputMode="decimal"
                            value={ingredientAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setIngredientAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder="0"
                            aria-label={t('{0} 調整量', [row.ingredient])}
                          />
                        </td>
                        <td className="num strong">{formatNumber(finalTotal)}</td>
                        <td>{lang === 'en' ? unitToEnglish(row.totalUnit) : row.totalUnit}</td>
                        <td className="muted">{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          </>
        )}

        {currentTab === '工具總表' && adminUnlocked && (
          <>
          {renderNameMerge('tool')}
          {renderTranslationTable('tool')}
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">{t('工具總表')}</h2>
              <span className="muted small">{t('共 {0} 項', [toolSummaryRows.length])}</span>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="col-check">{t('備妥')}</th>
                    <th>{t('工具')}</th>
                    <th className="num">{t('需求數量')}</th>
                    <th className="num">{t('調整量')}</th>
                    <th className="num">{t('最終數量')}</th>
                    <th>{t('單位')}</th>
                    <th>{t('備註')}</th>
                  </tr>
                </thead>
                <tbody>
                  {toolSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty">
                        {t('尚無可彙總資料')}
                      </td>
                    </tr>
                  )}
                  {toolSummaryRows.map((row) => {
                    const key = row.key
                    const adjustment = toNumber(toolAdjustments[key] ?? '')
                    const finalTotal = row.sumQty + adjustment
                    const isPrepared = Boolean(preparedSummaryTools[key])

                    return (
                      <tr key={key} className={isPrepared ? 'is-done' : ''}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={isPrepared}
                            onChange={(event) =>
                              setPreparedSummaryTools((previous) => ({
                                ...previous,
                                [key]: event.target.checked,
                              }))
                            }
                            aria-label={t('標記 {0} 是否已備妥', [row.tool])}
                          />
                        </td>
                        <td className="strong">
                          <span className="merged-name">
                            {toolLabel(row.tool)}
                            {renderVariants(row.variants, toolLabel(row.tool))}
                          </span>
                        </td>
                        <td className="num">{formatNumber(row.sumQty)}</td>
                        <td className="num">
                          <input
                            className="cell-input cell-input-num"
                            inputMode="decimal"
                            value={toolAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setToolAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder="0"
                            aria-label={t('{0} 調整量', [row.tool])}
                          />
                        </td>
                        <td className="num strong">{formatNumber(finalTotal)}</td>
                        <td>{lang === 'en' ? unitToEnglish(row.unit) : row.unit}</td>
                        <td className="muted">{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          </>
        )}

        {currentTab === TOOL_LIBRARY_TAB && adminUnlocked && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">{t('工具庫')}</h2>
              <span className="muted small">{t('提供給各組工具欄位作為建議選項 · 共 {0} 項', [toolLibrary.length])}</span>
            </header>
            <div className="card-body">
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  addLibraryTool()
                }}
              >
                <input
                  className="input input-sm"
                  value={toolLibraryInput}
                  onChange={(event) => setToolLibraryInput(event.target.value)}
                  placeholder={t('輸入工具名稱，例如：量杯')}
                />
                <button type="submit" className="btn btn-sm">
                  {t('加入')}
                </button>
              </form>
              {toolLibraryError && <p className="field-hint is-error">{toolLibraryError}</p>}
              {toolLibrary.length === 0 ? (
                <p className="empty">{t('目前工具庫沒有資料')}</p>
              ) : (
                <ul className="tag-list">
                  {toolLibrary.map((name) => (
                    <li key={name} className="tag">
                      {name}
                      {lang === 'en' && !sameName(toolLabel(name), name) && <span className="tag-translation">{toolLabel(name)}</span>}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => removeLibraryTool(name)}
                        aria-label={t('刪除 {0}', [name])}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {currentTab === INGREDIENT_LIBRARY_TAB && adminUnlocked && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">{t('食材庫')}</h2>
              <span className="muted small">{t('提供給各組食材欄位作為建議選項（蛋奶素，不含五辛）· 共 {0} 項', [ingredientLibrary.length])}</span>
            </header>
            <div className="card-body">
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  addLibraryIngredient()
                }}
              >
                <input
                  className="input input-sm"
                  value={libraryInput}
                  onChange={(event) => setLibraryInput(event.target.value)}
                  placeholder={t('輸入食材名稱，例如：雞蛋')}
                />
                <button type="submit" className="btn btn-sm">
                  {t('加入')}
                </button>
              </form>
              {libraryError && <p className="field-hint is-error">{libraryError}</p>}
              {ingredientLibrary.length === 0 ? (
                <p className="empty">{t('目前食材庫沒有資料')}</p>
              ) : (
                <ul className="tag-list">
                  {ingredientLibrary.map((name) => (
                    <li key={name} className="tag">
                      {name}
                      {lang === 'en' && !sameName(ingredientLabel(name), name) && (
                        <span className="tag-translation">{ingredientLabel(name)}</span>
                      )}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => removeLibraryIngredient(name)}
                        aria-label={t('刪除 {0}', [name])}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {currentTab === GROUP_INGREDIENT_LIBRARY_TAB && adminUnlocked && (
          <>
            <header className="page-head page-head-row">
              <div>
                <h2 className="group-title">{t('各組食材表')}</h2>
                <p className="muted small">{t('各組明細，不進行跨組合併。勾選「備料」記錄已備妥的項目。')}</p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => void exportAllGroupsRecipes()} disabled={exportingWord}>
                <Icon name="download" size={14} />
                {exportingWord ? t('產生中…') : t('匯出全部組別料理（ZIP）')}
              </button>
            </header>
            {wordExportError && <p className="field-hint is-error">{wordExportError}</p>}
            {ingredientLibraryByGroup.map(({ groupId, groupName, rows }) => {
              const isCollapsed = getCollapse(groupId).groupIngredientTableCollapsed

              return (
                <section key={groupId} className="card">
                  <header className="card-head">
                    {renderCollapseButton(isCollapsed, () => toggleGroupIngredientTableCollapse(groupId), groupName)}
                    <h3 className="card-title">{groupName}</h3>
                    <span className="chip">{t('{0} 項', [rows.length])}</span>
                  </header>
                  <div className={`collapse ${isCollapsed ? 'is-collapsed' : ''}`}>
                    <div className="collapse-inner table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th className="col-check">{t('備料')}</th>
                            <th>{t('料理')}</th>
                            <th>{t('食材')}</th>
                            <th className="num">{t('一份數量')}</th>
                            <th>{t('一份單位')}</th>
                            <th className="num">{t('總量')}</th>
                            <th>{t('總量單位')}</th>
                            <th>{t('備註')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 && (
                            <tr>
                              <td colSpan={8} className="empty">
                                {t('此組目前尚未填寫食材')}
                              </td>
                            </tr>
                          )}
                          {rows.map((row) => {
                            const preparedKey = `${groupId}-${row.id}`
                            const isPrepared = Boolean(preparedGroupIngredients[preparedKey])
                            const rowImage = row.image

                            return (
                              <tr key={row.id} className={isPrepared ? 'is-done' : ''}>
                                <td className="col-check">
                                  <input
                                    type="checkbox"
                                    className="checkbox"
                                    checked={isPrepared}
                                    onChange={(event) =>
                                      setPreparedGroupIngredients((previous) => ({
                                        ...previous,
                                        [preparedKey]: event.target.checked,
                                      }))
                                    }
                                    aria-label={t('標記 {0} {1} 是否已備料', [groupName, row.ingredient])}
                                  />
                                </td>
                                <td className="muted">{row.dishName}</td>
                                <td className="strong">
                                  <span className="name-with-thumb">
                                    {rowImage && (
                                      <button
                                        type="button"
                                        className="ref-thumb ref-thumb-sm"
                                        onClick={() =>
                                          openLightbox({
                                            title: row.ingredient,
                                            items: [{ url: rowImage.url, caption: `${groupName} · ${row.dishName}` }],
                                          })
                                        }
                                        aria-label={t('查看 {0} 的照片', [row.ingredient])}
                                      >
                                        <img src={rowImage.url} alt="" loading="lazy" />
                                      </button>
                                    )}
                                    <span className="merged-name">
                                      {row.ingredient}
                                      {!sameName(ingredientLabel(row.ingredient), row.ingredient) && (
                                        <span className="merged-from">{t('統計為「{0}」', [ingredientLabel(row.ingredient)])}</span>
                                      )}
                                    </span>
                                  </span>
                                </td>
                                <td className="num">{row.perServingQty || '–'}</td>
                                <td>{row.perServingUnit || '–'}</td>
                                <td className="num">{row.totalQty || '–'}</td>
                                <td>{row.totalUnit || '–'}</td>
                                <td className="muted">{row.note}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              )
            })}
          </>
        )}

        {currentTab === GROUP_TOOL_LIBRARY_TAB && adminUnlocked && (
          <>
            <header className="page-head page-head-row">
              <div>
                <h2 className="group-title">{t('各組工具表')}</h2>
                <p className="muted small">{t('各組工具明細，不進行跨組合併。')}</p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => void exportAllGroupsTools()} disabled={exportingWord}>
                <Icon name="download" size={14} />
                {exportingWord ? t('產生中…') : t('匯出全部組別工具（ZIP）')}
              </button>
            </header>
            {wordExportError && <p className="field-hint is-error">{wordExportError}</p>}
            {toolLibraryByGroup.map(({ groupId, groupName, rows }) => {
              const isCollapsed = getCollapse(groupId).groupToolTableCollapsed

              return (
                <section key={groupId} className="card">
                  <header className="card-head">
                    {renderCollapseButton(isCollapsed, () => toggleGroupToolTableCollapse(groupId), groupName)}
                    <h3 className="card-title">{groupName}</h3>
                    <span className="chip">{t('{0} 項', [rows.length])}</span>
                  </header>
                  <div className={`collapse ${isCollapsed ? 'is-collapsed' : ''}`}>
                    <div className="collapse-inner table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th className="col-check">{t('備妥')}</th>
                            <th>{t('工具')}</th>
                            <th className="num">{t('需求數量')}</th>
                            <th>{t('單位')}</th>
                            <th>{t('備註')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 && (
                            <tr>
                              <td colSpan={5} className="empty">
                                {t('此組目前尚未填寫工具')}
                              </td>
                            </tr>
                          )}
                          {rows.map((row) => {
                            const preparedKey = `${groupId}-tool-${row.id}`
                            const isPrepared = Boolean(preparedGroupTools[preparedKey])

                            return (
                              <tr key={row.id} className={isPrepared ? 'is-done' : ''}>
                                <td className="col-check">
                                  <input
                                    type="checkbox"
                                    className="checkbox"
                                    checked={isPrepared}
                                    onChange={(event) =>
                                      setPreparedGroupTools((previous) => ({
                                        ...previous,
                                        [preparedKey]: event.target.checked,
                                      }))
                                    }
                                    aria-label={t('標記 {0} {1} 是否已備妥', [groupName, row.tool])}
                                  />
                                </td>
                                <td className="strong">
                                  <span className="merged-name">
                                    {row.tool}
                                    {!sameName(toolLabel(row.tool), row.tool) && (
                                      <span className="merged-from">{t('統計為「{0}」', [toolLabel(row.tool)])}</span>
                                    )}
                                  </span>
                                </td>
                                <td className="num">{row.qty || '–'}</td>
                                <td>{(lang === 'en' ? unitToEnglish(row.unit) : row.unit) || '–'}</td>
                                <td className="muted">{row.note}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              )
            })}
          </>
        )}

        {currentTab === SHOPPING_LIST_TAB &&
          adminUnlocked &&
          (() => {
            const storeStats = shoppingStores.map((store) => ({ store, stats: getStoreStats(store) }))
            const assignedItemCount = storeStats.reduce((sum, { stats }) => sum + stats.total, 0)
            const purchasedCount = storeStats.reduce((sum, { stats }) => sum + stats.purchased, 0)
            const spentTotal = storeStats.reduce((sum, { stats }) => sum + stats.spent, 0)
            const estimatedTotal =
              storeStats.reduce((sum, { stats }) => sum + stats.estimated, 0) +
              shoppingIngredientOverviewRows
                .filter((row) => !row.assignedStoreId)
                .reduce((sum, row) => sum + (row.suggestion.estimate?.cost ?? 0), 0)
            const purchasedWithoutPrice = shoppingStores.reduce(
              (sum, store) =>
                sum +
                (toNumber(store.receiptTotal ?? '') > 0
                  ? 0
                  : store.items.filter((item) => item.purchased && !item.price.trim()).length),
              0,
            )
            const progress = assignedItemCount > 0 ? Math.round((purchasedCount / assignedItemCount) * 100) : 0
            // The same ingredient in two stores would be bought twice.
            const storesByIngredient = new Map<string, { name: string; stores: string[] }>()
            shoppingStores.forEach((store) =>
              store.items.forEach((item) => {
                if (!item.ingredient.trim()) {
                  return
                }
                const name = canonicalIngredient(item.ingredient)
                const entry = storesByIngredient.get(name.key) ?? { name: name.display, stores: [] }
                entry.stores.push(store.storeName.trim() || t('未命名商店'))
                storesByIngredient.set(name.key, entry)
              }),
            )
            const duplicated = Array.from(storesByIngredient.values()).filter((entry) => entry.stores.length > 1)

            return (
              <>
                <header className="page-head">
                  <h2 className="group-title">{t('食材採買')}</h2>
                  <p className="muted small">
                    {t('① 分配每樣食材去哪買 → ② 到店打開「採買模式」用手機邊買邊勾、順手記金額 → ③ 填收據總額，自動算出花費和各組分攤。')}
                  </p>
                </header>

                <div className="kpi-grid">
                  <div className="kpi">
                    <span className="kpi-label">{t('需採買')}</span>
                    <strong className="kpi-value">{shoppingIngredientOverviewRows.length}</strong>
                    <span className="kpi-sub">{t('項食材')}</span>
                  </div>
                  <div className={`kpi ${unassignedShoppingIngredientCount > 0 ? 'is-warn' : 'is-ok'}`}>
                    <span className="kpi-label">{t('待分配')}</span>
                    <strong className="kpi-value">{unassignedShoppingIngredientCount}</strong>
                    <span className="kpi-sub">
                      {unassignedShoppingIngredientCount > 0 ? t('項還沒決定去哪買') : t('全部都已分配')}
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-label">{t('採買進度')}</span>
                    <strong className="kpi-value">
                      {purchasedCount}
                      <span className="kpi-of">/{assignedItemCount}</span>
                    </strong>
                    <span className="kpi-bar" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-label">{t('預估花費')}</span>
                    <strong className="kpi-value">{formatMoney(estimatedTotal)}</strong>
                    <span className="kpi-sub">{t('依價格參考估算')}</span>
                  </div>
                  <div className="kpi kpi-accent">
                    <span className="kpi-label">{t('實際花費')}</span>
                    <strong className="kpi-value">{formatMoney(spentTotal)}</strong>
                    <span className="kpi-sub">
                      {purchasedWithoutPrice > 0 ? t('{0} 項已買但沒填金額', [purchasedWithoutPrice]) : t('依實付金額／收據')}
                    </span>
                  </div>
                </div>

                {duplicated.length > 0 && (
                  <div className="alert alert-error" role="alert">
                    <span>{t('注意：{0}同時出現，可能會重複購買。請在下方「分配採買地點」為它重新選擇一間店。', [duplicated.map((entry) => t('「{0}」在 {1}', [entry.name, entry.stores.join('、')])).join('；')])}</span>
                  </div>
                )}

                <section className="card">
                  <header className="card-head">
                    {renderCollapseButton(
                      !shoppingOverviewExpanded,
                      () => setShoppingOverviewExpanded((previous) => !previous),
                      t('分配採買地點'),
                    )}
                    <span className="step-no">1</span>
                    <h3 className="card-title">{t('分配採買地點')}</h3>
                    <div className="dish-meta">
                      {unassignedShoppingIngredientCount > 0 ? (
                        <span className="chip chip-warn">{t('待分配 {0}', [unassignedShoppingIngredientCount])}</span>
                      ) : (
                        shoppingIngredientOverviewRows.length > 0 && <span className="chip chip-ok">{t('全部已分配')}</span>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={assignAllBySuggestion}
                        disabled={unassignedShoppingIngredientCount === 0}
                      >
                        {t('全部依建議分配')}
                      </button>
                    </div>
                  </header>

                  {shoppingOverviewExpanded && (
                    <div className="card-body">
                      <div className="toolbar">
                        <div className="segmented" role="group" aria-label={t('篩選')}>
                          <button
                            type="button"
                            className={shoppingOverviewFilter === 'unassigned' ? 'is-active' : ''}
                            onClick={() => setShoppingOverviewFilter('unassigned')}
                          >
                            {t('只看待分配')}
                          </button>
                          <button
                            type="button"
                            className={shoppingOverviewFilter === 'all' ? 'is-active' : ''}
                            onClick={() => setShoppingOverviewFilter('all')}
                          >
                            {t('全部食材')}
                          </button>
                        </div>
                        <input
                          className="input input-sm toolbar-search"
                          value={shoppingOverviewQuery}
                          onChange={(event) => setShoppingOverviewQuery(event.target.value)}
                          placeholder={t('搜尋食材、分類、組別或商店')}
                        />
                      </div>
                      <p className="muted small">
                        {t('「建議」依價格參考算出最省的地方，沒有參考價時依分類：生鮮→菜市場、包裝與調味→全聯。可直接用右邊選單更改。')}
                      </p>

                      {filteredShoppingIngredientOverviewRows.length === 0 ? (
                        <p className="empty">
                          {shoppingOverviewFilter === 'unassigned' && shoppingIngredientOverviewRows.length > 0
                            ? t('全部食材都已分配好了，往下看各商店清單。')
                            : t('目前沒有符合條件的食材。')}
                        </p>
                      ) : (
                        <div className="assign-list">
                          {CATEGORY_ORDER.map((category) => {
                            const rows = filteredShoppingIngredientOverviewRows.filter((row) => row.category === category)
                            if (rows.length === 0) {
                              return null
                            }

                            return (
                              <div key={category} className="assign-group">
                                <p className="assign-group-title">
                                  {t(category)} <span className="muted">{rows.length}</span>
                                </p>
                                {rows.map((row) => (
                                  <div key={`${row.ingredient}-${row.totalUnit}`} className="assign-row">
                                    <span className="assign-photo">
                                      {renderReferenceThumb(row.ingredient, 'md') ?? (
                                        <span className="ref-thumb ref-thumb-md is-empty" aria-hidden="true" />
                                      )}
                                    </span>
                                    <div className="assign-main">
                                      <span className="assign-name">
                                        {ingredientLabel(row.ingredient)}
                                        <span className="assign-qty">{amountLabel(row.requiredDisplay)}</span>
                                      </span>
                                      <span className="assign-meta">
                                        {row.groupNeeds
                                          .map((need) => `${need.groupName} ${formatNumber(need.qty)}${row.totalUnit}`)
                                          .join('、')}
                                        {row.note && ` · ${row.note}`}
                                      </span>
                                    </div>
                                    <div className="assign-suggest">
                                      <span className="suggest-store">{t('建議 {0}', [t(row.suggestion.store)])}</span>
                                      <span className="suggest-cost">
                                        {row.suggestion.estimate
                                          ? t('約 {0}', [formatMoney(row.suggestion.estimate.cost)])
                                          : row.suggestion.reason === 'category'
                                            ? t('依分類')
                                            : t('單位不同，無法估價')}
                                      </span>
                                    </div>
                                    <select
                                      className={`input input-sm assign-select ${row.assignedStoreId ? '' : 'is-missing'}`}
                                      aria-label={t('{0} 去哪買', [row.ingredient])}
                                      value={row.assignedStoreId ?? ''}
                                      onChange={(event) => {
                                        const value = event.target.value
                                        if (value.startsWith('new:')) {
                                          assignIngredientToNewStore(row.ingredient, value.slice(4))
                                        } else {
                                          assignIngredientToStore(row.ingredient, value ? Number(value) : null)
                                        }
                                      }}
                                    >
                                      <option value="">{t('尚未分配')}</option>
                                      {shoppingStores.map((store) => (
                                        <option key={store.id} value={store.id}>
                                          {store.storeName.trim() || t('未命名商店')}
                                        </option>
                                      ))}
                                      {STORE_KINDS.filter(
                                        (kind) => !shoppingStores.some((store) => storeKindOf(store.storeName) === kind),
                                      ).map((kind) => (
                                        <option key={kind} value={`new:${kind}`}>{t('＋ 新增「{0}」', [t(kind)])}</option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <div className="section-title-row">
                  <h3 className="section-title">
                    <span className="step-no">2</span>
                    {t('各商店採買清單')}
                  </h3>
                  <div className="store-add">
                    {STORE_KINDS.map((kind) => (
                      <button key={kind} type="button" className="btn btn-ghost btn-sm" onClick={() => addShoppingStore(kind)}>
                        <Icon name="plus" size={14} />
                        {t(kind)}
                      </button>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addShoppingStore()}>
                      <Icon name="plus" size={14} />
                      {t('其他商店')}
                    </button>
                  </div>
                </div>

                {shoppingStores.length === 0 && (
                  <p className="empty">{t('還沒有商店。按上方「全部依建議分配」會自動建立，或用右上角按鈕新增。')}</p>
                )}

                {storeStats.map(({ store, stats }) => (
                  <section key={store.id} className="card store-card">
                    <header className="card-head">
                      <span className="store-icon" aria-hidden="true">
                        <Icon name="cart" size={16} />
                      </span>
                      <input
                        type="text"
                        className="dish-title-input"
                        value={store.storeName}
                        onChange={(event) => updateShoppingStoreName(store.id, event.target.value)}
                        placeholder={t('商店名稱')}
                        aria-label={t('商店名稱')}
                      />
                      <span className={`chip ${stats.total > 0 && stats.purchased === stats.total ? 'chip-ok' : ''}`}>{t('已買 {0}/{1}', [stats.purchased, stats.total])}</span>
                      <div className="store-head-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setShoppingModeStoreId(store.id)}
                          disabled={stats.total === 0}
                        >
                          <Icon name="cart" size={14} />
                          {t('採買模式')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyStoreList(store)}>
                          <Icon name={copiedStoreId === store.id ? 'check' : 'copy'} size={14} />
                          {copiedStoreId === store.id ? t('已複製') : t('複製清單')}
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          onClick={() => removeShoppingStore(store.id)}
                          aria-label={t('刪除商店')}
                          title={t('刪除商店')}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </header>

                    <div className="store-summary">
                      <span>
                        {t('預估')}{' '}<strong>{formatMoney(stats.estimated)}</strong>
                      </span>
                      <span>
                        {t('品項加總')}{' '}<strong>{formatMoney(stats.itemSum)}</strong>
                      </span>
                      <label className="receipt-field">
                        {t('收據總額')}
                        <input
                          className="input input-sm"
                          type="number"
                          min="0"
                          inputMode="numeric"
                          placeholder={t('結帳後填')}
                          value={store.receiptTotal ?? ''}
                          onChange={(event) => updateStoreReceipt(store.id, event.target.value)}
                        />
                      </label>
                      <span className="store-spent">
                        {t('實際花費')}{' '}<strong>{formatMoney(stats.spent)}</strong>
                      </span>
                    </div>

                    <div className="shop-list" role="list">
                      {store.items.length > 0 && (
                        <div className="shop-row shop-row-head" aria-hidden="true">
                          <span>{t('已買')}</span>
                          <span>{t('照片')}</span>
                          <span>{t('食材')}</span>
                          <span className="num">{t('需求')}</span>
                          <span className="num">{t('家中已有')}</span>
                          <span className="num">{t('還要買')}</span>
                          <span className="num">{t('實付')}</span>
                          <span />
                        </div>
                      )}
                      {store.items.length === 0 && <p className="empty">{t('尚未加入食材，請在上方「分配採買地點」選擇這間店。')}</p>}
                      {groupStoreItemsByCategory(store.items).map(({ category, items }) => {
                        return (
                          <Fragment key={category || 'unmatched'}>
                            <p className="shop-category">{category ? t(category) : t('未對應到食材總表')}</p>
                            {items.map((item) => {
                              const row = findOverview(item.ingredient)
                              const need = describeNeed(item.ingredient, item.ownedQty ?? '')
                              const estimate = estimateItemAtStore(item, store.storeName)

                              return (
                                <div key={item.id} role="listitem" className={`shop-row ${item.purchased ? 'is-done' : ''}`}>
                                  <input
                                    type="checkbox"
                                    className="checkbox shop-check"
                                    checked={Boolean(item.purchased)}
                                    onChange={(event) =>
                                      updateShoppingStoreItem(store.id, item.id, 'purchased', event.target.checked)
                                    }
                                    aria-label={t('標記 {0} 是否已買', [item.ingredient || t('食材')])}
                                  />
                                  <span className="shop-photo">
                                    {renderReferenceThumb(item.ingredient, 'md') ?? (
                                      <span className="ref-thumb ref-thumb-md is-empty" aria-hidden="true" />
                                    )}
                                  </span>
                                  <div className="shop-name">
                                    {item.ingredient ? (
                                      <span className="shop-name-text">{ingredientLabel(item.ingredient)}</span>
                                    ) : (
                                      <select
                                        className="cell-input"
                                        value=""
                                        aria-label={t('選擇食材')}
                                        onChange={(event) =>
                                          updateShoppingStoreItem(store.id, item.id, 'ingredient', event.target.value)
                                        }
                                      >
                                        <option value="">{t('選擇食材')}</option>
                                        {uniqueSummaryIngredients.map((name) => (
                                          <option key={name} value={name} disabled={allAssignedIngredients.has(canonicalIngredient(name).key)}>
                                            {name}
                                            {allAssignedIngredients.has(canonicalIngredient(name).key) ? t('（已排定）') : ''}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {row && (
                                      <span className="shop-note">
                                        {row.groupNeeds.map((need) => need.groupName).join('、')}
                                        {row.note && ` · ${row.note}`}
                                      </span>
                                    )}
                                    {estimate && <span className="shop-estimate">{estimate.label}</span>}
                                  </div>
                                  <span className="shop-need num" data-label={t('需求')}>
                                    {need?.need ?? '–'}
                                  </span>
                                  <span className="shop-owned" data-label={t('家中已有')}>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="decimal"
                                      className="cell-input cell-input-num"
                                      value={item.ownedQty ?? ''}
                                      onChange={(event) =>
                                        updateShoppingStoreItem(store.id, item.id, 'ownedQty', event.target.value)
                                      }
                                      placeholder="0"
                                      aria-label={t('家中已有')}
                                      disabled={!need || need.mixed}
                                    />
                                  </span>
                                  <span className="shop-remaining num" data-label={t('還要買')}>
                                    {need ? <strong>{need.remaining}</strong> : '–'}
                                  </span>
                                  <span className="shop-price" data-label={t('實付')}>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      className="cell-input cell-input-num"
                                      value={item.price}
                                      onChange={(event) => updateShoppingStoreItem(store.id, item.id, 'price', event.target.value)}
                                      placeholder={estimate ? t('約{0}', [estimate.cost]) : '0'}
                                      aria-label={t('實付金額')}
                                    />
                                  </span>
                                  <button
                                    type="button"
                                    className="icon-btn icon-btn-danger shop-remove"
                                    onClick={() => removeShoppingStoreItem(store.id, item.id)}
                                    aria-label={t('移除（回到待分配）')}
                                    title={t('移除（回到待分配）')}
                                  >
                                    <Icon name="close" size={14} />
                                  </button>
                                </div>
                              )
                            })}
                          </Fragment>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      className="btn-add-row btn-add-row-padded"
                      onClick={() => addShoppingStoreItem(store.id)}
                    >
                      <Icon name="plus" size={14} />
                      {t('手動加一項')}
                    </button>
                  </section>
                ))}

                <section className="card">
                  <header className="card-head">
                    <span className="step-no">3</span>
                    <h3 className="card-title">{t('花費總覽')}</h3>
                    <span className="muted small">{t('實際花費以收據總額為準，沒填收據就用各品項實付加總。')}</span>
                  </header>
                  <div className="spend-grid">
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t('商店')}</th>
                            <th className="num">{t('進度')}</th>
                            <th className="num">{t('預估')}</th>
                            <th className="num">{t('實際')}</th>
                            <th className="num">{t('差額')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storeStats.length === 0 && (
                            <tr>
                              <td colSpan={5} className="empty">
                                {t('尚無商店')}
                              </td>
                            </tr>
                          )}
                          {storeStats.map(({ store, stats }) => (
                            <tr key={store.id}>
                              <td className="strong">{t(store.storeName.trim()) || t('未命名商店')}</td>
                              <td className="num">
                                {stats.purchased}/{stats.total}
                              </td>
                              <td className="num">{formatMoney(stats.estimated)}</td>
                              <td className="num strong">{formatMoney(stats.spent)}</td>
                              <td className={`num ${stats.spent > stats.estimated ? 'text-danger' : 'text-ok'}`}>
                                {stats.spent > 0 ? formatMoney(stats.spent - stats.estimated) : '–'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {storeStats.length > 0 && (
                          <tfoot>
                            <tr>
                              <td className="strong">{t('合計')}</td>
                              <td className="num">
                                {purchasedCount}/{assignedItemCount}
                              </td>
                              <td className="num">{formatMoney(estimatedTotal)}</td>
                              <td className="num strong">{formatMoney(spentTotal)}</td>
                              <td />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t('各組分攤')}</th>
                            <th className="num">{t('已花')}</th>
                            <th className="num">{t('待買（預估）')}</th>
                            <th className="num">{t('合計')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupSpending.map((entry) => (
                            <tr key={entry.groupId}>
                              <td className="strong">{entry.name}</td>
                              <td className="num">{formatMoney(entry.actual)}</td>
                              <td className="num muted">{formatMoney(entry.estimated)}</td>
                              <td className="num strong">{formatMoney(entry.actual + entry.estimated)}</td>
                            </tr>
                          ))}
                          {spendingAllocation.unallocated.actual + spendingAllocation.unallocated.estimated > 0 && (
                            <tr>
                              <td className="muted">{t('不在食材總表（無法分攤）')}</td>
                              <td className="num">{formatMoney(spendingAllocation.unallocated.actual)}</td>
                              <td className="num muted">{formatMoney(spendingAllocation.unallocated.estimated)}</td>
                              <td className="num strong">
                                {formatMoney(spendingAllocation.unallocated.actual + spendingAllocation.unallocated.estimated)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td className="strong">{t('合計')}</td>
                            <td className="num strong">
                              {formatMoney(groupSpending.reduce((sum, entry) => sum + entry.actual, 0) + spendingAllocation.unallocated.actual)}
                            </td>
                            <td className="num muted">
                              {formatMoney(groupSpending.reduce((sum, entry) => sum + entry.estimated, 0) + spendingAllocation.unallocated.estimated)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                  <p className="muted small spend-note">
                    {t('各組分攤依該組填寫的用量比例計算；填了收據總額時，會依收據金額等比例調整。')}
                  </p>
                </section>
              </>
            )
          })()}

        {currentTab === PRICE_TAB && adminUnlocked && (
          <>
            <header className="page-head page-head-row">
              <div>
                <h2 className="group-title">{t('價格參考')}</h2>
                <p className="muted small">{t('用來建議去哪買、估算預算。初始資料是 {0} 依公開報導與一般行情整理的估價，請依實際購買價隨時修正； 「秤重」代表依重量計價（例如菜市場每斤），不用整包購買。', [PRICE_REFERENCE_UPDATED])}</p>
              </div>
              <div className="page-head-actions">
                <button type="button" className="btn btn-ghost" onClick={() => void runPriceUpdate()} disabled={priceUpdating}>
                  <Icon name="history" size={15} />
                  {priceUpdating ? t('更新中…') : t('立即更新價格')}
                </button>
                <button type="button" className="btn" onClick={addPriceEntry}>
                  <Icon name="plus" size={15} />
                  {t('新增價格')}
                </button>
              </div>
            </header>

            <section className="price-status">
              <div>
                <strong>{t('每天早上 7 點自動更新')}</strong>
                <span className="muted small">
                  {marketPrices?.updatedAt
                    ? t('最近一次：{0}（市場行情交易日 {1}，網路商店 {2} 項）', [
                        new Date(marketPrices.updatedAt).toLocaleString(lang === 'en' ? 'en' : 'zh-TW', { dateStyle: 'short', timeStyle: 'short' }),
                        marketPrices.produceDate || '–',
                        Object.keys(marketPrices.products).length,
                      ])
                    : t('尚未更新過；部署到 Vercel 後每天會自動執行，也可以按右上角「立即更新價格」。')}
                </span>
              </div>
              <ul className="price-status-notes">
                <li>{t('菜市場：依農業部農產品批發行情（各市場成交量加權平均）× 1.6 估算零售價；你手動改過的價格不會被覆蓋。')}</li>
                <li>{t('全聯、萬家福：在下表貼上「全聯小時達」（或全聯全電商）、「萬家福線上購物」的商品網址，每天會自動抓該商品的售價。')}</li>
              </ul>
              {priceUpdateMessage && <p className="field-hint">{priceUpdateMessage}</p>}
              {marketPrices && marketPrices.errors.length > 0 && (
                <details className="price-errors">
                  <summary>{t('{0} 項沒有更新成功', [marketPrices.errors.length])}</summary>
                  <ul>
                    {marketPrices.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
            <datalist id="store-kind-options">
              {STORE_KINDS.map((kind) => (
                <option key={kind} value={kind} />
              ))}
            </datalist>
            <section className="card">
              <header className="card-head">
                <input
                  className="input input-sm toolbar-search"
                  value={priceQuery}
                  onChange={(event) => setPriceQuery(event.target.value)}
                  placeholder={t('搜尋食材或商店')}
                  aria-label={t('搜尋價格')}
                />
                <span className="muted small">{t('共 {0} 筆', [priceBook.length])}</span>
              </header>
              <div className="table-scroll">
                <table className="data-table price-table">
                  <thead>
                    <tr>
                      <th>{t('食材')}</th>
                      <th>{t('商店')}</th>
                      <th className="num">{t('價格')}</th>
                      <th className="num">{t('包裝數量')}</th>
                      <th>{t('單位')}</th>
                      <th className="col-check">{t('秤重')}</th>
                      <th>{t('規格說明')}</th>
                      <th>{t('商品網址（全聯／萬家福，自動更新）')}</th>
                      <th aria-label={t('操作')} />
                    </tr>
                  </thead>
                  <tbody>
                    {priceBook
                      .filter((entry) => {
                        const keyword = priceQuery.trim().toLowerCase()
                        return !keyword || `${entry.ingredient} ${entry.store} ${entry.spec}`.toLowerCase().includes(keyword)
                      })
                      .map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <input
                              className="cell-input"
                              value={entry.ingredient}
                              onChange={(event) => updatePriceEntry(entry.id, { ingredient: event.target.value })}
                              placeholder={t('食材')}
                              aria-label={t('食材')}
                              list="ingredient-library-options"
                            />
                          </td>
                          <td>
                            <input
                              className="cell-input"
                              value={entry.store}
                              onChange={(event) => updatePriceEntry(entry.id, { store: event.target.value })}
                              placeholder={t('商店')}
                              aria-label={t('商店')}
                              list="store-kind-options"
                            />
                          </td>
                          <td className="num">
                            <input
                              className="cell-input cell-input-num"
                              type="number"
                              min="0"
                              inputMode="numeric"
                              value={entry.price}
                              onChange={(event) => updatePriceEntry(entry.id, { price: event.target.value })}
                              aria-label={t('價格')}
                            />
                            {(() => {
                              const effective = effectivePriceBook.find((item) => item.id === entry.id)
                              if (!effective?.auto) {
                                return null
                              }
                              return (
                                <span className="auto-price" title={effective.autoAt}>
                                  {t('自動 ${0}', [effective.price])}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="num">
                            <input
                              className="cell-input cell-input-num"
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={entry.packQty}
                              onChange={(event) => updatePriceEntry(entry.id, { packQty: event.target.value })}
                              aria-label={t('包裝數量')}
                            />
                          </td>
                          <td>
                            <input
                              className="cell-input cell-input-unit"
                              value={entry.packUnit}
                              onChange={(event) => updatePriceEntry(entry.id, { packUnit: event.target.value })}
                              placeholder={t('顆／g／斤')}
                              aria-label={t('單位')}
                            />
                          </td>
                          <td className="col-check">
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={Boolean(entry.loose)}
                              onChange={(event) =>
                                updatePriceEntry(entry.id, event.target.checked ? { loose: true } : { loose: undefined })
                              }
                              aria-label={t('秤重計價')}
                            />
                          </td>
                          <td>
                            <input
                              className="cell-input"
                              value={entry.spec}
                              onChange={(event) => updatePriceEntry(entry.id, { spec: event.target.value })}
                              placeholder={t('規格、品牌')}
                              aria-label={t('規格說明')}
                            />
                          </td>
                          <td>
                            {(() => {
                              const kind = storeKindOf(entry.store)
                              return kind ? PRODUCT_SHOPS[kind] : undefined
                            })() ? (
                              <span className="source-cell">
                                <input
                                  className={`cell-input ${entry.sourceUrl && !isProductLink(entry.sourceUrl) ? 'is-missing' : ''}`}
                                  value={entry.sourceUrl ?? ''}
                                  onChange={(event) => updatePriceEntry(entry.id, { sourceUrl: event.target.value.trim() || undefined })}
                                  placeholder={PRODUCT_SHOPS[storeKindOf(entry.store) as StoreKind]?.example}
                                  aria-label={t('商品網址')}
                                />
                                <a
                                  className="btn btn-ghost btn-xs"
                                  href={`${PRODUCT_SHOPS[storeKindOf(entry.store) as StoreKind]?.search}${encodeURIComponent(entry.ingredient.trim())}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t('搜尋')}
                                </a>
                              </span>
                            ) : (
                              <span className="muted small">{storeKindOf(entry.store) === '菜市場' ? t('依每日市場行情') : '–'}</span>
                            )}
                          </td>
                          <td className="cell-action">
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              onClick={() => removePriceEntry(entry.id)}
                              aria-label={t('刪除這筆價格')}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            {marketPrices && marketPrices.produce.length > 0 && (
              <section className="card">
                <header className="card-head">
                  <h3 className="card-title">{t('今日市場行情')}</h3>
                  <span className="muted small">
                    {t('交易日 {0}・依批發均價換算，只供估價參考', [marketPrices.produceDate || '–'])}
                  </span>
                </header>
                <div className="market-grid">
                  {marketPrices.produce.map((item) => (
                    <div key={item.ingredient} className="market-item">
                      <span className="market-name">{item.ingredient}</span>
                      <span className="market-price">{t('約 ${0}/斤', [item.price])}</span>
                      <span className="muted small">{t('批發 {0}/公斤', [item.wholesalePerKg])}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {currentTab === CHANGELOG_TAB && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">{t('版本日誌')}</h2>
            </header>
            {lang === 'en' && <p className="page-note changelog-note">Release notes are written in Chinese.</p>}
            <ol className="changelog-list">
              {CHANGELOG_ENTRIES.map((entry) => (
                <li key={entry.version} className="changelog-item">
                  <div className="changelog-meta">
                    <strong>{entry.version}</strong>
                    <span className="muted small">{entry.date}</span>
                  </div>
                  <ul>
                    {entry.changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        {adminUnlocked && (
          <section className="danger-zone">
            {!showHardResetPanel ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger-text"
                onMouseDown={startDangerHold}
                onMouseUp={cancelDangerHold}
                onMouseLeave={cancelDangerHold}
                onTouchStart={startDangerHold}
                onTouchEnd={cancelDangerHold}
              >
                {t('長按 3 秒：刪除所有資料')}
              </button>
            ) : (
              <div className="hard-reset-panel">
                <p className="hard-reset-title">{t('高風險：全資料歸零')}</p>
                <p className="muted small">{t('需同時通過密碼、確認字串、風險勾選，且倒數結束後才可執行。')}</p>
                <input
                  type="password"
                  className="input input-sm"
                  placeholder={t('再次輸入管理員密碼')}
                  value={resetConfirmPasscode}
                  onChange={(event) => setResetConfirmPasscode(event.target.value)}
                />
                <input
                  className="input input-sm"
                  placeholder={t('請輸入確認字串：{0}', [RESET_CONFIRM_PHRASE])}
                  value={resetConfirmPhrase}
                  onChange={(event) => setResetConfirmPhrase(event.target.value)}
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={resetAcknowledged}
                    onChange={(event) => setResetAcknowledged(event.target.checked)}
                  />
                  {t('我確認這會清空全部資料且無法復原')}
                </label>
                <div className="hard-reset-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      void executeHardReset()
                    }}
                    disabled={resetCooldownSeconds > 0}
                  >
                    {resetCooldownSeconds > 0 ? t('請等待 {0} 秒', [resetCooldownSeconds]) : t('執行全歸零')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={closeHardResetPanel}>
                    {t('取消')}
                  </button>
                </div>
                {resetError && <p className="field-hint is-error">{resetError}</p>}
              </div>
            )}
          </section>
        )}
      </main>

      {adminUnlocked &&
        shoppingModeStoreId !== null &&
        (() => {
          const store = shoppingStores.find((entry) => entry.id === shoppingModeStoreId)
          if (!store) {
            return null
          }

          const stats = getStoreStats(store)
          const items = store.items.filter((item) => item.ingredient.trim() && !(shoppingModeHideDone && item.purchased))
          const progress = stats.total > 0 ? Math.round((stats.purchased / stats.total) * 100) : 0

          return (
            <div className="shop-mode" role="dialog" aria-modal="true" aria-label={t('{0} 採買模式', [store.storeName])}>
              <header className="shop-mode-head">
                <button type="button" className="icon-btn" onClick={() => setShoppingModeStoreId(null)} aria-label={t('離開採買模式')}>
                  <Icon name="close" size={20} />
                </button>
                <div className="shop-mode-title">
                  <strong>{store.storeName.trim() || t('採買清單')}</strong>
                  <span>{t('已買 {0} / {1}', [stats.purchased, stats.total])}</span>
                </div>
                <label className="shop-mode-toggle">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={shoppingModeHideDone}
                    onChange={(event) => setShoppingModeHideDone(event.target.checked)}
                  />
                  {t('隱藏已買')}
                </label>
              </header>
              <div className="shop-mode-progress" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>

              <div className="shop-mode-body">
                {groupStoreItemsByCategory(items).map(({ category, items: categoryItems }) => {
                  return (
                    <section key={category || 'unmatched'} className="shop-mode-section">
                      <h4>{category ? t(category) : t('其他（不在食材總表）')}</h4>
                      {categoryItems.map((item) => {
                        const row = findOverview(item.ingredient)
                        const need = describeNeed(item.ingredient, item.ownedQty ?? '')
                        const estimate = estimateItemAtStore(item, store.storeName)
                        const toggle = () => updateShoppingStoreItem(store.id, item.id, 'purchased', !item.purchased)

                        return (
                          <div key={item.id} className={`shop-mode-item ${item.purchased ? 'is-done' : ''}`}>
                            <button
                              type="button"
                              className="shop-mode-check"
                              onClick={toggle}
                              aria-pressed={Boolean(item.purchased)}
                              aria-label={`${item.ingredient} ${item.purchased ? t('已買') : t('未買')}`}
                            >
                              <span className="shop-mode-box">{item.purchased && <Icon name="check" size={18} />}</span>
                            </button>
                            {renderReferenceThumb(item.ingredient, 'md') ?? (
                              <span className="ref-thumb ref-thumb-md is-empty" aria-hidden="true" />
                            )}
                            <button type="button" className="shop-mode-info" onClick={toggle}>
                              <span className="shop-mode-name">{ingredientLabel(item.ingredient)}</span>
                              <span className="shop-mode-qty">
                                {t('買')}{' '}<strong>{need?.remaining ?? '–'}</strong>
                              </span>
                              {Boolean(row?.note || row?.groupNeeds.length) && (
                                <span className="shop-mode-note">
                                  {[row?.note, row?.groupNeeds.map((need) => need.groupName).join('、')].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </button>
                            <label className="shop-mode-price">
                              <span>{t('實付')}</span>
                              <input
                                type="number"
                                min="0"
                                inputMode="numeric"
                                className="input input-sm"
                                value={item.price}
                                onChange={(event) => updateShoppingStoreItem(store.id, item.id, 'price', event.target.value)}
                                placeholder={estimate ? t('約{0}', [estimate.cost]) : '$'}
                              />
                            </label>
                          </div>
                        )
                      })}
                    </section>
                  )
                })}
                {items.length === 0 && (
                  <p className="empty">{shoppingModeHideDone && stats.total > 0 ? t('這間店的東西都買齊了！') : t('這間店還沒有食材。')}</p>
                )}
              </div>

              <footer className="shop-mode-foot">
                <div className="shop-mode-spent">
                  <span className="muted small">{t('已花')}</span>
                  <strong>{formatMoney(stats.spent)}</strong>
                  <span className="muted small">{t('預估 {0}', [formatMoney(stats.estimated)])}</span>
                </div>
                <label className="shop-mode-receipt">
                  <span className="muted small">{t('收據總額')}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className="input input-sm"
                    value={store.receiptTotal ?? ''}
                    onChange={(event) => updateStoreReceipt(store.id, event.target.value)}
                    placeholder={t('結帳後填')}
                  />
                </label>
                <button type="button" className="btn" onClick={() => setShoppingModeStoreId(null)}>
                  {t('完成')}
                </button>
              </footer>
            </div>
          )
        })()}

      {lightbox && lightboxItem && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={lightbox.title} onClick={() => setLightbox(null)}>
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <header className="lightbox-head">
              <strong>{lightbox.title}</strong>
              {lightboxCount > 1 && (
                <span className="muted small">
                  {Math.min(lightboxIndex, lightboxCount - 1) + 1} / {lightboxCount}
                </span>
              )}
              <button type="button" className="icon-btn" onClick={() => setLightbox(null)} aria-label={t('關閉')}>
                <Icon name="close" />
              </button>
            </header>
            <div className="lightbox-stage">
              <img src={lightboxItem.url} alt={lightboxItem.caption || lightbox.title} />
              {lightboxCount > 1 && (
                <>
                  <button
                    type="button"
                    className="lightbox-nav is-prev"
                    onClick={() => setLightboxIndex((index) => (index - 1 + lightboxCount) % lightboxCount)}
                    aria-label={t('上一張')}
                  >
                    <Icon name="chevron" size={20} />
                  </button>
                  <button
                    type="button"
                    className="lightbox-nav is-next"
                    onClick={() => setLightboxIndex((index) => (index + 1) % lightboxCount)}
                    aria-label={t('下一張')}
                  >
                    <Icon name="chevron" size={20} />
                  </button>
                </>
              )}
            </div>
            {lightboxItem.caption && <p className="lightbox-caption">{lightboxItem.caption}</p>}
            {lightboxCount > 1 && (
              <div className="lightbox-thumbs">
                {lightbox.items.map((item, index) => (
                  <button
                    key={`${item.url}-${index}`}
                    type="button"
                    className={index === lightboxIndex ? 'is-active' : ''}
                    onClick={() => setLightboxIndex(index)}
                    aria-label={t('第 {0} 張', [index + 1])}
                  >
                    <img src={item.url} alt="" />
                  </button>
                ))}
              </div>
            )}
            {lightbox.onRemove && (
              <div className="lightbox-actions">
                <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={lightbox.onRemove}>
                  <Icon name="trash" size={14} />
                  {t('移除這張照片')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
