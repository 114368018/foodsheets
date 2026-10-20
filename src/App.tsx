import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  CATEGORY_ORDER,
  STORE_KINDS,
  categorizeIngredient,
  estimateWithEntry,
  findPriceEntries,
  formatMoney,
  formatPack,
  storeKindOf,
  suggestPurchase,
  type PriceEntry,
  type Suggestion,
} from './shopping'
import { PRICE_REFERENCE_SEED, PRICE_REFERENCE_UPDATED } from './price-reference'

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
  ingredient: string
  perServingUnit: string
  totalUnit: string
  note: string
  sumPerServingQty: number
  sumTotalQty: number
}

type ToolSummaryRow = {
  tool: string
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

  return input
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
}

// The seed is used only until a price book has been saved, so admin edits and deletions stick.
const normalizePriceBook = (input: unknown): PriceEntry[] => {
  if (!Array.isArray(input)) {
    return PRICE_REFERENCE_SEED
  }

  return input
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
    }))
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
    priceBook: normalizePriceBook(raw.priceBook),
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

const getUploadErrorMessage = (error: unknown): string => {
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  const errorDetail =
    typeof error === 'object' && error !== null && 'detail' in error
      ? String((error as { detail: unknown }).detail)
      : ''

  if (errorCode === 'cloudinary-not-configured') {
    return '尚未設定 Cloudinary，上傳功能不可用。'
  }

  if (errorCode === 'upload-timeout' || errorCode === 'upload-no-progress') {
    return '圖片上傳逾時或長時間無進度，請檢查網路後重試。'
  }

  if (errorCode === 'cloudinary-upload-failed') {
    return `Cloudinary 上傳失敗${errorDetail ? `：${errorDetail}` : '，請確認 Upload Preset 設定允許 unsigned upload。'}`
  }

  return `圖片上傳失敗${errorCode ? `（${errorCode}）` : ''}，請稍後再試。`
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
  const [remoteReady, setRemoteReady] = useState(false)
  const [syncRetryTick, setSyncRetryTick] = useState(0)
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured
      ? '雲端同步初始化中…'
      : `尚未設定 Firebase，目前僅本機保存（缺少：${missingFirebaseEnvKeys.join(', ')}）`,
  )

  const writeInFlightRef = useRef(false)
  const thumbnailInFlightRef = useRef<Set<string>>(new Set())
  const dangerHoldTimerRef = useRef<number | null>(null)

  const nonSampleGroupIds = useMemo(
    () => groupOrder.filter((groupId) => groupId !== SAMPLE_GROUP_TAB),
    [groupOrder],
  )
  const isGroupTab = (tab: TabName) => groupOrder.includes(tab)
  const getGroupName = (groupId: GroupTab) => groupData[groupId]?.name || groupId
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

  const ingredientSummaryRows = useMemo<IngredientSummaryRow[]>(() => {
    const map = new Map<string, IngredientSummaryRow>()

    allIngredientRows.forEach((row) => {
      const ingredientName = row.ingredient.trim()
      if (!ingredientName || !row.totalQty.trim()) {
        return
      }

      const key = [
        ingredientName.toLowerCase(),
        row.perServingUnit.trim().toLowerCase(),
        row.totalUnit.trim().toLowerCase(),
        row.note.trim().toLowerCase(),
      ].join('|')

      if (!map.has(key)) {
        map.set(key, {
          ingredient: ingredientName,
          perServingUnit: row.perServingUnit.trim(),
          totalUnit: row.totalUnit.trim(),
          note: row.note.trim(),
          sumPerServingQty: 0,
          sumTotalQty: 0,
        })
      }

      const target = map.get(key)
      if (!target) {
        return
      }

      target.sumPerServingQty += toNumber(row.perServingQty)
      target.sumTotalQty += toNumber(row.totalQty)
    })

    return Array.from(map.values()).sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'zh-Hant'))
  }, [allIngredientRows])

  const toolSummaryRows = useMemo<ToolSummaryRow[]>(() => {
    const map = new Map<string, ToolSummaryRow>()

    allToolRows.forEach((row) => {
      const toolName = row.tool.trim()
      if (!toolName || !row.qty.trim()) {
        return
      }

      const key = [toolName.toLowerCase(), row.unit.trim().toLowerCase(), row.note.trim().toLowerCase()].join('|')

      if (!map.has(key)) {
        map.set(key, {
          tool: toolName,
          unit: row.unit.trim(),
          note: row.note.trim(),
          sumQty: 0,
        })
      }

      const target = map.get(key)
      if (!target) {
        return
      }

      target.sumQty += toNumber(row.qty)
    })

    return Array.from(map.values()).sort((a, b) => a.tool.localeCompare(b.tool, 'zh-Hant'))
  }, [allToolRows])

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
          group.dishes.map((dish, index) => [dish.id, dish.title.trim() || `料理${index + 1}`]),
        )

        const rows: GroupIngredientLibraryRow[] = group.ingredientRows
          .filter((row) => row.ingredient.trim())
          .map((row) => ({
            id: row.id,
            image: row.image,
            dishName: dishNameById.get(row.dishId) ?? '未指定料理',
            ingredient: row.ingredient.trim(),
            perServingQty: row.perServingQty.trim(),
            perServingUnit: row.perServingUnit.trim(),
            totalQty: row.totalQty.trim(),
            totalUnit: row.totalUnit.trim(),
            note: row.note.trim(),
          }))

        return {
          groupId,
          groupName: group.name,
          rows,
        }
      }),
    [groupData, nonSampleGroupIds],
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
          groupName: group.name,
          rows,
        }
      }),
    [groupData, nonSampleGroupIds],
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
        const caption = [group.name, dishTitle, formatAmount(row.totalQty, row.totalUnit), row.note.trim()]
          .filter(Boolean)
          .join(' · ')
        const key = name.toLowerCase()
        map.set(key, [...(map.get(key) ?? []), { url: row.image.url, caption }])
      })
    })

    return map
  }, [groupData, nonSampleGroupIds])

  const getIngredientReferences = (name: string): LightboxItem[] =>
    ingredientReferencesByName.get(name.trim().toLowerCase()) ?? []

  const uniqueSummaryIngredients = useMemo(() => {
    const list = new Set<string>()
    ingredientSummaryRows.forEach((r) => list.add(r.ingredient))
    return Array.from(list).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [ingredientSummaryRows])

  // One row per ingredient (name + unit): total needed, which groups need it, where to buy it and what it should cost.
  const shoppingIngredientOverviewRows = useMemo<ShoppingIngredientOverviewRow[]>(() => {
    const assignedStoreByIngredient = new Map<string, ShoppingStore>()
    shoppingStores.forEach((store) => {
      store.items.forEach((item) => {
        const name = item.ingredient.trim()
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

        const key = `${name.toLowerCase()}|${row.totalUnit.trim().toLowerCase()}`
        const byGroup = needsByKey.get(key) ?? new Map<GroupTab, GroupNeed>()
        const need = byGroup.get(groupId) ?? { groupId, groupName: group.name, qty: 0, dishTitles: [] }
        need.qty += toNumber(row.totalQty)
        const dishTitle = group.dishes.find((dish) => dish.id === row.dishId)?.title.trim()
        if (dishTitle && !need.dishTitles.includes(dishTitle)) {
          need.dishTitles.push(dishTitle)
        }
        byGroup.set(groupId, need)
        needsByKey.set(key, byGroup)
      })
    })

    const grouped = new Map<string, { ingredient: string; requiredTotal: number; totalUnit: string; note: string }>()
    ingredientSummaryRows.forEach((row) => {
      const adjustmentKey = `${row.ingredient}-${row.perServingUnit}-${row.totalUnit}-${row.note}`
      const finalTotal = row.sumTotalQty + toNumber(ingredientAdjustments[adjustmentKey] ?? '')
      const key = `${row.ingredient.toLowerCase()}|${row.totalUnit.trim().toLowerCase()}`
      const existing = grouped.get(key)

      if (!existing) {
        grouped.set(key, { ingredient: row.ingredient, requiredTotal: finalTotal, totalUnit: row.totalUnit.trim(), note: row.note.trim() })
        return
      }

      existing.requiredTotal += finalTotal
      if (row.note.trim()) {
        existing.note = [existing.note, row.note.trim()].filter(Boolean).join(' / ')
      }
    })

    return Array.from(grouped.entries())
      .map(([key, row]) => {
        const store = assignedStoreByIngredient.get(row.ingredient) ?? null
        return {
          ...row,
          requiredDisplay: `${formatNumber(row.requiredTotal)}${row.totalUnit ? ` ${row.totalUnit}` : ''}`,
          category: categorizeIngredient(row.ingredient),
          groupNeeds: Array.from(needsByKey.get(key)?.values() ?? []),
          suggestion: suggestPurchase(row.ingredient, row.requiredTotal, row.totalUnit, priceBook),
          assignedStoreId: store?.id ?? null,
          assignedStoreName: store ? store.storeName.trim() || '未命名商店' : null,
        }
      })
      .sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
          a.ingredient.localeCompare(b.ingredient, 'zh-Hant'),
      )
  }, [groupData, ingredientAdjustments, ingredientSummaryRows, nonSampleGroupIds, priceBook, shoppingStores])

  const overviewByIngredient = useMemo(
    () => new Map(shoppingIngredientOverviewRows.map((row) => [row.ingredient, row])),
    [shoppingIngredientOverviewRows],
  )

  const unassignedShoppingIngredientCount = shoppingIngredientOverviewRows.filter((row) => !row.assignedStoreId).length

  const filteredShoppingIngredientOverviewRows = useMemo(() => {
    const keyword = shoppingOverviewQuery.trim().toLowerCase()

    return shoppingIngredientOverviewRows.filter((row) => {
      if (shoppingOverviewFilter === 'unassigned' && row.assignedStoreId) {
        return false
      }

      return (
        !keyword ||
        [row.ingredient, row.note, row.category, row.assignedStoreName ?? '', ...row.groupNeeds.map((need) => need.groupName)]
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      )
    })
  }, [shoppingIngredientOverviewRows, shoppingOverviewFilter, shoppingOverviewQuery])

  // Cheapest estimate for an item at this particular store, after subtracting what is already at home.
  const estimateItemAtStore = (item: ShoppingStoreItem, storeName: string) => {
    const row = overviewByIngredient.get(item.ingredient)
    if (!row) {
      return null
    }

    const needQty = Math.max(row.requiredTotal - toNumber(item.ownedQty ?? ''), 0)
    if (needQty === 0) {
      return { cost: 0, label: '家裡已有足夠數量' }
    }

    const kind = storeKindOf(storeName)
    const best = findPriceEntries(row.ingredient, priceBook)
      .filter((entry) => entry.store === storeName.trim() || (kind !== null && storeKindOf(entry.store) === kind))
      .map((entry) => estimateWithEntry(needQty, row.totalUnit, entry))
      .filter((estimate) => estimate !== null)
      .sort((a, b) => a.cost - b.cost)[0]

    if (!best) {
      return null
    }

    const packs = best.entry.loose ? '' : ` × ${best.packs}`
    return { cost: best.cost, label: `參考 $${best.entry.price}/${formatPack(best.entry)}${packs}` }
  }

  const getStoreStats = (store: ShoppingStore) => {
    const items = store.items.filter((item) => item.ingredient.trim())
    const itemSum = items.reduce((sum, item) => sum + toNumber(item.price), 0)
    const estimated = items.reduce((sum, item) => sum + (estimateItemAtStore(item, store.storeName)?.cost ?? 0), 0)
    const receipt = toNumber(store.receiptTotal ?? '')

    return {
      total: items.length,
      purchased: items.filter((item) => item.purchased).length,
      unpriced: items.filter((item) => !item.price.trim()).length,
      itemSum,
      estimated,
      spent: receipt > 0 ? receipt : itemSum,
    }
  }

  // Splits every store's spending over the groups by how much of each ingredient they asked for.
  // Items without an actual price fall back to the estimate, reported separately.
  const groupSpending = (() => {
    const totals = new Map<GroupTab, { name: string; actual: number; estimated: number }>()
    nonSampleGroupIds.forEach((groupId) =>
      totals.set(groupId, { name: groupData[groupId].name, actual: 0, estimated: 0 }),
    )

    shoppingStores.forEach((store) => {
      const stats = getStoreStats(store)
      const receiptScale = toNumber(store.receiptTotal ?? '') > 0 && stats.itemSum > 0 ? stats.spent / stats.itemSum : 1

      store.items.forEach((item) => {
        const row = overviewByIngredient.get(item.ingredient)
        const totalNeed = row?.groupNeeds.reduce((sum, need) => sum + need.qty, 0) ?? 0
        if (!row || totalNeed === 0) {
          return
        }

        const actual = toNumber(item.price) * receiptScale
        const estimate = actual > 0 ? 0 : (estimateItemAtStore(item, store.storeName)?.cost ?? 0)
        row.groupNeeds.forEach((need) => {
          const entry = totals.get(need.groupId)
          if (entry) {
            entry.actual += (actual * need.qty) / totalNeed
            entry.estimated += (estimate * need.qty) / totalNeed
          }
        })
      })
    })

    return Array.from(totals.entries()).map(([groupId, value]) => ({ groupId, ...value }))
  })()

  const summaryIngredientSet = useMemo(
    () => new Set(uniqueSummaryIngredients),
    [uniqueSummaryIngredients],
  )

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
        ingredientRows: [...previous[groupName].ingredientRows, emptyIngredientRow(Date.now(), dishId)],
      },
    }))
  }

  const addToolRow = (groupName: GroupTab) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolRows: [...previous[groupName].toolRows, emptyToolRow(Date.now() + 77)],
      },
    }))
  }

  const removeIngredientRow = (groupName: GroupTab, row: IngredientRow) => {
    if (!isBlankIngredientRow(row) && !window.confirm(`確定要刪除「${row.ingredient.trim() || '此食材列'}」嗎？`)) {
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
    if (hasContent && !window.confirm(`確定要刪除「${row.tool.trim() || '此工具列'}」嗎？`)) {
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
    const newDishId = Date.now()

    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishes: [...previous[groupName].dishes, emptyDish(newDishId)],
        ingredientRows: [...previous[groupName].ingredientRows, emptyIngredientRow(newDishId + 1, newDishId)],
      },
    }))
  }

  const removeDish = (groupName: GroupTab, dishId: number) => {
    const dishIndex = groupData[groupName].dishes.findIndex((dish) => dish.id === dishId)
    const dishTitle = groupData[groupName].dishes[dishIndex]?.title.trim()
    const dishLabel = dishTitle ? `「${dishTitle}」` : dishIndex >= 0 ? `料理 ${dishIndex + 1}` : '此料理'
    const confirmed = window.confirm(`確定要刪除${dishLabel}嗎？該料理下的食材將一併刪除。`)
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
    const name = window.prompt('新組別名稱', `第${nonSampleGroupIds.length + 1}組`)?.trim()
    if (!name) {
      return
    }

    const groupId = `g${Date.now()}`
    setGroupData((previous) => ({ ...previous, [groupId]: createEmptyGroup(name, Date.now()) }))
    setGroupOrder((previous) => [...previous, groupId])
    setCurrentTab(groupId)
  }

  const renameGroup = (groupId: GroupTab) => {
    const name = window.prompt('修改組別名稱', getGroupName(groupId))?.trim()
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
    const confirmed = window.confirm(`確定要刪除「${name}」嗎？此組的料理、食材與工具會全部刪除，且無法復原。`)
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
      setImageUploadError('此瀏覽器不支援按鈕貼上，請點選圖片區後按 Ctrl+V（手機可長按貼上）。')
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
        setImageUploadError('剪貼簿裡沒有圖片，請先複製一張圖片。')
        return
      }

      await handleDishImageUpload(groupName, dishId, files)
    } catch {
      setImageUploadError('無法讀取剪貼簿，請允許剪貼簿權限，或點選圖片區後按 Ctrl+V。')
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
      setImageUploadError('尚未設定 Cloudinary，請先設定雲端名稱與 Upload Preset。')
      return
    }

    setImageUploadError('')
    setUploadingDishIds((previous) => ({ ...previous, [dishId]: true }))
    setUploadProgressByDish((previous) => ({ ...previous, [dishId]: 0 }))

    try {
      const currentDish = groupData[groupName].dishes.find((dish) => dish.id === dishId)
      const remainSlots = currentDish ? Math.max(0, 2 - currentDish.images.length) : 0

      if (remainSlots === 0) {
        setImageUploadError('此料理圖片已達 2 張上限，請先刪除後再上傳。')
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
      setImageUploadError(getUploadErrorMessage(error))
    } finally {
      setUploadingDishIds((previous) => ({ ...previous, [dishId]: false }))
      setUploadProgressByDish((previous) => ({ ...previous, [dishId]: 0 }))
    }
  }

  const removeDishImage = async (groupName: GroupTab, dishId: number, imageIndex: number) => {
    const confirmed = window.confirm('確定要刪除這張圖片嗎？')
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
      setImageUploadError('已從表單移除圖片，但缺少 Cloudinary public_id，無法同步刪除雲端檔案。')
      return
    }

    try {
      const deleteResult = await deleteCloudinaryByPublicId(publicId)
      if (!deleteResult.ok) {
        setImageUploadError(
          `圖片已從表單移除，但 Cloudinary 同步刪除失敗（${deleteResult.message ?? '請確認已部署 API 與伺服器端金鑰'}）。`,
        )
      }
    } catch {
      setImageUploadError('圖片已從表單移除，但 Cloudinary 同步刪除失敗（請確認已部署 API 與伺服器端金鑰）。')
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
        setImageUploadError(`照片已移除，但雲端檔案刪除失敗（${result.message ?? '請確認 API 設定'}）。`)
      }
    } catch {
      setImageUploadError('照片已移除，但雲端檔案刪除失敗（請確認 API 設定）。')
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
      const seed = Date.now()
      let rows = group.ingredientRows

      items.forEach((item, index) => {
        const targetId = fillTargets[index]
        rows =
          targetId === undefined
            ? [...rows, { ...emptyIngredientRow(seed + index, dishId), ...toFields(item) }]
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
      [dishId]: `已加入 ${items.length} 項${withoutAmount ? `，${withoutAmount} 項還沒有數量（已標示黃色）` : ''}`,
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
      setImageUploadError('尚未設定 Cloudinary，無法上傳照片。')
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
      setImageUploadError(getUploadErrorMessage(error))
    } finally {
      setUploadingRowIds((previous) => ({ ...previous, [rowId]: false }))
    }
  }

  const removeIngredientImage = (groupName: GroupTab, rowId: number) => {
    const image = groupData[groupName].ingredientRows.find((row) => row.id === rowId)?.image
    if (!image || !window.confirm('確定要移除這張食材照片嗎？')) {
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
      setAdminError('管理員密碼錯誤。')
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
      setResetError('僅管理員可執行此操作。')
      return
    }

    if (resetCooldownSeconds > 0) {
      setResetError(`請再等待 ${resetCooldownSeconds} 秒後才能執行。`)
      return
    }

    if (resetConfirmPasscode !== ADMIN_PASSCODE) {
      setResetError('管理員密碼驗證失敗。')
      return
    }

    if (resetConfirmPhrase.trim() !== RESET_CONFIRM_PHRASE) {
      setResetError(`請輸入正確確認字串：${RESET_CONFIRM_PHRASE}`)
      return
    }

    if (!resetAcknowledged) {
      setResetError('請先勾選風險確認。')
      return
    }

    const confirmed = window.confirm('最後確認：此操作會刪除所有組別資料、食材庫調整與採買資料，且無法復原。')
    if (!confirmed) {
      return
    }

    setResetError('')

    if (isCloudinaryConfigured) {
      const deleteResult = await deleteCloudinaryAssetsForReset(groupData)
      if (!deleteResult.ok) {
        setResetError(`Cloudinary 全刪除失敗：${deleteResult.message ?? '請確認 API 與伺服器金鑰設定'}`)
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
      setLibraryError('請先輸入食材名稱。')
      return
    }

    if (ingredientLibrary.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
      setLibraryError('食材庫已存在相同名稱。')
      return
    }

    if (INGREDIENT_LIBRARY_BLOCKLIST.includes(trimmed)) {
      setLibraryError('此食材不符合蛋奶素（五辛或葷食），無法加入。')
      return
    }

    setLibraryError('')
    setIngredientLibrary((previous) => [...previous, trimmed].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
    setLibraryInput('')
  }

  const removeLibraryIngredient = (name: string) => {
    const confirmed = window.confirm(`確定要從食材庫刪除「${name}」嗎？`)
    if (!confirmed) {
      return
    }

    setIngredientLibrary((previous) => previous.filter((item) => item !== name))
  }

  const addLibraryTool = () => {
    const trimmed = toolLibraryInput.trim()
    if (!trimmed) {
      setToolLibraryError('請先輸入工具名稱。')
      return
    }

    if (toolLibrary.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
      setToolLibraryError('工具庫已存在相同名稱。')
      return
    }

    setToolLibraryError('')
    setToolLibrary((previous) => [...previous, trimmed].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
    setToolLibraryInput('')
  }

  const removeLibraryTool = (name: string) => {
    const confirmed = window.confirm(`確定要從工具庫刪除「${name}」嗎？`)
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
  const addShoppingStore = (storeName = '新商店') => {
    setShoppingStores((prev) => [...prev, { id: Date.now(), storeName, items: [] }])
  }

  const removeShoppingStore = (storeId: number) => {
    const confirmed = window.confirm('確定要刪除此商店嗎？商店內的食材會回到「待分配」。')
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
          items: [...s.items, { id: Date.now(), ingredient: '', price: '', ownedQty: '' }],
        }
      }),
    )
  }

  // Moves an ingredient to another store (or back to unassigned), keeping what was already entered.
  const assignIngredientToStore = (ingredient: string, storeId: number | null) => {
    setShoppingStores((prev) => {
      const existing = prev.flatMap((store) => store.items).find((item) => item.ingredient === ingredient)
      const item = existing ?? { id: Date.now(), ingredient, price: '', ownedQty: '' }

      return prev.map((store) => {
        const items = store.items.filter((entry) => entry.ingredient !== ingredient)
        return store.id === storeId ? { ...store, items: [...items, item] } : { ...store, items }
      })
    })
  }

  const assignIngredientToNewStore = (ingredient: string, storeName: string) => {
    const storeId = Date.now()
    setShoppingStores((prev) => [
      ...prev.map((store) => ({ ...store, items: store.items.filter((item) => item.ingredient !== ingredient) })),
      { id: storeId, storeName, items: [{ id: storeId + 1, ingredient, price: '', ownedQty: '' }] },
    ])
  }

  // One click: every unassigned ingredient goes to its suggested store; missing stores are created.
  const assignAllBySuggestion = () => {
    const unassigned = shoppingIngredientOverviewRows.filter((row) => !row.assignedStoreId)
    if (unassigned.length === 0) {
      return
    }

    setShoppingStores((prev) => {
      const stores = prev.map((store) => ({ ...store, items: [...store.items] }))
      const seed = Date.now()

      unassigned.forEach((row, index) => {
        const target = row.suggestion.store
        const targetKind = storeKindOf(target)
        let store = stores.find(
          (entry) => entry.storeName.trim() === target || (targetKind !== null && storeKindOf(entry.storeName) === targetKind),
        )
        if (!store) {
          store = { id: seed + 1000 + stores.length, storeName: target, items: [] }
          stores.push(store)
        }
        if (!store.items.some((item) => item.ingredient === row.ingredient)) {
          store.items.push({ id: seed + index, ingredient: row.ingredient, price: '', ownedQty: '' })
        }
      })

      return stores
    })
  }

  const removeShoppingStoreItem = (storeId: number, itemId: number) => {
    const item = shoppingStores.find((store) => store.id === storeId)?.items.find((entry) => entry.id === itemId)
    if (item && (item.purchased || item.price.trim()) && !window.confirm('這項已有購買紀錄，確定要移除嗎？')) {
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

  // Plain-text list to paste into LINE for whoever goes shopping.
  const copyStoreList = async (store: ShoppingStore) => {
    const lines = [`【${store.storeName.trim() || '採買清單'}】共 ${store.items.length} 項`]
    CATEGORY_ORDER.forEach((category) => {
      const items = store.items.filter((item) => overviewByIngredient.get(item.ingredient)?.category === category)
      if (items.length === 0) {
        return
      }

      lines.push('', `▍${category}`)
      items.forEach((item) => {
        const row = overviewByIngredient.get(item.ingredient)
        const remaining = row ? Math.max(row.requiredTotal - toNumber(item.ownedQty ?? ''), 0) : 0
        const amount = row ? `${formatNumber(remaining)}${row.totalUnit}` : ''
        const note = row?.note ? `（${row.note}）` : ''
        lines.push(`${item.purchased ? '☑' : '☐'} ${item.ingredient} ${amount}${note}`)
      })
    })

    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedStoreId(store.id)
      window.setTimeout(() => setCopiedStoreId((current) => (current === store.id ? null : current)), 2000)
    } catch {
      window.prompt('複製下面的文字貼到 LINE：', text)
    }
  }

  const addPriceEntry = () => {
    setPriceBook((prev) => [
      { id: Date.now(), ingredient: '', store: '全聯', price: '', packQty: '1', packUnit: '', spec: '' },
      ...prev,
    ])
  }

  const updatePriceEntry = (id: number, fields: Partial<PriceEntry>) => {
    setPriceBook((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry)))
  }

  const removePriceEntry = (id: number) => {
    setPriceBook((prev) => prev.filter((entry) => entry.id !== id))
  }

  const allAssignedIngredients = useMemo(() => {
    const assigned = new Set<string>()
    shoppingStores.forEach((store) => {
      store.items.forEach((item) => {
        if (item.ingredient && summaryIngredientSet.has(item.ingredient)) {
          assigned.add(item.ingredient)
        }
      })
    })
    return assigned
  }, [shoppingStores, summaryIngredientSet])

  const exportGroupRecipesToWord = async (
    groupName: GroupTab,
    mode: WordExportMode,
    selectedDishId: number | null,
  ) => {
    setWordExportError('')
    setExportingWord(true)

    try {
      const dishes = groupData[groupName].dishes
      const dishEntries = dishes
        .map((dish, index) => ({ dish, dishNumber: index + 1 }))
        .filter((entry) => (mode === 'all' ? true : entry.dish.id === selectedDishId))

      if (dishEntries.length === 0) {
        setWordExportError('找不到要下載的料理，請重新選擇。')
        return
      }

      const children: Paragraph[] = []
      const today = new Date().toISOString().slice(0, 10)
      const exportTitle = mode === 'all' ? `${getGroupName(groupName)} 料理步驟手冊` : `${getGroupName(groupName)} 單道料理步驟`

      children.push(
        new Paragraph({
          text: exportTitle,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 220 },
          thematicBreak: true,
        }),
      )
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `匯出日期：${today}`, color: '64748B' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 340 },
        }),
      )

      for (let index = 0; index < dishEntries.length; index += 1) {
        const { dish, dishNumber } = dishEntries[index]
        const dishName = dish.title.trim()
        const stepLines = dish.steps
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        children.push(
          new Paragraph({
            text: `第${dishNumber}道料理`,
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: index > 0,
            spacing: { before: 120, after: 80 },
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                color: '0F766E',
                size: 8,
              },
            },
          }),
        )
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: '料理名稱：', bold: true, color: '0F172A' }),
              new TextRun({ text: dishName || ' ', color: '111827' }),
            ],
            spacing: { before: 80, after: 200 },
          }),
        )
        children.push(
          new Paragraph({
            children: [new TextRun({ text: '料理圖片', bold: true, color: '334155' })],
            spacing: { before: 40, after: 120 },
          }),
        )

        if (dish.images.length === 0) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: '尚未提供圖片', italics: true, color: '94A3B8' })],
              spacing: { after: 160 },
            }),
          )
        } else {
          for (const image of dish.images) {
            const imagePayload = await fetchImageForDocx(image.url)
            if (!imagePayload) {
              continue
            }

            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imagePayload.data,
                    type: imagePayload.type,
                    transformation: {
                      width: 420,
                      height: 260,
                    },
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 140 },
              }),
            )
          }
        }

        children.push(
          new Paragraph({
            children: [new TextRun({ text: '料理步驟', bold: true, color: '334155' })],
            spacing: { before: 80, after: 80 },
          }),
        )
        if (stepLines.length === 0) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: '尚未填寫步驟', italics: true, color: '94A3B8' })],
              spacing: { after: 160 },
            }),
          )
        } else {
          stepLines.forEach((line, stepIndex) => {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `${stepIndex + 1}. `, bold: true, color: '0F766E' }),
                  new TextRun({ text: line, color: '111827' }),
                ],
                spacing: { after: 100 },
              }),
            )
          })
        }

        if (index < dishEntries.length - 1) {
          children.push(
            new Paragraph({
              text: '',
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  color: 'CBD5E1',
                  size: 4,
                },
              },
              spacing: { before: 140, after: 140 },
            }),
          )
        }
      }

      const doc = new DocxDocument({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 900,
                  bottom: 900,
                  left: 900,
                  right: 900,
                },
              },
            },
            children,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const selectedDish = dishes.find((dish) => dish.id === selectedDishId)
      const selectedDishName = selectedDish?.title.trim() || '單道料理'
      const fileName =
        mode === 'all'
          ? sanitizeFileName(`${getGroupName(groupName)}-料理步驟-全料理-${today}.docx`)
          : sanitizeFileName(`${getGroupName(groupName)}-${selectedDishName}-料理步驟-${today}.docx`)
      downloadBlobFile(blob, fileName)
      setShowWordExportOptions(false)
    } catch {
      setWordExportError('匯出 Word 失敗，請稍後再試。')
    } finally {
      setExportingWord(false)
    }
  }

  const exportGroupToolsToWord = async (groupName: GroupTab) => {
    setWordExportError('')
    setExportingWord(true)

    try {
      const tools = groupData[groupName].toolRows
        .map((row) => ({
          tool: row.tool.trim(),
          qty: row.qty.trim(),
          unit: row.unit.trim(),
          note: row.note.trim(),
        }))
        .filter((row) => row.tool)

      if (tools.length === 0) {
        setWordExportError('目前沒有可匯出的工具資料。')
        return
      }

      const today = new Date().toISOString().slice(0, 10)
      const children: Paragraph[] = []

      children.push(
        new Paragraph({
          text: `${getGroupName(groupName)} 所需工具清單`,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 220 },
          thematicBreak: true,
        }),
      )
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `匯出日期：${today}`, color: '64748B' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 340 },
        }),
      )

      tools.forEach((toolRow, index) => {
        const qtyText = toolRow.qty || '未填數量'
        const unitText = toolRow.unit || '-'

        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${index + 1}. `, bold: true, color: '0F766E' }),
              new TextRun({ text: toolRow.tool, bold: true, color: '0F172A' }),
              new TextRun({ text: `  ${qtyText} ${unitText}`, color: '111827' }),
            ],
            spacing: { after: toolRow.note ? 40 : 120 },
          }),
        )

        if (toolRow.note) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `備註：${toolRow.note}`, color: '475569' })],
              spacing: { after: 120 },
            }),
          )
        }
      })

      const doc = new DocxDocument({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 900,
                  bottom: 900,
                  left: 900,
                  right: 900,
                },
              },
            },
            children,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const fileName = sanitizeFileName(`${getGroupName(groupName)}-所需工具-${today}.docx`)
      downloadBlobFile(blob, fileName)
      setShowWordExportOptions(false)
    } catch {
      setWordExportError('匯出工具 Word 失敗，請稍後再試。')
    } finally {
      setExportingWord(false)
    }
  }

  const syncTone = syncStatus.includes('失敗') ? 'error' : syncStatus.includes('同步中') ? 'ok' : 'idle'
  const activeCollapse = getCollapse(activeGroup)
  const allDishesCollapsed = activeDishes.every((dish) => activeCollapse.dishCollapsedById[dish.id])

  const renderCollapseButton = (collapsed: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      className="icon-btn"
      onClick={onClick}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? '展開' : '收合'}${label}`}
      title={collapsed ? '展開' : '收合'}
    >
      <span className={`chevron ${collapsed ? 'is-collapsed' : ''}`}>
        <Icon name="chevron" />
      </span>
    </button>
  )

  const renderGroupStatus = (groupId: GroupTab) => {
    const status = groupStatusById[groupId]
    if (groupId === SAMPLE_GROUP_TAB) {
      return <span className="nav-badge">範例</span>
    }
    if (status.filledCount === 0) {
      return <span className="nav-badge">未填</span>
    }
    if (status.missingCount > 0) {
      return <span className="nav-badge nav-badge-warn">缺 {status.missingCount}</span>
    }
    return (
      <span className="nav-badge nav-badge-ok" aria-label="已完成">
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
        aria-label={`查看 ${name} 的參考照片（${references.length} 張）`}
        title="查看參考照片"
      >
        <img src={references[0].url} alt="" loading="lazy" />
        {references.length > 1 && <span className="ref-count">{references.length}</span>}
      </button>
    )
  }

  const renderIngredientPhoto = (groupName: GroupTab, row: IngredientRow) => {
    if (uploadingRowIds[row.id]) {
      return (
        <span className="photo-slot is-loading" aria-label="照片上傳中">
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
              title: row.ingredient.trim() || '食材照片',
              items: [{ url: image.url, caption: [formatAmount(row.totalQty, row.totalUnit), row.note.trim()].filter(Boolean).join(' · ') }],
              onRemove: canEditActiveGroup ? () => removeIngredientImage(groupName, row.id) : undefined,
            })
          }
          aria-label="查看食材照片"
        >
          <img src={image.url} alt="" loading="lazy" />
        </button>
      )
    }

    if (!canEditActiveGroup) {
      return <span className="photo-slot is-empty" aria-hidden="true" />
    }

    return (
      <label className="photo-slot is-empty" title="附上食材照片（也可以在這一列按 Ctrl+V 貼上）">
        <Icon name="camera" size={16} />
        <span className="visually-hidden">附上食材照片</span>
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
      return <p className="field-hint is-error">網址格式不正確，請輸入 http(s) 連結。</p>
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
          <span className="link-card-sub">{isThumbnailLoading ? '正在載入縮圖…' : '開啟連結 ↗'}</span>
        </span>
      </a>
    )
  }

  const lightboxCount = lightbox?.items.length ?? 0
  const lightboxItem = lightbox ? lightbox.items[Math.min(lightboxIndex, lightboxCount - 1)] : null

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div>
            <p className="brand-eyebrow">聖誕趴 · 廚藝競賽</p>
            <h1>食材登記</h1>
          </div>
          <span className={`sync-status sync-${syncTone}`} title={syncStatus}>
            <span className="sync-dot" aria-hidden="true" />
            <span className="sync-text">{syncStatus}</span>
          </span>
        </div>

        <nav className="nav-section nav-groups" aria-label="組別">
          <p className="nav-label">組別</p>
          <div className="nav-list">
            {groupOrder.map((groupId) => (
              <button
                key={groupId}
                type="button"
                className={`nav-item ${currentTab === groupId ? 'is-active' : ''}`}
                aria-current={currentTab === groupId ? 'page' : undefined}
                onClick={() => setCurrentTab(groupId)}
              >
                <span className="nav-item-name">{getGroupName(groupId)}</span>
                {renderGroupStatus(groupId)}
              </button>
            ))}
            {adminUnlocked && (
              <button type="button" className="nav-item nav-item-add" onClick={addGroup}>
                <Icon name="plus" size={14} />
                <span className="nav-item-name">新增組別</span>
              </button>
            )}
          </div>
        </nav>

        {adminUnlocked && (
          <nav className="nav-section nav-admin" aria-label="管理">
            <p className="nav-label">管理</p>
            <div className="nav-list">
              {ADMIN_TABS.map((tabName) => (
                <button
                  key={tabName}
                  type="button"
                  className={`nav-item ${currentTab === tabName ? 'is-active' : ''}`}
                  aria-current={currentTab === tabName ? 'page' : undefined}
                  onClick={() => setCurrentTab(tabName)}
                >
                  <Icon name={ADMIN_TAB_ICONS[tabName] ?? 'list'} size={15} />
                  <span className="nav-item-name">{tabName}</span>
                </button>
              ))}
            </div>
          </nav>
        )}

        <div className="sidebar-footer">
          <button
            type="button"
            className={`nav-item nav-item-quiet ${currentTab === CHANGELOG_TAB ? 'is-active' : ''}`}
            onClick={() => setCurrentTab(CHANGELOG_TAB)}
          >
            <span className="nav-item-name">{CHANGELOG_TAB}</span>
          </button>
          <div className="admin-access">
            {adminUnlocked ? (
              <>
                <span className="admin-badge">管理員模式</span>
                <button type="button" className="sidebar-link" onClick={lockAdminAccess}>
                  登出
                </button>
              </>
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
                  placeholder="管理員密碼"
                  aria-label="管理員密碼"
                  value={adminPasscode}
                  onChange={(event) => setAdminPasscode(event.target.value)}
                />
                <button type="submit" className="sidebar-button" aria-label="解鎖管理員">
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
            <button type="button" className="icon-btn" onClick={() => setImageUploadError('')} aria-label="關閉訊息">
              <Icon name="close" />
            </button>
          </div>
        )}

        <datalist id="ingredient-library-options">
          {ingredientLibrary.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <datalist id="tool-library-options">
          {toolLibrary.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {isGroupTab(currentTab) && (
          // Keyed by group so switching groups remounts the page and no card can carry over.
          <Fragment key={activeGroup}>
            <section className="group-header">
              <div className="group-title-row">
                <h2 className="group-title">{getGroupName(activeGroup)}</h2>
                {isActiveGroupSample && <span className="badge">{adminUnlocked ? '範例組' : '範例 · 唯讀'}</span>}
                <div className="group-toolbar">
                  {adminUnlocked && !isActiveGroupSample && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => renameGroup(activeGroup)}>
                        <Icon name="pencil" size={14} />
                        改名
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-danger-text"
                        onClick={() => removeGroup(activeGroup)}
                      >
                        <Icon name="trash" size={14} />
                        刪除組別
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAllDishesCollapsed(activeGroup, !allDishesCollapsed)}
                  >
                    {allDishesCollapsed ? '全部展開' : '全部收合'}
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
                    匯出 Word
                  </button>
                </div>
              </div>

              {showWordExportOptions && (
                <div className="export-panel">
                  <div className="segmented" role="group" aria-label="料理匯出範圍">
                    <button
                      type="button"
                      className={wordExportMode === 'all' ? 'is-active' : ''}
                      onClick={() => setWordExportMode('all')}
                    >
                      全部料理
                    </button>
                    <button
                      type="button"
                      className={wordExportMode === 'single' ? 'is-active' : ''}
                      onClick={() => setWordExportMode('single')}
                    >
                      單道料理
                    </button>
                  </div>
                  {wordExportMode === 'single' && (
                    <select
                      className="input input-sm"
                      aria-label="選擇要下載的料理"
                      value={selectedDishIdForWord ?? ''}
                      onChange={(event) => setSelectedDishIdForWord(Number(event.target.value) || null)}
                    >
                      {activeDishes.map((dish, index) => (
                        <option key={dish.id} value={dish.id}>
                          {index + 1}. {dish.title.trim() || '未命名料理'}
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
                    {exportingWord ? '產生中…' : '下載料理步驟'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void exportGroupToolsToWord(activeGroup)
                    }}
                    disabled={exportingWord}
                  >
                    下載工具清單
                  </button>
                </div>
              )}
              {wordExportError && <p className="field-hint is-error">{wordExportError}</p>}

              <fieldset className="plain-fieldset meta-row" disabled={!canEditActiveGroup}>
                <label className="field">
                  <span className="field-label">
                    廚神 <span className="req">*</span>
                  </span>
                  <input
                    className={`input ${!groupData[activeGroup].teamName.trim() ? 'is-missing' : ''}`}
                    value={groupData[activeGroup].teamName}
                    onChange={(event) => updateGroupMeta(activeGroup, 'teamName', event.target.value)}
                    placeholder="隊名或成員名字"
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    料理種類 <span className="req">*</span>
                  </span>
                  <input
                    className={`input ${!groupData[activeGroup].cuisineType.trim() ? 'is-missing' : ''}`}
                    value={groupData[activeGroup].cuisineType}
                    onChange={(event) => updateGroupMeta(activeGroup, 'cuisineType', event.target.value)}
                    placeholder="例如：義式、台式、日式"
                  />
                </label>
              </fieldset>

              {canEditActiveGroup && (
                <ul className="tip-list">
                  <li>
                    <strong>最快的填法：</strong>在料理下方的輸入框打「番茄 6顆」按 Enter，或把整份食材清單直接貼上，會自動拆成一列一列。
                  </li>
                  <li>
                    <strong>怕買錯？</strong>點食材左邊的 <Icon name="camera" size={13} /> 附上照片，或點一下該列再按 Ctrl+V 貼上圖片。
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
                    {renderCollapseButton(isDishCollapsed, () => toggleDishCollapse(activeGroup, dish.id), '料理')}
                    <span className="dish-index">{dishIndex + 1}</span>
                    <input
                      className={`dish-title-input ${!dish.title.trim() ? 'is-missing' : ''}`}
                      value={dish.title}
                      onChange={(event) => updateDish(activeGroup, dish.id, 'title', event.target.value)}
                      placeholder="料理名稱（必填）"
                      aria-label={`料理 ${dishIndex + 1} 名稱`}
                      disabled={!canEditActiveGroup}
                    />
                    <div className="dish-meta">
                      <span className="chip">{filledIngredientCount} 項食材</span>
                      {missingTotalCount > 0 && <span className="chip chip-warn">缺數量 {missingTotalCount}</span>}
                      <span className="chip chip-optional">{dish.images.length}/2 圖</span>
                    </div>
                    {dishIndex >= MIN_DISH_COUNT && canEditActiveGroup && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => removeDish(activeGroup, dish.id)}
                        aria-label={`刪除料理 ${dishIndex + 1}`}
                        title="刪除料理"
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
                                  <th aria-label="照片" />
                                  <th>食材</th>
                                  <th>
                                    總量 <span className="req">*</span>
                                  </th>
                                  <th>一份量</th>
                                  <th>備註</th>
                                  <th aria-label="操作" />
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
                                          placeholder={isBlankRow ? '例如：番茄' : '食材名稱'}
                                          aria-label="食材"
                                          list="ingredient-library-options"
                                        />
                                      </td>
                                      <td className="cell-amount" data-label="總量 *">
                                        <input
                                          className={`cell-input ${isInvalid ? 'is-missing' : ''}`}
                                          value={row.totalQty + row.totalUnit}
                                          onChange={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'total', event.target.value)
                                          }
                                          onBlur={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'total', event.target.value, true)
                                          }
                                          placeholder={isInvalid ? '必填，如 6顆' : isBlankRow ? '6顆' : ''}
                                          aria-label="總量（數字加單位，例如 6顆）"
                                          aria-invalid={isInvalid}
                                        />
                                      </td>
                                      <td className="cell-amount" data-label="一份量">
                                        <input
                                          className="cell-input"
                                          value={row.perServingQty + row.perServingUnit}
                                          onChange={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'perServing', event.target.value)
                                          }
                                          onBlur={(event) =>
                                            updateIngredientAmount(activeGroup, row.id, 'perServing', event.target.value, true)
                                          }
                                          placeholder={isBlankRow ? '1顆（選填）' : ''}
                                          aria-label="一份量（選填，例如 1顆）"
                                        />
                                      </td>
                                      <td className="cell-note">
                                        <input
                                          className="cell-input"
                                          value={row.note}
                                          onChange={(event) =>
                                            updateIngredientRow(activeGroup, row.id, 'note', event.target.value)
                                          }
                                          placeholder="備註"
                                          aria-label="備註"
                                        />
                                      </td>
                                      <td className="cell-action">
                                        <button
                                          type="button"
                                          className="icon-btn icon-btn-danger"
                                          onClick={() => removeIngredientRow(activeGroup, row)}
                                          aria-label="刪除食材"
                                          title="刪除"
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
                                  placeholder="輸入「番茄 6顆」按 Enter，或貼上整份清單"
                                  aria-label="快速新增食材"
                                />
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => submitQuickAdd(activeGroup, dish.id, quickAddDraft)}
                                  disabled={!quickAddDraft.trim()}
                                >
                                  加入
                                </button>
                              </div>
                              <div className="quick-add-foot">
                                {quickAddNotices[dish.id] ? (
                                  <span className="quick-add-notice">
                                    <Icon name="check" size={14} />
                                    {quickAddNotices[dish.id]}
                                  </span>
                                ) : (
                                  <span className="muted small">可用「、」或換行分隔多項食材</span>
                                )}
                                <button
                                  type="button"
                                  className="btn-link"
                                  onClick={() => addIngredientRow(activeGroup, dish.id)}
                                >
                                  新增空白列
                                </button>
                              </div>
                            </div>
                          ) : (
                            dishIngredientRows.length === 0 && <p className="empty-inline">尚未填寫食材</p>
                          )}
                        </div>

                        <div className="dish-side">
                          <label className="field">
                            <span className="field-label">食譜／影片網址</span>
                            <input
                              className="input input-sm"
                              value={dish.videoUrl}
                              onChange={(event) => updateDish(activeGroup, dish.id, 'videoUrl', event.target.value)}
                              onBlur={(event) =>
                                updateDish(activeGroup, dish.id, 'videoUrl', normalizeUrlInput(event.target.value))
                              }
                              placeholder="YouTube 或食譜網址（選填）"
                            />
                          </label>
                          {renderLinkPreview(dish)}

                          <div className="field">
                            <span className="field-label">
                              成品參考圖 <span className="muted">{dish.images.length}/2</span>
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
                                          title: dish.title.trim() || `料理 ${dishIndex + 1}`,
                                          items: dish.images.map((item) => ({ url: item.url, caption: '' })),
                                        },
                                        imageIndex,
                                      )
                                    }
                                    aria-label={`查看圖片 ${imageIndex + 1}`}
                                  >
                                    <img
                                      src={image.url}
                                      alt={`${dish.title || `料理${dishIndex + 1}`} 圖片 ${imageIndex + 1}`}
                                    />
                                  </button>
                                  {canEditActiveGroup && (
                                    <button
                                      type="button"
                                      className="thumb-remove"
                                      onClick={() => removeDishImage(activeGroup, dish.id, imageIndex)}
                                      aria-label="刪除圖片"
                                      title="刪除圖片"
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
                                  aria-label="新增圖片：點這裡後按 Ctrl+V 貼上、拖曳圖片，或使用下方按鈕"
                                >
                                  <span className="image-drop-text">
                                    <Icon name="image" size={18} />
                                    點這裡後 Ctrl+V 貼上，或拖曳圖片
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
                                      貼上
                                    </button>
                                    <label className="btn btn-ghost btn-xs">
                                      <Icon name="image" size={13} />
                                      選擇檔案
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
                                  <span className="muted small">上傳中… {uploadProgressByDish[dish.id] ?? 0}%</span>
                                  <div className="progress-track">
                                    <div
                                      className="progress-bar"
                                      style={{ width: `${uploadProgressByDish[dish.id] ?? 0}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                              {!canEditActiveGroup && dish.images.length === 0 && <p className="empty-inline">尚無圖片</p>}
                            </div>
                          </div>

                          <label className="field">
                            <span className="field-label">
                              料理步驟 <span className="muted">每行一個步驟</span>
                            </span>
                            {canEditActiveGroup ? (
                              <textarea
                                className="input textarea"
                                value={dish.steps}
                                onChange={(event) => updateDish(activeGroup, dish.id, 'steps', event.target.value)}
                                placeholder={'例如：\n番茄切塊、雞蛋打散\n熱鍋下油炒蛋\n加入番茄拌炒調味'}
                                rows={4}
                              />
                            ) : (
                              <pre className="steps-readonly">{dish.steps.trim() || '（尚未填寫）'}</pre>
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
                新增料理
              </button>
            )}

            <section className="card">
              <header className="card-head">
                {renderCollapseButton(activeCollapse.toolsCollapsed, () => toggleToolsCollapse(activeGroup), '工具')}
                <h3 className="card-title">工具</h3>
                <span className="muted small">不分料理</span>
                <div className="dish-meta">
                  <span className="chip">{activeToolRows.filter((row) => row.tool.trim()).length} 項</span>
                  {invalidToolRowIds.size > 0 && <span className="chip chip-warn">缺數量 {invalidToolRowIds.size}</span>}
                </div>
              </header>

              <div className={`collapse ${activeCollapse.toolsCollapsed ? 'is-collapsed' : ''}`}>
                <div className="collapse-inner">
                  <fieldset className="plain-fieldset card-body" disabled={!canEditActiveGroup}>
                    <table className="grid-table tool-table">
                      <thead>
                        <tr>
                          <th>工具</th>
                          <th>
                            數量 <span className="req">*</span>
                          </th>
                          <th>單位</th>
                          <th>備註</th>
                          <th aria-label="操作" />
                        </tr>
                      </thead>
                      <tbody>
                        {activeToolRows.map((row) => {
                          const isInvalid = invalidToolRowIds.has(row.id)
                          const isBlankRow = ![row.tool, row.qty, row.unit, row.note].some((value) => value.trim())

                          return (
                            <tr key={row.id} className={isInvalid ? 'is-invalid' : ''}>
                              <td className="cell-name" data-label="工具">
                                <input
                                  className="cell-input"
                                  value={row.tool}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'tool', event.target.value)}
                                  placeholder={isBlankRow ? '例如：炒鍋' : '工具名稱'}
                                  aria-label="工具"
                                  list="tool-library-options"
                                />
                              </td>
                              <td className="cell-qty" data-label="數量 *">
                                <input
                                  className={`cell-input ${isInvalid ? 'is-missing' : ''}`}
                                  inputMode="decimal"
                                  value={row.qty}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'qty', event.target.value)}
                                  placeholder={isInvalid ? '必填' : isBlankRow ? '1' : ''}
                                  aria-label="數量"
                                  aria-invalid={isInvalid}
                                />
                              </td>
                              <td className="cell-unit" data-label="單位">
                                <input
                                  className="cell-input"
                                  value={row.unit}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'unit', event.target.value)}
                                  placeholder={isBlankRow ? '個' : ''}
                                  aria-label="單位"
                                />
                              </td>
                              <td className="cell-note" data-label="備註">
                                <input
                                  className="cell-input"
                                  value={row.note}
                                  onChange={(event) => updateToolRow(activeGroup, row.id, 'note', event.target.value)}
                                  placeholder="備註"
                                  aria-label="備註"
                                />
                              </td>
                              <td className="cell-action">
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-danger"
                                  onClick={() => removeToolRow(activeGroup, row)}
                                  aria-label="刪除工具"
                                  title="刪除"
                                >
                                  <Icon name="close" size={14} />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {activeToolRows.length === 0 && <p className="empty-inline">尚未填寫工具</p>}
                    {canEditActiveGroup && (
                      <button type="button" className="btn-add-row" onClick={() => addToolRow(activeGroup)}>
                        <Icon name="plus" size={14} />
                        新增工具
                      </button>
                    )}
                  </fieldset>
                </div>
              </div>
            </section>

            {(invalidIngredientRowIds.size > 0 || invalidToolRowIds.size > 0) && (
              <div className="alert alert-warn">
                {invalidIngredientRowIds.size > 0 && (
                  <span>有 {invalidIngredientRowIds.size} 項食材還沒填總量，不會列入食材總表。</span>
                )}
                {invalidToolRowIds.size > 0 && <span>有 {invalidToolRowIds.size} 項工具還沒填數量，不會列入工具總表。</span>}
              </div>
            )}
          </Fragment>
        )}

        {currentTab === '食材總表' && adminUnlocked && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">食材總表</h2>
              <span className="muted small">共 {ingredientSummaryRows.length} 項 · 有相機圖示的可點開看各組附的照片</span>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="col-check">備料</th>
                    <th>食材</th>
                    <th className="num">一份數量總和</th>
                    <th>單位</th>
                    <th className="num">總量總和</th>
                    <th className="num">調整量</th>
                    <th className="num">最終總量</th>
                    <th>總量單位</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {ingredientSummaryRows.map((row) => {
                    const key = `${row.ingredient}-${row.perServingUnit}-${row.totalUnit}-${row.note}`
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
                            aria-label={`標記 ${row.ingredient} 是否已備料`}
                          />
                        </td>
                        <td className="strong">
                          <span className="name-with-thumb">
                            {renderReferenceThumb(row.ingredient)}
                            {row.ingredient}
                          </span>
                        </td>
                        <td className="num">{formatNumber(row.sumPerServingQty)}</td>
                        <td>{row.perServingUnit}</td>
                        <td className="num">{formatNumber(row.sumTotalQty)}</td>
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
                            aria-label={`${row.ingredient} 調整量`}
                          />
                        </td>
                        <td className="num strong">{formatNumber(finalTotal)}</td>
                        <td>{row.totalUnit}</td>
                        <td className="muted">{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {currentTab === '工具總表' && adminUnlocked && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">工具總表</h2>
              <span className="muted small">共 {toolSummaryRows.length} 項</span>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="col-check">備妥</th>
                    <th>工具</th>
                    <th className="num">需求數量</th>
                    <th className="num">調整量</th>
                    <th className="num">最終數量</th>
                    <th>單位</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {toolSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {toolSummaryRows.map((row) => {
                    const key = `${row.tool}-${row.unit}-${row.note}`
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
                            aria-label={`標記 ${row.tool} 是否已備妥`}
                          />
                        </td>
                        <td className="strong">{row.tool}</td>
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
                            aria-label={`${row.tool} 調整量`}
                          />
                        </td>
                        <td className="num strong">{formatNumber(finalTotal)}</td>
                        <td>{row.unit}</td>
                        <td className="muted">{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {currentTab === TOOL_LIBRARY_TAB && adminUnlocked && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">工具庫</h2>
              <span className="muted small">提供給各組工具欄位作為建議選項 · 共 {toolLibrary.length} 項</span>
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
                  placeholder="輸入工具名稱，例如：量杯"
                />
                <button type="submit" className="btn btn-sm">
                  加入
                </button>
              </form>
              {toolLibraryError && <p className="field-hint is-error">{toolLibraryError}</p>}
              {toolLibrary.length === 0 ? (
                <p className="empty">目前工具庫沒有資料</p>
              ) : (
                <ul className="tag-list">
                  {toolLibrary.map((name) => (
                    <li key={name} className="tag">
                      {name}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => removeLibraryTool(name)}
                        aria-label={`刪除 ${name}`}
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
              <h2 className="card-title">食材庫</h2>
              <span className="muted small">
                提供給各組食材欄位作為建議選項（蛋奶素，不含五辛）· 共 {ingredientLibrary.length} 項
              </span>
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
                  placeholder="輸入食材名稱，例如：雞蛋"
                />
                <button type="submit" className="btn btn-sm">
                  加入
                </button>
              </form>
              {libraryError && <p className="field-hint is-error">{libraryError}</p>}
              {ingredientLibrary.length === 0 ? (
                <p className="empty">目前食材庫沒有資料</p>
              ) : (
                <ul className="tag-list">
                  {ingredientLibrary.map((name) => (
                    <li key={name} className="tag">
                      {name}
                      <button
                        type="button"
                        className="tag-remove"
                        onClick={() => removeLibraryIngredient(name)}
                        aria-label={`刪除 ${name}`}
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
            <header className="page-head">
              <h2 className="group-title">各組食材表</h2>
              <p className="muted small">各組明細，不進行跨組合併。勾選「備料」記錄已備妥的項目。</p>
            </header>
            {ingredientLibraryByGroup.map(({ groupId, groupName, rows }) => {
              const isCollapsed = getCollapse(groupId).groupIngredientTableCollapsed

              return (
                <section key={groupId} className="card">
                  <header className="card-head">
                    {renderCollapseButton(isCollapsed, () => toggleGroupIngredientTableCollapse(groupId), groupName)}
                    <h3 className="card-title">{groupName}</h3>
                    <span className="chip">{rows.length} 項</span>
                  </header>
                  <div className={`collapse ${isCollapsed ? 'is-collapsed' : ''}`}>
                    <div className="collapse-inner table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th className="col-check">備料</th>
                            <th>料理</th>
                            <th>食材</th>
                            <th className="num">一份數量</th>
                            <th>一份單位</th>
                            <th className="num">總量</th>
                            <th>總量單位</th>
                            <th>備註</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 && (
                            <tr>
                              <td colSpan={8} className="empty">
                                此組目前尚未填寫食材
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
                                    aria-label={`標記 ${groupName} ${row.ingredient} 是否已備料`}
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
                                        aria-label={`查看 ${row.ingredient} 的照片`}
                                      >
                                        <img src={rowImage.url} alt="" loading="lazy" />
                                      </button>
                                    )}
                                    {row.ingredient}
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
            <header className="page-head">
              <h2 className="group-title">各組工具表</h2>
              <p className="muted small">各組工具明細，不進行跨組合併。</p>
            </header>
            {toolLibraryByGroup.map(({ groupId, groupName, rows }) => {
              const isCollapsed = getCollapse(groupId).groupToolTableCollapsed

              return (
                <section key={groupId} className="card">
                  <header className="card-head">
                    {renderCollapseButton(isCollapsed, () => toggleGroupToolTableCollapse(groupId), groupName)}
                    <h3 className="card-title">{groupName}</h3>
                    <span className="chip">{rows.length} 項</span>
                  </header>
                  <div className={`collapse ${isCollapsed ? 'is-collapsed' : ''}`}>
                    <div className="collapse-inner table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th className="col-check">備妥</th>
                            <th>工具</th>
                            <th className="num">需求數量</th>
                            <th>單位</th>
                            <th>備註</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 && (
                            <tr>
                              <td colSpan={5} className="empty">
                                此組目前尚未填寫工具
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
                                    aria-label={`標記 ${groupName} ${row.tool} 是否已備妥`}
                                  />
                                </td>
                                <td className="strong">{row.tool}</td>
                                <td className="num">{row.qty || '–'}</td>
                                <td>{row.unit || '–'}</td>
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

            return (
              <>
                <header className="page-head">
                  <h2 className="group-title">食材採買</h2>
                  <p className="muted small">
                    ① 分配每樣食材去哪買 → ② 到店打開「採買模式」用手機邊買邊勾、順手記金額 → ③ 填收據總額，自動算出花費和各組分攤。
                  </p>
                </header>

                <div className="kpi-grid">
                  <div className="kpi">
                    <span className="kpi-label">需採買</span>
                    <strong className="kpi-value">{shoppingIngredientOverviewRows.length}</strong>
                    <span className="kpi-sub">項食材</span>
                  </div>
                  <div className={`kpi ${unassignedShoppingIngredientCount > 0 ? 'is-warn' : 'is-ok'}`}>
                    <span className="kpi-label">待分配</span>
                    <strong className="kpi-value">{unassignedShoppingIngredientCount}</strong>
                    <span className="kpi-sub">
                      {unassignedShoppingIngredientCount > 0 ? '項還沒決定去哪買' : '全部都已分配'}
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-label">採買進度</span>
                    <strong className="kpi-value">
                      {purchasedCount}
                      <span className="kpi-of">/{assignedItemCount}</span>
                    </strong>
                    <span className="kpi-bar" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-label">預估花費</span>
                    <strong className="kpi-value">{formatMoney(estimatedTotal)}</strong>
                    <span className="kpi-sub">依價格參考估算</span>
                  </div>
                  <div className="kpi kpi-accent">
                    <span className="kpi-label">實際花費</span>
                    <strong className="kpi-value">{formatMoney(spentTotal)}</strong>
                    <span className="kpi-sub">
                      {purchasedWithoutPrice > 0 ? `${purchasedWithoutPrice} 項已買但沒填金額` : '依實付金額／收據'}
                    </span>
                  </div>
                </div>

                <section className="card">
                  <header className="card-head">
                    {renderCollapseButton(
                      !shoppingOverviewExpanded,
                      () => setShoppingOverviewExpanded((previous) => !previous),
                      '分配採買地點',
                    )}
                    <span className="step-no">1</span>
                    <h3 className="card-title">分配採買地點</h3>
                    <div className="dish-meta">
                      {unassignedShoppingIngredientCount > 0 ? (
                        <span className="chip chip-warn">待分配 {unassignedShoppingIngredientCount}</span>
                      ) : (
                        shoppingIngredientOverviewRows.length > 0 && <span className="chip chip-ok">全部已分配</span>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={assignAllBySuggestion}
                        disabled={unassignedShoppingIngredientCount === 0}
                      >
                        全部依建議分配
                      </button>
                    </div>
                  </header>

                  {shoppingOverviewExpanded && (
                    <div className="card-body">
                      <div className="toolbar">
                        <div className="segmented" role="group" aria-label="篩選">
                          <button
                            type="button"
                            className={shoppingOverviewFilter === 'unassigned' ? 'is-active' : ''}
                            onClick={() => setShoppingOverviewFilter('unassigned')}
                          >
                            只看待分配
                          </button>
                          <button
                            type="button"
                            className={shoppingOverviewFilter === 'all' ? 'is-active' : ''}
                            onClick={() => setShoppingOverviewFilter('all')}
                          >
                            全部食材
                          </button>
                        </div>
                        <input
                          className="input input-sm toolbar-search"
                          value={shoppingOverviewQuery}
                          onChange={(event) => setShoppingOverviewQuery(event.target.value)}
                          placeholder="搜尋食材、分類、組別或商店"
                        />
                      </div>
                      <p className="muted small">
                        「建議」依價格參考算出最省的地方，沒有參考價時依分類：生鮮→菜市場、包裝與調味→全聯。可直接用右邊選單更改。
                      </p>

                      {filteredShoppingIngredientOverviewRows.length === 0 ? (
                        <p className="empty">
                          {shoppingOverviewFilter === 'unassigned' && shoppingIngredientOverviewRows.length > 0
                            ? '全部食材都已分配好了，往下看各商店清單。'
                            : '目前沒有符合條件的食材。'}
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
                                  {category} <span className="muted">{rows.length}</span>
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
                                        {row.ingredient}
                                        <span className="assign-qty">{row.requiredDisplay}</span>
                                      </span>
                                      <span className="assign-meta">
                                        {row.groupNeeds
                                          .map((need) => `${need.groupName} ${formatNumber(need.qty)}${row.totalUnit}`)
                                          .join('、')}
                                        {row.note && ` · ${row.note}`}
                                      </span>
                                    </div>
                                    <div className="assign-suggest">
                                      <span className="suggest-store">建議 {row.suggestion.store}</span>
                                      <span className="suggest-cost">
                                        {row.suggestion.estimate
                                          ? `約 ${formatMoney(row.suggestion.estimate.cost)}`
                                          : row.suggestion.reason === 'category'
                                            ? '依分類'
                                            : '單位不同，無法估價'}
                                      </span>
                                    </div>
                                    <select
                                      className={`input input-sm assign-select ${row.assignedStoreId ? '' : 'is-missing'}`}
                                      aria-label={`${row.ingredient} 去哪買`}
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
                                      <option value="">尚未分配</option>
                                      {shoppingStores.map((store) => (
                                        <option key={store.id} value={store.id}>
                                          {store.storeName.trim() || '未命名商店'}
                                        </option>
                                      ))}
                                      {STORE_KINDS.filter(
                                        (kind) => !shoppingStores.some((store) => storeKindOf(store.storeName) === kind),
                                      ).map((kind) => (
                                        <option key={kind} value={`new:${kind}`}>
                                          ＋ 新增「{kind}」
                                        </option>
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
                    各商店採買清單
                  </h3>
                  <div className="store-add">
                    {STORE_KINDS.map((kind) => (
                      <button key={kind} type="button" className="btn btn-ghost btn-sm" onClick={() => addShoppingStore(kind)}>
                        <Icon name="plus" size={14} />
                        {kind}
                      </button>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addShoppingStore()}>
                      <Icon name="plus" size={14} />
                      其他商店
                    </button>
                  </div>
                </div>

                {shoppingStores.length === 0 && (
                  <p className="empty">還沒有商店。按上方「全部依建議分配」會自動建立，或用右上角按鈕新增。</p>
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
                        placeholder="商店名稱"
                        aria-label="商店名稱"
                      />
                      <span className={`chip ${stats.total > 0 && stats.purchased === stats.total ? 'chip-ok' : ''}`}>
                        已買 {stats.purchased}/{stats.total}
                      </span>
                      <div className="store-head-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setShoppingModeStoreId(store.id)}
                          disabled={stats.total === 0}
                        >
                          <Icon name="cart" size={14} />
                          採買模式
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyStoreList(store)}>
                          <Icon name={copiedStoreId === store.id ? 'check' : 'copy'} size={14} />
                          {copiedStoreId === store.id ? '已複製' : '複製清單'}
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          onClick={() => removeShoppingStore(store.id)}
                          aria-label="刪除商店"
                          title="刪除商店"
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </header>

                    <div className="store-summary">
                      <span>
                        預估 <strong>{formatMoney(stats.estimated)}</strong>
                      </span>
                      <span>
                        品項加總 <strong>{formatMoney(stats.itemSum)}</strong>
                      </span>
                      <label className="receipt-field">
                        收據總額
                        <input
                          className="input input-sm"
                          type="number"
                          min="0"
                          inputMode="numeric"
                          placeholder="結帳後填"
                          value={store.receiptTotal ?? ''}
                          onChange={(event) => updateStoreReceipt(store.id, event.target.value)}
                        />
                      </label>
                      <span className="store-spent">
                        實際花費 <strong>{formatMoney(stats.spent)}</strong>
                      </span>
                    </div>

                    <div className="shop-list" role="list">
                      {store.items.length > 0 && (
                        <div className="shop-row shop-row-head" aria-hidden="true">
                          <span>已買</span>
                          <span>照片</span>
                          <span>食材</span>
                          <span className="num">需求</span>
                          <span className="num">家中已有</span>
                          <span className="num">還要買</span>
                          <span className="num">實付</span>
                          <span />
                        </div>
                      )}
                      {store.items.length === 0 && <p className="empty">尚未加入食材，請在上方「分配採買地點」選擇這間店。</p>}
                      {[...CATEGORY_ORDER, ''].map((category) => {
                        const items = store.items.filter((item) =>
                          category ? overviewByIngredient.get(item.ingredient)?.category === category : !overviewByIngredient.has(item.ingredient),
                        )
                        if (items.length === 0) {
                          return null
                        }

                        return (
                          <Fragment key={category || 'unmatched'}>
                            <p className="shop-category">{category || '未對應到食材總表'}</p>
                            {items.map((item) => {
                              const row = overviewByIngredient.get(item.ingredient)
                              const remainingQty = Math.max((row?.requiredTotal ?? 0) - toNumber(item.ownedQty ?? ''), 0)
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
                                    aria-label={`標記 ${item.ingredient || '食材'} 是否已買`}
                                  />
                                  <span className="shop-photo">
                                    {renderReferenceThumb(item.ingredient, 'md') ?? (
                                      <span className="ref-thumb ref-thumb-md is-empty" aria-hidden="true" />
                                    )}
                                  </span>
                                  <div className="shop-name">
                                    {item.ingredient ? (
                                      <span className="shop-name-text">{item.ingredient}</span>
                                    ) : (
                                      <select
                                        className="cell-input"
                                        value=""
                                        aria-label="選擇食材"
                                        onChange={(event) =>
                                          updateShoppingStoreItem(store.id, item.id, 'ingredient', event.target.value)
                                        }
                                      >
                                        <option value="">選擇食材</option>
                                        {uniqueSummaryIngredients.map((name) => (
                                          <option key={name} value={name} disabled={allAssignedIngredients.has(name)}>
                                            {name}
                                            {allAssignedIngredients.has(name) ? '（已排定）' : ''}
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
                                  <span className="shop-need num" data-label="需求">
                                    {row?.requiredDisplay ?? '–'}
                                  </span>
                                  <span className="shop-owned" data-label="家中已有">
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
                                      aria-label="家中已有"
                                      disabled={!row}
                                    />
                                  </span>
                                  <span className="shop-remaining num" data-label="還要買">
                                    {row ? (
                                      <>
                                        <strong>{formatNumber(remainingQty)}</strong> {row.totalUnit}
                                      </>
                                    ) : (
                                      '–'
                                    )}
                                  </span>
                                  <span className="shop-price" data-label="實付">
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      className="cell-input cell-input-num"
                                      value={item.price}
                                      onChange={(event) => updateShoppingStoreItem(store.id, item.id, 'price', event.target.value)}
                                      placeholder={estimate ? `約${estimate.cost}` : '0'}
                                      aria-label="實付金額"
                                    />
                                  </span>
                                  <button
                                    type="button"
                                    className="icon-btn icon-btn-danger shop-remove"
                                    onClick={() => removeShoppingStoreItem(store.id, item.id)}
                                    aria-label="移除（回到待分配）"
                                    title="移除（回到待分配）"
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
                      手動加一項
                    </button>
                  </section>
                ))}

                <section className="card">
                  <header className="card-head">
                    <span className="step-no">3</span>
                    <h3 className="card-title">花費總覽</h3>
                    <span className="muted small">實際花費以收據總額為準，沒填收據就用各品項實付加總。</span>
                  </header>
                  <div className="spend-grid">
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>商店</th>
                            <th className="num">進度</th>
                            <th className="num">預估</th>
                            <th className="num">實際</th>
                            <th className="num">差額</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storeStats.length === 0 && (
                            <tr>
                              <td colSpan={5} className="empty">
                                尚無商店
                              </td>
                            </tr>
                          )}
                          {storeStats.map(({ store, stats }) => (
                            <tr key={store.id}>
                              <td className="strong">{store.storeName.trim() || '未命名商店'}</td>
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
                              <td className="strong">合計</td>
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
                            <th>各組分攤</th>
                            <th className="num">已花</th>
                            <th className="num">待買（預估）</th>
                            <th className="num">合計</th>
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
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="muted small spend-note">
                    各組分攤依該組填寫的用量比例計算；填了收據總額時，會依收據金額等比例調整。
                  </p>
                </section>
              </>
            )
          })()}

        {currentTab === PRICE_TAB && adminUnlocked && (
          <>
            <header className="page-head page-head-row">
              <div>
                <h2 className="group-title">價格參考</h2>
                <p className="muted small">
                  用來建議去哪買、估算預算。初始資料是 {PRICE_REFERENCE_UPDATED} 依公開報導與一般行情整理的估價，請依實際購買價隨時修正；
                  「秤重」代表依重量計價（例如菜市場每斤），不用整包購買。
                </p>
              </div>
              <button type="button" className="btn" onClick={addPriceEntry}>
                <Icon name="plus" size={15} />
                新增價格
              </button>
            </header>
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
                  placeholder="搜尋食材或商店"
                  aria-label="搜尋價格"
                />
                <span className="muted small">共 {priceBook.length} 筆</span>
              </header>
              <div className="table-scroll">
                <table className="data-table price-table">
                  <thead>
                    <tr>
                      <th>食材</th>
                      <th>商店</th>
                      <th className="num">價格</th>
                      <th className="num">包裝數量</th>
                      <th>單位</th>
                      <th className="col-check">秤重</th>
                      <th>規格說明</th>
                      <th aria-label="操作" />
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
                              placeholder="食材"
                              aria-label="食材"
                              list="ingredient-library-options"
                            />
                          </td>
                          <td>
                            <input
                              className="cell-input"
                              value={entry.store}
                              onChange={(event) => updatePriceEntry(entry.id, { store: event.target.value })}
                              placeholder="商店"
                              aria-label="商店"
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
                              aria-label="價格"
                            />
                          </td>
                          <td className="num">
                            <input
                              className="cell-input cell-input-num"
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={entry.packQty}
                              onChange={(event) => updatePriceEntry(entry.id, { packQty: event.target.value })}
                              aria-label="包裝數量"
                            />
                          </td>
                          <td>
                            <input
                              className="cell-input cell-input-unit"
                              value={entry.packUnit}
                              onChange={(event) => updatePriceEntry(entry.id, { packUnit: event.target.value })}
                              placeholder="顆／g／斤"
                              aria-label="單位"
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
                              aria-label="秤重計價"
                            />
                          </td>
                          <td>
                            <input
                              className="cell-input"
                              value={entry.spec}
                              onChange={(event) => updatePriceEntry(entry.id, { spec: event.target.value })}
                              placeholder="規格、品牌"
                              aria-label="規格說明"
                            />
                          </td>
                          <td className="cell-action">
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              onClick={() => removePriceEntry(entry.id)}
                              aria-label="刪除這筆價格"
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
          </>
        )}

        {currentTab === CHANGELOG_TAB && (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">版本日誌</h2>
            </header>
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
                長按 3 秒：刪除所有資料
              </button>
            ) : (
              <div className="hard-reset-panel">
                <p className="hard-reset-title">高風險：全資料歸零</p>
                <p className="muted small">需同時通過密碼、確認字串、風險勾選，且倒數結束後才可執行。</p>
                <input
                  type="password"
                  className="input input-sm"
                  placeholder="再次輸入管理員密碼"
                  value={resetConfirmPasscode}
                  onChange={(event) => setResetConfirmPasscode(event.target.value)}
                />
                <input
                  className="input input-sm"
                  placeholder={`請輸入確認字串：${RESET_CONFIRM_PHRASE}`}
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
                  我確認這會清空全部資料且無法復原
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
                    {resetCooldownSeconds > 0 ? `請等待 ${resetCooldownSeconds} 秒` : '執行全歸零'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={closeHardResetPanel}>
                    取消
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
            <div className="shop-mode" role="dialog" aria-modal="true" aria-label={`${store.storeName} 採買模式`}>
              <header className="shop-mode-head">
                <button type="button" className="icon-btn" onClick={() => setShoppingModeStoreId(null)} aria-label="離開採買模式">
                  <Icon name="close" size={20} />
                </button>
                <div className="shop-mode-title">
                  <strong>{store.storeName.trim() || '採買清單'}</strong>
                  <span>
                    已買 {stats.purchased} / {stats.total}
                  </span>
                </div>
                <label className="shop-mode-toggle">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={shoppingModeHideDone}
                    onChange={(event) => setShoppingModeHideDone(event.target.checked)}
                  />
                  隱藏已買
                </label>
              </header>
              <div className="shop-mode-progress" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>

              <div className="shop-mode-body">
                {CATEGORY_ORDER.map((category) => {
                  const categoryItems = items.filter((item) => overviewByIngredient.get(item.ingredient)?.category === category)
                  if (categoryItems.length === 0) {
                    return null
                  }

                  return (
                    <section key={category} className="shop-mode-section">
                      <h4>{category}</h4>
                      {categoryItems.map((item) => {
                        const row = overviewByIngredient.get(item.ingredient)
                        const remaining = Math.max((row?.requiredTotal ?? 0) - toNumber(item.ownedQty ?? ''), 0)
                        const estimate = estimateItemAtStore(item, store.storeName)
                        const toggle = () => updateShoppingStoreItem(store.id, item.id, 'purchased', !item.purchased)

                        return (
                          <div key={item.id} className={`shop-mode-item ${item.purchased ? 'is-done' : ''}`}>
                            <button
                              type="button"
                              className="shop-mode-check"
                              onClick={toggle}
                              aria-pressed={Boolean(item.purchased)}
                              aria-label={`${item.ingredient} ${item.purchased ? '已買' : '未買'}`}
                            >
                              <span className="shop-mode-box">{item.purchased && <Icon name="check" size={18} />}</span>
                            </button>
                            {renderReferenceThumb(item.ingredient, 'md') ?? (
                              <span className="ref-thumb ref-thumb-md is-empty" aria-hidden="true" />
                            )}
                            <button type="button" className="shop-mode-info" onClick={toggle}>
                              <span className="shop-mode-name">{item.ingredient}</span>
                              <span className="shop-mode-qty">
                                買 <strong>{formatNumber(remaining)}</strong> {row?.totalUnit}
                              </span>
                              {Boolean(row?.note || row?.groupNeeds.length) && (
                                <span className="shop-mode-note">
                                  {[row?.note, row?.groupNeeds.map((need) => need.groupName).join('、')].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </button>
                            <label className="shop-mode-price">
                              <span>實付</span>
                              <input
                                type="number"
                                min="0"
                                inputMode="numeric"
                                className="input input-sm"
                                value={item.price}
                                onChange={(event) => updateShoppingStoreItem(store.id, item.id, 'price', event.target.value)}
                                placeholder={estimate ? `約${estimate.cost}` : '$'}
                              />
                            </label>
                          </div>
                        )
                      })}
                    </section>
                  )
                })}
                {items.length === 0 && (
                  <p className="empty">{shoppingModeHideDone && stats.total > 0 ? '這間店的東西都買齊了！' : '這間店還沒有食材。'}</p>
                )}
              </div>

              <footer className="shop-mode-foot">
                <div className="shop-mode-spent">
                  <span className="muted small">已花</span>
                  <strong>{formatMoney(stats.spent)}</strong>
                  <span className="muted small">預估 {formatMoney(stats.estimated)}</span>
                </div>
                <label className="shop-mode-receipt">
                  <span className="muted small">收據總額</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className="input input-sm"
                    value={store.receiptTotal ?? ''}
                    onChange={(event) => updateStoreReceipt(store.id, event.target.value)}
                    placeholder="結帳後填"
                  />
                </label>
                <button type="button" className="btn" onClick={() => setShoppingModeStoreId(null)}>
                  完成
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
              <button type="button" className="icon-btn" onClick={() => setLightbox(null)} aria-label="關閉">
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
                    aria-label="上一張"
                  >
                    <Icon name="chevron" size={20} />
                  </button>
                  <button
                    type="button"
                    className="lightbox-nav is-next"
                    onClick={() => setLightboxIndex((index) => (index + 1) % lightboxCount)}
                    aria-label="下一張"
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
                    aria-label={`第 ${index + 1} 張`}
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
                  移除這張照片
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
