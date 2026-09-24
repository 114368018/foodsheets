import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
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
import { INGREDIENT_LIBRARY_SEED } from './ingredient-library'
import { TOOL_LIBRARY_SEED } from './tool-library'
import { CHANGELOG_ENTRIES } from './changelog'
import ItemQuickList from './components/ItemQuickList'
import ShoppingBoard, { type ShoppingNeed, type ShoppingStore } from './components/ShoppingBoard'
import {
  INGREDIENT_UNIT_CHIPS,
  TOOL_UNIT_CHIPS,
  VAGUE_QTY,
  formatQuantity,
  guessUnit,
  normalizeNameKey,
  normalizeUnitText,
  parseQuantity,
  toBaseUnit,
  type ItemDraft,
} from './item-input'
import {
  db,
  firebaseProjectDocId,
  isFirebaseConfigured,
  missingFirebaseEnvKeys,
} from './firebase'

const SAMPLE_GROUP_TAB = '範例組' as const
const GROUP_TABS = [
  SAMPLE_GROUP_TAB,
  '第一組',
  '第二組',
  '第三組',
  '第四組',
  '第五組',
  '第六組',
  '第七組',
  '學長姐組',
] as const
const NON_SAMPLE_GROUP_TABS = GROUP_TABS.filter((groupName) => groupName !== SAMPLE_GROUP_TAB)
const SUMMARY_TABS = ['食材總表', '工具總表'] as const
const TOOL_LIBRARY_TAB = '工具庫' as const
const INGREDIENT_LIBRARY_TAB = '食材庫' as const
const GROUP_INGREDIENT_LIBRARY_TAB = '各組食材表' as const
const GROUP_TOOL_LIBRARY_TAB = '各組工具表' as const
const CHANGELOG_TAB = '版本日誌' as const
const SHOPPING_LIST_TAB = '食材採買' as const
const ADMIN_PASSCODE = 'admin'
const STORAGE_KEY = 'foodsheets.v1.state'
const RESET_CONFIRM_PHRASE = '全部歸零'
const MIN_DISH_COUNT = 2
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const isCloudinaryConfigured = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET)

type GroupTab = (typeof GROUP_TABS)[number]
type TabName =
  | GroupTab
  | (typeof SUMMARY_TABS)[number]
  | typeof TOOL_LIBRARY_TAB
  | typeof INGREDIENT_LIBRARY_TAB
  | typeof GROUP_INGREDIENT_LIBRARY_TAB
  | typeof GROUP_TOOL_LIBRARY_TAB
  | typeof CHANGELOG_TAB
  | typeof SHOPPING_LIST_TAB

type IngredientRow = {
  id: number
  dishId: number
  ingredient: string
  perServingQty: string
  perServingUnit: string
  totalQty: string
  totalUnit: string
  note: string
}

type ToolRow = {
  id: number
  tool: string
  qty: string
  unit: string
  note: string
}

// One line per ingredient name + (base) unit, summed across all groups.
type IngredientSummaryRow = {
  key: string
  ingredient: string
  unit: string
  sumQty: number
  hasVague: boolean
  missingQtyCount: number
  note: string
  sources: string[]
}

type ToolSummaryRow = {
  key: string
  tool: string
  unit: string
  note: string
  sumQty: number
  sources: string[]
}

type GroupIngredientLibraryRow = {
  id: number
  dishName: string
  ingredient: string
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

type PersistedState = {
  currentTab: TabName
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
}

type ToastState = {
  id: number
  message: string
  undo?: () => void
}

type SaveState = 'local' | 'saving' | 'saved' | 'error'

type GroupCollapseState = {
  dishCollapsedById: Record<number, boolean>
  dishStepsEditorOpenById: Record<number, boolean>
  toolsCollapsed: boolean
  groupIngredientTableCollapsed: boolean
  groupToolTableCollapsed: boolean
}

const createInitialCollapseState = (
  sourceData: Record<GroupTab, GroupData>,
): Record<GroupTab, GroupCollapseState> => {
  return GROUP_TABS.reduce(
    (acc, groupName) => {
      acc[groupName] = {
        dishCollapsedById: sourceData[groupName].dishes.reduce(
          (dishAcc, dish) => {
            dishAcc[dish.id] = false
            return dishAcc
          },
          {} as Record<number, boolean>,
        ),
        dishStepsEditorOpenById: sourceData[groupName].dishes.reduce(
          (dishAcc, dish) => {
            dishAcc[dish.id] = false
            return dishAcc
          },
          {} as Record<number, boolean>,
        ),
        toolsCollapsed: false,
        groupIngredientTableCollapsed: false,
        groupToolTableCollapsed: false,
      }
      return acc
    },
    {} as Record<GroupTab, GroupCollapseState>,
  )
}

const isValidTab = (value: unknown): value is TabName => {
  if (typeof value !== 'string') {
    return false
  }

  return [
    ...GROUP_TABS,
    ...SUMMARY_TABS,
    TOOL_LIBRARY_TAB,
    INGREDIENT_LIBRARY_TAB,
    GROUP_INGREDIENT_LIBRARY_TAB,
    GROUP_TOOL_LIBRARY_TAB,
    CHANGELOG_TAB,
    SHOPPING_LIST_TAB,
  ].includes(value as TabName)
}

const normalizeIngredientLibrary = (input: unknown): string[] => {
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

const normalizeIngredientLibraryWithSeed = (input: unknown): string[] => {
  const values = Array.isArray(input) ? input : []
  return normalizeIngredientLibrary([...INGREDIENT_LIBRARY_SEED, ...values])
}

const normalizeToolLibraryWithSeed = (input: unknown): string[] => {
  const values = Array.isArray(input) ? input : []
  return normalizeToolLibrary([...TOOL_LIBRARY_SEED, ...values])
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

let lastCreatedId = 0

// Date.now() alone collides when several rows are created in the same millisecond (batch paste).
const createId = (): number => {
  lastCreatedId = Math.max(Date.now(), lastCreatedId + 1)
  return lastCreatedId
}

const ingredientRowFromDraft = (id: number, dishId: number, draft: ItemDraft): IngredientRow => ({
  id,
  dishId,
  ingredient: draft.name,
  perServingQty: '',
  perServingUnit: '',
  totalQty: draft.qty,
  totalUnit: draft.unit,
  note: draft.note,
})

const toolRowFromDraft = (id: number, draft: ItemDraft): ToolRow => ({
  id,
  tool: draft.name,
  qty: draft.qty,
  unit: draft.unit,
  note: draft.note,
})

const isBlankIngredientRow = (row: IngredientRow) =>
  !row.ingredient.trim() && !row.totalQty.trim() && !row.totalUnit.trim() && !row.note.trim()

const isBlankToolRow = (row: ToolRow) => !row.tool.trim() && !row.qty.trim() && !row.unit.trim() && !row.note.trim()

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

  return {
    url,
    publicId: typeof imageObj.publicId === 'string' ? imageObj.publicId : undefined,
  }
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
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

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

const getEmbeddablePreviewUrl = (urlValue: string): string | null => {
  const parsed = toValidHttpUrl(urlValue)
  if (!parsed) {
    return null
  }

  const host = parsed.hostname.toLowerCase()

  if (host.includes('youtube.com')) {
    const videoId = parsed.searchParams.get('v')
    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`
    }
  }

  if (host === 'youtu.be') {
    const videoId = parsed.pathname.replace(/^\/+/, '')
    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`
    }
  }

  if (host.includes('vimeo.com')) {
    const segments = parsed.pathname.split('/').filter(Boolean)
    const videoId = segments[segments.length - 1]
    if (videoId && /^\d+$/.test(videoId)) {
      return `https://player.vimeo.com/video/${videoId}`
    }
  }

  return null
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

const createInitialGroupData = (): Record<GroupTab, GroupData> => {
  return GROUP_TABS.reduce(
    (acc, groupName, index) => {
      const offset = (index + 1) * 1000
      const dishes = Array.from({ length: MIN_DISH_COUNT }, (_, dishIndex) =>
        emptyDish(offset + 201 + dishIndex),
      )
      acc[groupName] = {
        teamName: '',
        cuisineType: '',
        dishes,
        ingredientRows: [],
        toolRows: [],
      }
      return acc
    },
    {} as Record<GroupTab, GroupData>,
  )
}

const normalizeGroupData = (input: unknown): Record<GroupTab, GroupData> => {
  const base = createInitialGroupData()
  if (!input || typeof input !== 'object') {
    return base
  }

  const raw = input as Record<string, unknown>

  GROUP_TABS.forEach((groupName, groupIndex) => {
    const groupOffset = (groupIndex + 1) * 1000
    const source = raw[groupName]

    if (!source || typeof source !== 'object') {
      return
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

    const legacyThirdDishId = groupOffset + 203
    const legacyThirdDish = normalizedDishes.find((dish) => dish.id === legacyThirdDishId)
    if (legacyThirdDish && isDishContentEmpty(legacyThirdDish)) {
      normalizedDishes = normalizedDishes.filter((dish) => dish.id !== legacyThirdDishId)
    }

    while (normalizedDishes.length < MIN_DISH_COUNT) {
      normalizedDishes.push(emptyDish(groupOffset + 201 + normalizedDishes.length))
    }

    const normalizedIngredientRows = Array.isArray(sourceObj.ingredientRows)
      ? sourceObj.ingredientRows.map((row, rowIndex) => {
          const rowObj = (row ?? {}) as Record<string, unknown>
          const fallbackDishId =
            normalizedDishes[rowIndex % normalizedDishes.length]?.id ?? normalizedDishes[0].id
          return {
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
      : base[groupName].ingredientRows

    const validDishIds = new Set(normalizedDishes.map((dish) => dish.id))
    // Older versions kept an empty placeholder row per dish; the quick-add UI no longer needs them.
    const sanitizedIngredientRows = normalizedIngredientRows.filter(
      (row) => validDishIds.has(row.dishId) && !isBlankIngredientRow(row),
    )

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
      : base[groupName].toolRows

    base[groupName] = {
      teamName: typeof sourceObj.teamName === 'string' ? sourceObj.teamName : '',
      cuisineType: typeof sourceObj.cuisineType === 'string' ? sourceObj.cuisineType : '',
      dishes: normalizedDishes,
      ingredientRows: sanitizedIngredientRows,
      toolRows: normalizedToolRows.filter((row) => !isBlankToolRow(row)),
    }
  })

  return base
}

const mergeRemoteWithLocalImages = (
  remote: Record<GroupTab, GroupData>,
  local: Record<GroupTab, GroupData>,
  pendingRemovedImageUrls: Set<string>,
  pendingRemovedDishIds: Set<number>,
): Record<GroupTab, GroupData> => {
  const merged = { ...remote }

  GROUP_TABS.forEach((groupName) => {
    // We want to combine the full list of dishes (remote + local not in remote)
    const filteredRemoteDishes = remote[groupName].dishes.filter(
      (dish) => !pendingRemovedDishIds.has(dish.id),
    )
    const remoteDishesMap = new Map(filteredRemoteDishes.map((r) => [r.id, r]))
    const allDishes = [
      ...filteredRemoteDishes,
      ...(local[groupName]?.dishes.filter(
        (localDish) => !remoteDishesMap.has(localDish.id) && !pendingRemovedDishIds.has(localDish.id),
      ) ?? []),
    ]

    const validDishIds = new Set(allDishes.map((dish) => dish.id))

    merged[groupName] = {
      ...remote[groupName],
      ingredientRows: remote[groupName].ingredientRows.filter((row) => validDishIds.has(row.dishId)),
      dishes: allDishes.map((dishBase) => {
        // Find matching dishes from both sides (some "remoteDish" might just be local-only now)
        const remoteDish = remoteDishesMap.get(dishBase.id) || dishBase
        const localDish = local[groupName]?.dishes.find((dish) => dish.id === dishBase.id)

        if (remoteDish.images.length > 0) {
          const localImagesByUrl = new Map((localDish?.images ?? []).map((image) => [image.url, image]))
          const mergedImages = remoteDish.images.map((image) => {
            const localImage = localImagesByUrl.get(image.url)
            return {
              ...image,
              publicId: localImage?.publicId ?? image.publicId,
            }
          })

          const filteredImages = mergedImages.filter((image) => !pendingRemovedImageUrls.has(image.url))

          return {
            ...remoteDish,
            images: uniqueDishImages(filteredImages).slice(0, 2),
          }
        }

        const filteredLocalImages = (localDish?.images ?? []).filter(
          (image) => !pendingRemovedImageUrls.has(image.url),
        )

        return {
          ...remoteDish,
          images: uniqueDishImages(filteredLocalImages).slice(0, 2),
        }
      }),
    }
  })

  return merged
}

const stripGroupImagesForCloud = (group: GroupData): GroupData => ({
  ...group,
  dishes: group.dishes.map((dish) => ({
    ...dish,
    images: uniqueDishImages(dish.images)
      .filter((image) => image.url.startsWith('https://') || image.url.startsWith('http://'))
      .map((image) => ({ url: image.url, publicId: image.publicId }))
      .slice(0, 2),
  })),
})

const SHARED_FIELDS = [
  'ingredientAdjustments',
  'toolAdjustments',
  'toolLibrary',
  'ingredientLibrary',
  'preparedSummaryIngredients',
  'preparedSummaryTools',
  'preparedGroupIngredients',
  'preparedGroupTools',
  'shoppingStores',
] as const

type SharedField = (typeof SHARED_FIELDS)[number]
type CloudState = Omit<PersistedState, 'currentTab'>
type CloudShared = Pick<CloudState, SharedField>

const groupSyncKey = (groupName: GroupTab) => `group:${groupName}`

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
  groupNames: GroupTab[] = [...GROUP_TABS],
): string[] => {
  const ids = new Set<string>()

  groupNames.forEach((groupName) => {
    data[groupName].dishes.forEach((dish) => {
      dish.images.forEach((image) => {
        const fromField = image.publicId?.trim()
        if (fromField) {
          ids.add(fromField)
          return
        }

        const fromUrl = extractPublicIdFromCloudinaryUrl(image.url)
        if (fromUrl) {
          ids.add(fromUrl)
        }
      })
    })
  })

  return Array.from(ids)
}

const deleteCloudinaryAssetsForReset = async (
  groupDataForDelete: Record<GroupTab, GroupData>,
): Promise<{ ok: boolean; message?: string }> => {
  const publicIds = collectCloudinaryPublicIds(groupDataForDelete, [...NON_SAMPLE_GROUP_TABS])
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

const createHardResetGroupData = (
  sourceData: Record<GroupTab, GroupData>,
): Record<GroupTab, GroupData> => {
  const fresh = createInitialGroupData()
  return {
    ...fresh,
    [SAMPLE_GROUP_TAB]: sourceData[SAMPLE_GROUP_TAB],
  }
}

const loadPersistedState = (): PersistedState | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (!parsed.groupData || !parsed.currentTab) {
      return null
    }

    const validTab = isValidTab(parsed.currentTab)
      ? parsed.currentTab
      : SAMPLE_GROUP_TAB

    return {
      currentTab: validTab,
      groupData: normalizeGroupData(parsed.groupData),
      ingredientAdjustments: parsed.ingredientAdjustments ?? {},
      toolAdjustments: parsed.toolAdjustments ?? {},
      toolLibrary: normalizeToolLibraryWithSeed(parsed.toolLibrary),
      ingredientLibrary: normalizeIngredientLibraryWithSeed(parsed.ingredientLibrary),
      preparedSummaryIngredients:
        parsed.preparedSummaryIngredients && typeof parsed.preparedSummaryIngredients === 'object'
          ? parsed.preparedSummaryIngredients
          : {},
      preparedSummaryTools:
        parsed.preparedSummaryTools && typeof parsed.preparedSummaryTools === 'object'
          ? parsed.preparedSummaryTools
          : {},
      preparedGroupIngredients:
        parsed.preparedGroupIngredients && typeof parsed.preparedGroupIngredients === 'object'
          ? parsed.preparedGroupIngredients
          : {},
      preparedGroupTools:
        parsed.preparedGroupTools && typeof parsed.preparedGroupTools === 'object'
          ? parsed.preparedGroupTools
          : {},
      shoppingStores: Array.isArray(parsed.shoppingStores) ? parsed.shoppingStores : [],
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
  const initialGroupData = persistedState?.groupData ?? createInitialGroupData()
  const [currentTab, setCurrentTab] = useState<TabName>(persistedState?.currentTab ?? SAMPLE_GROUP_TAB)
  const [groupData, setGroupData] = useState<Record<GroupTab, GroupData>>(initialGroupData)
  const [groupCollapseState, setGroupCollapseState] = useState<Record<GroupTab, GroupCollapseState>>(
    createInitialCollapseState(initialGroupData),
  )
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminPasscode, setAdminPasscode] = useState('')
  const [adminError, setAdminError] = useState('')
  const [showHardResetPanel, setShowHardResetPanel] = useState(false)
  const [resetConfirmPhrase, setResetConfirmPhrase] = useState('')
  const [resetConfirmPasscode, setResetConfirmPasscode] = useState('')
  const [resetAcknowledged, setResetAcknowledged] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetCooldownSeconds, setResetCooldownSeconds] = useState(0)
  const [ingredientAdjustments, setIngredientAdjustments] = useState<Record<string, string>>(
    persistedState?.ingredientAdjustments ?? {},
  )
  const [toolAdjustments, setToolAdjustments] = useState<Record<string, string>>(
    persistedState?.toolAdjustments ?? {},
  )
  const [toolLibrary, setToolLibrary] = useState<string[]>(
    persistedState?.toolLibrary ?? normalizeToolLibrary(TOOL_LIBRARY_SEED),
  )
  const [ingredientLibrary, setIngredientLibrary] = useState<string[]>(
    persistedState?.ingredientLibrary ?? normalizeIngredientLibrary(INGREDIENT_LIBRARY_SEED),
  )
  const [toolLibraryInput, setToolLibraryInput] = useState('')
  const [toolLibraryError, setToolLibraryError] = useState('')
  const [preparedSummaryIngredients, setPreparedSummaryIngredients] = useState<Record<string, boolean>>(
    persistedState?.preparedSummaryIngredients ?? {},
  )
  const [preparedSummaryTools, setPreparedSummaryTools] = useState<Record<string, boolean>>(
    persistedState?.preparedSummaryTools ?? {},
  )
  const [preparedGroupIngredients, setPreparedGroupIngredients] = useState<Record<string, boolean>>(
    persistedState?.preparedGroupIngredients ?? {},
  )
  const [preparedGroupTools, setPreparedGroupTools] = useState<Record<string, boolean>>(
    persistedState?.preparedGroupTools ?? {},
  )
  const [shoppingStores, setShoppingStores] = useState<ShoppingStore[]>(
    persistedState?.shoppingStores ?? [],
  )
  const [libraryInput, setLibraryInput] = useState('')
  const [libraryError, setLibraryError] = useState('')
  const [uploadingDishIds, setUploadingDishIds] = useState<Record<number, boolean>>({})
  const [uploadProgressByDish, setUploadProgressByDish] = useState<Record<number, number>>({})
  const [resolvedThumbnailByUrl, setResolvedThumbnailByUrl] = useState<Record<string, string>>({})
  const [thumbnailFetchFailedByUrl, setThumbnailFetchFailedByUrl] = useState<Record<string, boolean>>({})
  const [imageUploadError, setImageUploadError] = useState('')
  const [wordExportError, setWordExportError] = useState('')
  const [exportingWord, setExportingWord] = useState(false)
  const [showWordExportOptions, setShowWordExportOptions] = useState(false)
  const [wordExportMode, setWordExportMode] = useState<WordExportMode>('all')
  const [selectedDishIdForWord, setSelectedDishIdForWord] = useState<number | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [saveState, setSaveState] = useState<SaveState>(isFirebaseConfigured ? 'saved' : 'local')
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured
      ? 'Firebase 已設定，雲端同步初始化中…'
      : `尚未設定 Firebase，目前僅本機保存（缺少：${missingFirebaseEnvKeys.join(', ')}）`,
  )

  const applyingRemoteRef = useRef(false)
  const remoteLoadedRef = useRef(false)
  const firestoreWriteFailedRef = useRef(false)
  const pendingRemovedImageUrlsRef = useRef<Set<string>>(new Set())
  const pendingRemovedDishIdsRef = useRef<Set<number>>(new Set())
  const thumbnailInFlightRef = useRef<Set<string>>(new Set())
  const dangerHoldTimerRef = useRef<number | null>(null)
  // JSON of what we last saw in / wrote to Firestore, per group and per shared field.
  // A local value that differs from it has unsaved edits and must not be overwritten by a snapshot.
  const lastSyncedRef = useRef<Record<string, string>>({})
  const latestStateRef = useRef<Omit<PersistedState, 'currentTab'> | null>(null)

  const showToast = (message: string, undo?: () => void) => {
    setToast({ id: createId(), message, undo })
  }

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const activeGroup: GroupTab = GROUP_TABS.includes(currentTab as GroupTab)
    ? (currentTab as GroupTab)
    : '第一組'
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

    GROUP_TABS.forEach((groupName) => {
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
  }, [groupData, resolvedThumbnailByUrl, thumbnailFetchFailedByUrl])

  const ingredientSummaryRows = useMemo<IngredientSummaryRow[]>(() => {
    type Accumulator = {
      row: IngredientSummaryRow
      notes: Set<string>
      perGroup: Map<string, { qty: number; vague: boolean; missing: boolean }>
    }
    const map = new Map<string, Accumulator>()

    NON_SAMPLE_GROUP_TABS.forEach((groupName) => {
      groupData[groupName].ingredientRows.forEach((row) => {
        const ingredientName = row.ingredient.trim()
        if (!ingredientName) {
          return
        }

        const qtyText = row.totalQty.trim()
        const qtyValue = parseQuantity(qtyText)
        const { base, factor } = toBaseUnit(row.totalUnit)
        const key = `${normalizeNameKey(ingredientName)}|${base}`

        let entry = map.get(key)
        if (!entry) {
          entry = {
            row: {
              key,
              ingredient: ingredientName,
              unit: base,
              sumQty: 0,
              hasVague: false,
              missingQtyCount: 0,
              note: '',
              sources: [],
            },
            notes: new Set(),
            perGroup: new Map(),
          }
          map.set(key, entry)
        }

        const groupEntry = entry.perGroup.get(groupName) ?? { qty: 0, vague: false, missing: false }
        if (!qtyText) {
          entry.row.missingQtyCount += 1
          groupEntry.missing = true
        } else if (qtyValue === null) {
          entry.row.hasVague = true
          groupEntry.vague = true
        } else {
          entry.row.sumQty += qtyValue * factor
          groupEntry.qty += qtyValue * factor
        }
        entry.perGroup.set(groupName, groupEntry)

        if (row.note.trim()) {
          entry.notes.add(row.note.trim())
        }
      })
    })

    return Array.from(map.values())
      .map(({ row, notes, perGroup }) => ({
        ...row,
        note: Array.from(notes).join(' / '),
        sources: Array.from(perGroup.entries()).map(([groupName, value]) => {
          const parts = [
            value.qty > 0 ? formatQuantity(value.qty, row.unit) : '',
            value.vague ? VAGUE_QTY : '',
            value.missing ? '未填數量' : '',
          ].filter(Boolean)
          return `${groupName} ${parts.join(' + ')}`
        }),
      }))
      .sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'zh-Hant'))
  }, [groupData])

  const toolSummaryRows = useMemo<ToolSummaryRow[]>(() => {
    const map = new Map<string, ToolSummaryRow & { notes: Set<string> }>()

    NON_SAMPLE_GROUP_TABS.forEach((groupName) => {
      groupData[groupName].toolRows.forEach((row) => {
        const toolName = row.tool.trim()
        if (!toolName || !row.qty.trim()) {
          return
        }

        const unit = normalizeUnitText(row.unit)
        const key = `${normalizeNameKey(toolName)}|${unit}`
        let entry = map.get(key)
        if (!entry) {
          entry = { key, tool: toolName, unit, note: '', sumQty: 0, sources: [], notes: new Set() }
          map.set(key, entry)
        }

        const qty = parseQuantity(row.qty) ?? 0
        entry.sumQty += qty
        entry.sources.push(`${groupName} ${row.qty.trim()}${unit ? ` ${unit}` : ''}`)
        if (row.note.trim()) {
          entry.notes.add(row.note.trim())
        }
      })
    })

    return Array.from(map.values())
      .map(({ notes, ...row }) => ({ ...row, note: Array.from(notes).join(' / ') }))
      .sort((a, b) => a.tool.localeCompare(b.tool, 'zh-Hant'))
  }, [groupData])

  const shoppingNeeds = useMemo<ShoppingNeed[]>(() => {
    type NeedAccumulator = {
      name: string
      parts: Array<{ unit: string; qty: number }>
      hasVague: boolean
      hasMissingQty: boolean
      notes: Set<string>
      sources: string[]
    }
    const byName = new Map<string, NeedAccumulator>()

    ingredientSummaryRows.forEach((row) => {
      const nameKey = normalizeNameKey(row.ingredient)
      const finalQty = row.sumQty + toNumber(ingredientAdjustments[row.key] ?? '')
      const entry = byName.get(nameKey) ?? {
        name: row.ingredient,
        parts: [],
        hasVague: false,
        hasMissingQty: false,
        notes: new Set<string>(),
        sources: [],
      }

      if (finalQty > 0) {
        entry.parts.push({ unit: row.unit, qty: finalQty })
      }
      entry.hasVague ||= row.hasVague
      entry.hasMissingQty ||= row.missingQtyCount > 0
      if (row.note) {
        entry.notes.add(row.note)
      }
      entry.sources.push(...row.sources)
      byName.set(nameKey, entry)
    })

    return Array.from(byName.entries())
      .map(([key, entry]) => {
        const amounts = entry.parts.map((part) => formatQuantity(part.qty, part.unit))
        if (entry.hasVague) {
          amounts.push(VAGUE_QTY)
        }
        return {
          key,
          name: entry.name,
          display: amounts.length > 0 ? amounts.join(' + ') : '數量未填',
          single: entry.parts.length === 1 ? entry.parts[0] : null,
          note: Array.from(entry.notes).join(' / '),
          sources: entry.sources,
          hasMissingQty: entry.hasMissingQty,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [ingredientAdjustments, ingredientSummaryRows])

  // Most common unit each name was entered with, so a new entry defaults to what others used.
  const unitUsage = useMemo(() => {
    const ingredient = new Map<string, Map<string, number>>()
    const tool = new Map<string, Map<string, number>>()
    const count = (target: Map<string, Map<string, number>>, name: string, unit: string) => {
      const key = normalizeNameKey(name)
      const trimmedUnit = unit.trim()
      if (!key || !trimmedUnit) {
        return
      }
      const counts = target.get(key) ?? new Map<string, number>()
      counts.set(trimmedUnit, (counts.get(trimmedUnit) ?? 0) + 1)
      target.set(key, counts)
    }

    GROUP_TABS.forEach((groupName) => {
      groupData[groupName].ingredientRows.forEach((row) => count(ingredient, row.ingredient, row.totalUnit))
      groupData[groupName].toolRows.forEach((row) => count(tool, row.tool, row.unit))
    })
    return { ingredient, tool }
  }, [groupData])

  const suggestIngredientUnit = useCallback(
    (name: string) => {
      const counts = unitUsage.ingredient.get(normalizeNameKey(name))
      const learned = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined
      return learned ?? guessUnit(name, 'ingredient')
    },
    [unitUsage],
  )

  const suggestToolUnit = useCallback(
    (name: string) => {
      const counts = unitUsage.tool.get(normalizeNameKey(name))
      const learned = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined
      return learned ?? guessUnit(name, 'tool')
    },
    [unitUsage],
  )

  // Library plus anything other groups typed, so custom names show up as suggestions too.
  const ingredientSuggestions = useMemo(() => {
    const used = GROUP_TABS.flatMap((groupName) => groupData[groupName].ingredientRows.map((row) => row.ingredient))
    return normalizeIngredientLibrary([...ingredientLibrary, ...used])
  }, [groupData, ingredientLibrary])

  const toolSuggestions = useMemo(() => {
    const used = GROUP_TABS.flatMap((groupName) => groupData[groupName].toolRows.map((row) => row.tool))
    return normalizeToolLibrary([...toolLibrary, ...used])
  }, [groupData, toolLibrary])

  const activeGroupChecklist = useMemo(() => {
    const group = groupData[activeGroup]
    const items: Array<{ label: string; done: boolean; targetId: string }> = [
      { label: '廚神名字', done: Boolean(group.teamName.trim()), targetId: 'group-meta' },
      { label: '料理種類', done: Boolean(group.cuisineType.trim()), targetId: 'group-meta' },
    ]

    group.dishes.forEach((dish, index) => {
      const dishLabel = dish.title.trim() || `料理${index + 1}`
      const rows = group.ingredientRows.filter((row) => row.dishId === dish.id && row.ingredient.trim())
      const missingQty = rows.filter((row) => !row.totalQty.trim()).length
      items.push({ label: `料理${index + 1} 名稱`, done: Boolean(dish.title.trim()), targetId: `dish-${dish.id}` })
      items.push({
        label: rows.length === 0 ? `${dishLabel} 的食材` : `${dishLabel} 食材數量（${missingQty} 項未填）`,
        done: rows.length > 0 && missingQty === 0,
        targetId: `dish-${dish.id}`,
      })
    })

    const toolsMissingQty = group.toolRows.filter((row) => row.tool.trim() && !row.qty.trim()).length
    if (toolsMissingQty > 0) {
      items.push({ label: `工具數量（${toolsMissingQty} 項未填）`, done: false, targetId: 'group-tools' })
    }

    return items
  }, [activeGroup, groupData])

  const ingredientLibraryByGroup = useMemo(
    () =>
      NON_SAMPLE_GROUP_TABS.map((groupName) => {
        const group = groupData[groupName]
        const dishNameById = new Map(
          group.dishes.map((dish, index) => [dish.id, dish.title.trim() || `料理${index + 1}`]),
        )

        const rows: GroupIngredientLibraryRow[] = group.ingredientRows
          .filter((row) => row.ingredient.trim())
          .map((row) => ({
            id: row.id,
            dishName: dishNameById.get(row.dishId) ?? '未指定料理',
            ingredient: row.ingredient.trim(),
            totalQty: row.totalQty.trim(),
            totalUnit: row.totalUnit.trim(),
            note: row.note.trim(),
          }))

        return {
          groupName,
          rows,
        }
      }),
    [groupData],
  )

  const toolLibraryByGroup = useMemo(
    () =>
      NON_SAMPLE_GROUP_TABS.map((groupName) => {
        const group = groupData[groupName]

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
          groupName,
          rows,
        }
      }),
    [groupData],
  )

  const visibleTabs: TabName[] = adminUnlocked
    ? [
        ...GROUP_TABS,
        GROUP_INGREDIENT_LIBRARY_TAB,
        GROUP_TOOL_LIBRARY_TAB,
        '食材總表',
        '工具總表',
        SHOPPING_LIST_TAB,
        TOOL_LIBRARY_TAB,
        INGREDIENT_LIBRARY_TAB,
        CHANGELOG_TAB,
      ]
    : [...GROUP_TABS, CHANGELOG_TAB]

  type QuickItemPatch = Partial<{ name: string; qty: string; unit: string; note: string }>

  const setGroupRows = <K extends 'ingredientRows' | 'toolRows'>(
    groupName: GroupTab,
    field: K,
    update: (rows: GroupData[K]) => GroupData[K],
  ) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        [field]: update(previous[groupName][field]),
      },
    }))
  }

  const createIngredientRows = (groupName: GroupTab, dishId: number, drafts: ItemDraft[]): number[] => {
    const ids = drafts.map(() => createId())
    setGroupRows(groupName, 'ingredientRows', (rows) => [
      ...rows,
      ...drafts.map((draft, index) => ingredientRowFromDraft(ids[index], dishId, draft)),
    ])
    return ids
  }

  const patchIngredientRow = (groupName: GroupTab, id: number, patch: QuickItemPatch) => {
    setGroupRows(groupName, 'ingredientRows', (rows) =>
      rows.map((row) =>
        row.id === id
          ? {
              ...row,
              ingredient: patch.name ?? row.ingredient,
              totalQty: patch.qty ?? row.totalQty,
              totalUnit: patch.unit ?? row.totalUnit,
              note: patch.note ?? row.note,
            }
          : row,
      ),
    )
  }

  const createToolRows = (groupName: GroupTab, drafts: ItemDraft[]): number[] => {
    const ids = drafts.map(() => createId())
    setGroupRows(groupName, 'toolRows', (rows) => [
      ...rows,
      ...drafts.map((draft, index) => toolRowFromDraft(ids[index], draft)),
    ])
    return ids
  }

  const patchToolRow = (groupName: GroupTab, id: number, patch: QuickItemPatch) => {
    setGroupRows(groupName, 'toolRows', (rows) =>
      rows.map((row) =>
        row.id === id
          ? {
              ...row,
              tool: patch.name ?? row.tool,
              qty: patch.qty ?? row.qty,
              unit: patch.unit ?? row.unit,
              note: patch.note ?? row.note,
            }
          : row,
      ),
    )
  }

  // Deleting is instant; the toast offers an undo instead of asking "are you sure?" every time.
  const removeRowWithUndo = <K extends 'ingredientRows' | 'toolRows'>(groupName: GroupTab, field: K, id: number) => {
    const rows = groupData[groupName][field] as Array<IngredientRow | ToolRow>
    const index = rows.findIndex((row) => row.id === id)
    const removed = rows[index]
    if (!removed) {
      return
    }

    setGroupRows(groupName, field, (current) => current.filter((row) => row.id !== id) as GroupData[K])
    const label = 'ingredient' in removed ? removed.ingredient : removed.tool
    showToast(`已刪除「${label.trim() || '未命名'}」`, () => {
      setGroupRows(groupName, field, (current) => {
        if (current.some((row) => row.id === id)) {
          return current
        }
        const next = [...current] as Array<IngredientRow | ToolRow>
        next.splice(Math.min(index, next.length), 0, removed)
        return next as GroupData[K]
      })
    })
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
      },
    }))

    setGroupCollapseState((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishCollapsedById: {
          ...previous[groupName].dishCollapsedById,
          [newDishId]: false,
        },
        dishStepsEditorOpenById: {
          ...previous[groupName].dishStepsEditorOpenById,
          [newDishId]: false,
        },
      },
    }))
  }

  const removeDish = (groupName: GroupTab, dishId: number) => {
    const dishIndex = groupData[groupName].dishes.findIndex((dish) => dish.id === dishId)
    const dishLabel = dishIndex >= 0 ? `料理${dishIndex + 1}` : '此料理'
    const confirmed = window.confirm(`確定要刪除${dishLabel}嗎？該料理下的食材將一併刪除。`)
    if (!confirmed) {
      return
    }

    pendingRemovedDishIdsRef.current.add(dishId)

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

    setGroupCollapseState((previous) => {
      const nextDishCollapsedById = { ...previous[groupName].dishCollapsedById }
      const nextDishStepsEditorOpenById = { ...previous[groupName].dishStepsEditorOpenById }
      delete nextDishCollapsedById[dishId]
      delete nextDishStepsEditorOpenById[dishId]

      return {
        ...previous,
        [groupName]: {
          ...previous[groupName],
          dishCollapsedById: nextDishCollapsedById,
          dishStepsEditorOpenById: nextDishStepsEditorOpenById,
        },
      }
    })
  }

  const handleDishImageUpload = async (groupName: GroupTab, dishId: number, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
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

    if (targetImage?.url) {
      pendingRemovedImageUrlsRef.current.add(targetImage.url)
    }

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

    const freshGroupData = createHardResetGroupData(groupData)
    const freshToolLibrary = normalizeToolLibrary(TOOL_LIBRARY_SEED)
    const freshIngredientLibrary = normalizeIngredientLibrary(INGREDIENT_LIBRARY_SEED)

    setCurrentTab(SAMPLE_GROUP_TAB)
    setGroupData(freshGroupData)
    setGroupCollapseState(createInitialCollapseState(freshGroupData))
    setIngredientAdjustments({})
    setToolAdjustments({})
    setToolLibrary(freshToolLibrary)
    setIngredientLibrary(freshIngredientLibrary)
    setPreparedSummaryIngredients({})
    setPreparedSummaryTools({})
    setPreparedGroupIngredients({})
    setPreparedGroupTools({})
    setShoppingStores([])
    setToolLibraryInput('')
    setToolLibraryError('')
    setLibraryInput('')
    setLibraryError('')
    setUploadingDishIds({})
    setUploadProgressByDish({})
    setResolvedThumbnailByUrl({})
    setThumbnailFetchFailedByUrl({})
    setImageUploadError('')
    pendingRemovedImageUrlsRef.current.clear()
    pendingRemovedDishIdsRef.current.clear()
    window.localStorage.removeItem(STORAGE_KEY)

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

    setIngredientLibrary((previous) => {
      const alreadyExists = previous.some((name) => name.toLowerCase() === trimmed.toLowerCase())
      if (alreadyExists) {
        setLibraryError('食材庫已存在相同名稱。')
        return previous
      }

      setLibraryError('')
      return [...previous, trimmed].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    })
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

    setToolLibrary((previous) => {
      const alreadyExists = previous.some((name) => name.toLowerCase() === trimmed.toLowerCase())
      if (alreadyExists) {
        setToolLibraryError('工具庫已存在相同名稱。')
        return previous
      }

      setToolLibraryError('')
      return [...previous, trimmed].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    })
    setToolLibraryInput('')
  }

  const removeLibraryTool = (name: string) => {
    const confirmed = window.confirm(`確定要從工具庫刪除「${name}」嗎？`)
    if (!confirmed) {
      return
    }

    setToolLibrary((previous) => previous.filter((item) => item !== name))
  }

  const toggleDishCollapse = (groupName: GroupTab, dishId: number) => {
    setGroupCollapseState((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishCollapsedById: {
          ...previous[groupName].dishCollapsedById,
          [dishId]: !previous[groupName].dishCollapsedById[dishId],
        },
      },
    }))
  }

  const toggleDishStepEditor = (groupName: GroupTab, dishId: number) => {
    setGroupCollapseState((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        dishStepsEditorOpenById: {
          ...previous[groupName].dishStepsEditorOpenById,
          [dishId]: !previous[groupName].dishStepsEditorOpenById[dishId],
        },
      },
    }))
  }

  const toggleToolsCollapse = (groupName: GroupTab) => {
    setGroupCollapseState((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolsCollapsed: !previous[groupName].toolsCollapsed,
      },
    }))
  }

  const toggleGroupIngredientTableCollapse = (groupName: GroupTab) => {
    setGroupCollapseState((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        groupIngredientTableCollapsed: !previous[groupName].groupIngredientTableCollapsed,
      },
    }))
  }

  const toggleGroupToolTableCollapse = (groupName: GroupTab) => {
    setGroupCollapseState((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        groupToolTableCollapsed: !previous[groupName].groupToolTableCollapsed,
      },
    }))
  }

  useEffect(() => {
    const payload: PersistedState = {
      currentTab,
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
    }

    latestStateRef.current = {
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
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [
    currentTab,
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
  ])

  useEffect(() => {
    const currentIsHiddenAdminTab = SUMMARY_TABS.includes(currentTab as (typeof SUMMARY_TABS)[number])
      || currentTab === TOOL_LIBRARY_TAB
      || currentTab === INGREDIENT_LIBRARY_TAB
      || currentTab === GROUP_INGREDIENT_LIBRARY_TAB
      || currentTab === GROUP_TOOL_LIBRARY_TAB
      || currentTab === SHOPPING_LIST_TAB

    if (!adminUnlocked && currentIsHiddenAdminTab) {
      setCurrentTab('第一組')
    }
  }, [adminUnlocked, currentTab])

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const unsubscribe = onSnapshot(
      projectRef,
      (snapshot) => {
        if (firestoreWriteFailedRef.current) {
          return
        }

        if (!snapshot.exists()) {
          const baseFreshGroupData = createInitialGroupData()
          applyingRemoteRef.current = true
          setCurrentTab(SAMPLE_GROUP_TAB)
          setGroupData((previous) => ({
            ...baseFreshGroupData,
            [SAMPLE_GROUP_TAB]: previous[SAMPLE_GROUP_TAB],
          }))
          setGroupCollapseState((previous) => {
            const next = createInitialCollapseState(baseFreshGroupData)
            return {
              ...next,
              [SAMPLE_GROUP_TAB]: previous[SAMPLE_GROUP_TAB],
            }
          })
          setIngredientAdjustments({})
          setToolAdjustments({})
          setToolLibrary(normalizeToolLibrary(TOOL_LIBRARY_SEED))
          setIngredientLibrary(normalizeIngredientLibrary(INGREDIENT_LIBRARY_SEED))
          setPreparedSummaryIngredients({})
          setPreparedSummaryTools({})
          setPreparedGroupIngredients({})
          setPreparedGroupTools({})
          setShoppingStores([])
          setResolvedThumbnailByUrl({})
          setThumbnailFetchFailedByUrl({})
          setImageUploadError('')
          pendingRemovedImageUrlsRef.current.clear()
          pendingRemovedDishIdsRef.current.clear()
          window.localStorage.removeItem(STORAGE_KEY)
          lastSyncedRef.current = {}
          remoteLoadedRef.current = true
          setSyncStatus('已連線雲端：未找到資料，已重建乾淨初始狀態')
          applyingRemoteRef.current = false
          return
        }

        const data = snapshot.data() as Partial<PersistedState>
        if (!data.groupData) {
          remoteLoadedRef.current = true
          setSyncStatus('已連線雲端：資料格式不完整，保留本機內容')
          return
        }

        applyingRemoteRef.current = true
        const synced = lastSyncedRef.current
        const local = latestStateRef.current
        // A value differing from what we last synced was edited here and not written yet:
        // keep it instead of letting another user's snapshot wipe out what is being typed.
        const hasUnsavedEdits = (key: string, localValue: unknown) =>
          synced[key] !== undefined && synced[key] !== JSON.stringify(localValue)

        const normalizedRemoteGroupData = normalizeGroupData(data.groupData)
        const remoteDishIds = new Set<number>(
          GROUP_TABS.flatMap((groupName) => normalizedRemoteGroupData[groupName].dishes.map((dish) => dish.id)),
        )
        Array.from(pendingRemovedDishIdsRef.current).forEach((dishId) => {
          if (!remoteDishIds.has(dishId)) {
            pendingRemovedDishIdsRef.current.delete(dishId)
          }
        })

        const keepLocalGroups = new Set<GroupTab>()
        GROUP_TABS.forEach((groupName) => {
          const key = groupSyncKey(groupName)
          if (local && hasUnsavedEdits(key, stripGroupImagesForCloud(local.groupData[groupName]))) {
            keepLocalGroups.add(groupName)
            return
          }
          synced[key] = JSON.stringify(stripGroupImagesForCloud(normalizedRemoteGroupData[groupName]))
        })

        setGroupData((previous) => {
          const merged = mergeRemoteWithLocalImages(
            normalizedRemoteGroupData,
            previous,
            pendingRemovedImageUrlsRef.current,
            pendingRemovedDishIdsRef.current,
          )
          keepLocalGroups.forEach((groupName) => {
            merged[groupName] = previous[groupName]
          })
          return merged
        })

        const asFlagRecord = (value: unknown): Record<string, boolean> =>
          value && typeof value === 'object' ? (value as Record<string, boolean>) : {}

        const applyShared = <K extends SharedField>(
          field: K,
          remoteValue: CloudState[K],
          setter: (value: CloudState[K]) => void,
        ) => {
          if (local && hasUnsavedEdits(field, local[field])) {
            return
          }
          synced[field] = JSON.stringify(remoteValue)
          setter(remoteValue)
        }

        applyShared('ingredientAdjustments', data.ingredientAdjustments ?? {}, setIngredientAdjustments)
        applyShared('toolAdjustments', data.toolAdjustments ?? {}, setToolAdjustments)
        applyShared('toolLibrary', normalizeToolLibraryWithSeed(data.toolLibrary), setToolLibrary)
        applyShared('ingredientLibrary', normalizeIngredientLibraryWithSeed(data.ingredientLibrary), setIngredientLibrary)
        applyShared(
          'preparedSummaryIngredients',
          asFlagRecord(data.preparedSummaryIngredients),
          setPreparedSummaryIngredients,
        )
        applyShared('preparedSummaryTools', asFlagRecord(data.preparedSummaryTools), setPreparedSummaryTools)
        applyShared('preparedGroupIngredients', asFlagRecord(data.preparedGroupIngredients), setPreparedGroupIngredients)
        applyShared('preparedGroupTools', asFlagRecord(data.preparedGroupTools), setPreparedGroupTools)
        if (Array.isArray(data.shoppingStores)) {
          applyShared('shoppingStores', data.shoppingStores, setShoppingStores)
        }
        remoteLoadedRef.current = true
        setSyncStatus('已連線雲端：即時同步中')
        // Do not defer the flag update, immediately unlock saving so synchronous local updates don't get ignored
        applyingRemoteRef.current = false
      },
      () => {
        setSyncStatus('雲端同步失敗，已切換為本機模式')
        setSaveState('error')
      },
    )

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !db || !remoteLoadedRef.current || applyingRemoteRef.current) {
      return
    }

    // Only send what changed (per group / per shared field), so two groups editing at the
    // same time no longer overwrite each other's whole document.
    const synced = lastSyncedRef.current
    const payload: Record<string, unknown> = {}
    const written: Record<string, string> = {}

    const groupPatch: Partial<Record<GroupTab, GroupData>> = {}
    GROUP_TABS.forEach((groupName) => {
      const cloudGroup = stripGroupImagesForCloud(groupData[groupName])
      const json = JSON.stringify(cloudGroup)
      if (json !== synced[groupSyncKey(groupName)]) {
        groupPatch[groupName] = cloudGroup
        written[groupSyncKey(groupName)] = json
      }
    })
    if (Object.keys(groupPatch).length > 0) {
      payload.groupData = groupPatch
    }

    const shared: CloudShared = {
      ingredientAdjustments,
      toolAdjustments,
      toolLibrary,
      ingredientLibrary,
      preparedSummaryIngredients,
      preparedSummaryTools,
      preparedGroupIngredients,
      preparedGroupTools,
      shoppingStores,
    }
    SHARED_FIELDS.forEach((field) => {
      const json = JSON.stringify(shared[field])
      if (json !== synced[field]) {
        payload[field] = shared[field]
        written[field] = json
      }
    })

    if (Object.keys(payload).length === 0) {
      return
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const timer = window.setTimeout(() => {
      setSaveState('saving')
      setDoc(projectRef, payload, { merge: true })
        .then(() => {
          Object.assign(lastSyncedRef.current, written)
          if (firestoreWriteFailedRef.current) {
            setSyncStatus('雲端寫入已恢復，即時同步中')
          }
          firestoreWriteFailedRef.current = false
          setSaveState('saved')
        })
        .catch(() => {
          firestoreWriteFailedRef.current = true
          setSyncStatus('雲端寫入失敗，已保留本機刪除結果並暫停套用雲端快照')
          setSaveState('error')
        })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [
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
  ])

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
      const exportTitle = mode === 'all' ? `${groupName} 料理步驟手冊` : `${groupName} 單道料理步驟`

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
          ? sanitizeFileName(`${groupName}-料理步驟-全料理-${today}.docx`)
          : sanitizeFileName(`${groupName}-${selectedDishName}-料理步驟-${today}.docx`)
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
          text: `${groupName} 所需工具清單`,
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
      const fileName = sanitizeFileName(`${groupName}-所需工具-${today}.docx`)
      downloadBlobFile(blob, fileName)
      setShowWordExportOptions(false)
    } catch {
      setWordExportError('匯出工具 Word 失敗，請稍後再試。')
    } finally {
      setExportingWord(false)
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>聖誕趴-廚藝競賽</h1>
          <p className="save-status-row">
            <span className={`save-pill save-pill-${saveState}`} title={syncStatus}>
              {saveState === 'saving' && '儲存中…'}
              {saveState === 'saved' && '✓ 已自動儲存'}
              {saveState === 'error' && '⚠ 雲端儲存失敗'}
              {saveState === 'local' && '僅存在這台裝置'}
            </span>
            <span className="hint save-status-detail">{syncStatus}</span>
          </p>
        </div>
        <section className="admin-access">
          <p className="hint admin-title">管理員入口</p>
          {adminUnlocked ? (
            <button className="btn-danger" onClick={lockAdminAccess}>
              登出管理員
            </button>
          ) : (
            <div className="lock-form">
              <input
                type="password"
                placeholder="輸入管理員密碼"
                value={adminPasscode}
                onChange={(event) => setAdminPasscode(event.target.value)}
              />
              <button onClick={unlockAdminAccess}>解鎖</button>
            </div>
          )}
          {adminError && <p className="error admin-error">{adminError}</p>}
          {adminUnlocked && (
            <div className="hard-reset-entry">
              {!showHardResetPanel ? (
                <button
                  type="button"
                  className="btn-danger-outline tiny-danger-trigger"
                  onMouseDown={startDangerHold}
                  onMouseUp={cancelDangerHold}
                  onMouseLeave={cancelDangerHold}
                  onTouchStart={startDangerHold}
                  onTouchEnd={cancelDangerHold}
                >
                  長按 3 秒刪除所有資料
                </button>
              ) : (
                <div className="hard-reset-panel">
                  <p className="hard-reset-title">高風險：全資料歸零</p>
                  <p className="hint">需要同時通過密碼、確認字串、風險勾選，且倒數結束後才可執行。</p>
                  <input
                    type="password"
                    placeholder="再次輸入管理員密碼"
                    value={resetConfirmPasscode}
                    onChange={(event) => setResetConfirmPasscode(event.target.value)}
                  />
                  <input
                    placeholder={`請輸入確認字串：${RESET_CONFIRM_PHRASE}`}
                    value={resetConfirmPhrase}
                    onChange={(event) => setResetConfirmPhrase(event.target.value)}
                  />
                  <label className="hard-reset-check">
                    <input
                      type="checkbox"
                      checked={resetAcknowledged}
                      onChange={(event) => setResetAcknowledged(event.target.checked)}
                    />
                    我確認這會清空全部資料且無法復原
                  </label>
                  <div className="hard-reset-actions">
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => {
                        void executeHardReset()
                      }}
                      disabled={resetCooldownSeconds > 0}
                    >
                      {resetCooldownSeconds > 0 ? `請等待 ${resetCooldownSeconds} 秒` : '執行全歸零'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={closeHardResetPanel}>
                      取消
                    </button>
                  </div>
                  {resetError && <p className="error admin-error">{resetError}</p>}
                </div>
              )}
            </div>
          )}
        </section>
      </header>

      {imageUploadError && <p className="error">{imageUploadError}</p>}

      <nav className="tabs panel" aria-label="分頁">
        <div className="tab-row">
          <span className="tab-row-label">組別</span>
          {visibleTabs
            .filter((tabName) => GROUP_TABS.includes(tabName as GroupTab) || tabName === CHANGELOG_TAB)
            .map((tabName) => (
              <button
                key={tabName}
                className={currentTab === tabName ? 'tab-active' : ''}
                aria-current={currentTab === tabName ? 'page' : undefined}
                onClick={() => setCurrentTab(tabName)}
              >
                {tabName}
              </button>
            ))}
        </div>
        {adminUnlocked && (
          <div className="tab-row">
            <span className="tab-row-label">行政組</span>
            {visibleTabs
              .filter((tabName) => !GROUP_TABS.includes(tabName as GroupTab) && tabName !== CHANGELOG_TAB)
              .map((tabName) => (
                <button
                  key={tabName}
                  className={`tab-admin ${currentTab === tabName ? 'tab-active' : ''}`.trim()}
                  aria-current={currentTab === tabName ? 'page' : undefined}
                  onClick={() => setCurrentTab(tabName)}
                >
                  {tabName === SHOPPING_LIST_TAB ? '🛒 ' : ''}
                  {tabName}
                </button>
              ))}
          </div>
        )}
      </nav>

      <datalist id="ingredient-library-options">
        {ingredientSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <datalist id="tool-library-options">
        {toolSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {GROUP_TABS.includes(currentTab as GroupTab) && (
        <>
          {isActiveGroupSample && !adminUnlocked && (
            <p className="notice-banner">👀 這是範例組，給大家參考怎麼填。請切換到自己的組別開始填寫。</p>
          )}
          {!isActiveGroupSample && (() => {
            const pendingItems = activeGroupChecklist.filter((item) => !item.done)
            const doneCount = activeGroupChecklist.length - pendingItems.length
            const percent = Math.round((doneCount / Math.max(activeGroupChecklist.length, 1)) * 100)

            return (
              <section className={`progress-card ${pendingItems.length === 0 ? 'is-complete' : ''}`}>
                <div className="progress-card-head">
                  <strong>
                    {pendingItems.length === 0
                      ? '🎉 都填好了！行政組會依照這份清單去採買'
                      : `${activeGroup} 填寫進度 ${doneCount}/${activeGroupChecklist.length}`}
                  </strong>
                  <span className="hint progress-card-hint">輸入後會自動儲存，不需要按送出</span>
                </div>
                <div className="progress-track" aria-hidden="true">
                  <div className="progress-fill" style={{ width: `${percent}%` }} />
                </div>
                {pendingItems.length > 0 && (
                  <div className="progress-todo">
                    <span className="progress-todo-label">還差：</span>
                    {pendingItems.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className="todo-chip"
                        onClick={() =>
                          document.getElementById(item.targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )
          })()}
          <section className="panel" id="group-meta">
            <h2>{activeGroup}</h2>
            <fieldset className="group-edit-fieldset" disabled={!canEditActiveGroup}>
              <div className="meta-grid">
              <label>
                <span className="field-label">
                  廚神 <span className="required-badge">必填</span>
                </span>
                <input
                  value={groupData[activeGroup].teamName}
                  onChange={(event) => updateGroupMeta(activeGroup, 'teamName', event.target.value)}
                  placeholder="你們的隊名或成員名字"
                  className={!groupData[activeGroup].teamName.trim() ? 'input-required' : ''}
                />
              </label>
              <label>
                <span className="field-label">
                  料理種類 <span className="required-badge">必填</span>
                </span>
                <input
                  value={groupData[activeGroup].cuisineType}
                  onChange={(event) => updateGroupMeta(activeGroup, 'cuisineType', event.target.value)}
                  placeholder="例如：韓式、義式、台式"
                  className={!groupData[activeGroup].cuisineType.trim() ? 'input-required' : ''}
                />
              </label>
              </div>
            </fieldset>
          </section>

          <div className="actions word-export-actions" style={{ marginBottom: '1rem' }}>
            {!showWordExportOptions ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setWordExportError('')
                  setShowWordExportOptions(true)
                }}
              >
                匯出 Word（料理步驟/所需工具）
              </button>
            ) : (
              <div className="word-export-panel">
                <p className="hint" style={{ marginBottom: '0.5rem' }}>請選擇下載方式</p>
                <div className="word-export-mode-row">
                  <button
                    type="button"
                    className={wordExportMode === 'all' ? 'word-export-mode-active' : 'btn-secondary'}
                    onClick={() => setWordExportMode('all')}
                  >
                    一次下載所有料理
                  </button>
                  <button
                    type="button"
                    className={wordExportMode === 'single' ? 'word-export-mode-active' : 'btn-secondary'}
                    onClick={() => setWordExportMode('single')}
                  >
                    下載各別料理
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      void exportGroupToolsToWord(activeGroup)
                    }}
                    disabled={exportingWord}
                  >
                    下載所需工具 Word
                  </button>
                </div>

                {wordExportMode === 'single' && (
                  <label className="word-export-select-wrap">
                    選擇要下載的料理
                    <select
                      value={selectedDishIdForWord ?? ''}
                      onChange={(event) => setSelectedDishIdForWord(Number(event.target.value) || null)}
                    >
                      {activeDishes.map((dish, index) => (
                        <option key={dish.id} value={dish.id}>
                          第{index + 1}道料理 - {dish.title.trim() || '未命名料理'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="word-export-button-row">
                  <button
                    type="button"
                    onClick={() => {
                      void exportGroupRecipesToWord(activeGroup, wordExportMode, selectedDishIdForWord)
                    }}
                    disabled={
                      exportingWord || (wordExportMode === 'single' && selectedDishIdForWord === null)
                    }
                  >
                    {exportingWord ? 'Word 產生中…' : '開始下載'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowWordExportOptions(false)}
                    disabled={exportingWord}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            {wordExportError && <p className="error">{wordExportError}</p>}
          </div>

          {activeDishes.map((dish, dishIndex) => {
            const dishIngredientRows = activeIngredientRows.filter((row) => row.dishId === dish.id)
            const isDishCollapsed = Boolean(groupCollapseState[activeGroup].dishCollapsedById[dish.id])
            const isStepEditorOpen = Boolean(
              groupCollapseState[activeGroup].dishStepsEditorOpenById[dish.id],
            )

            return (
              <section key={`input-${dish.id}`} className="panel" id={`dish-${dish.id}`}>
                <div className="section-header">
                  <h2>{dish.title.trim() ? `料理${dishIndex + 1}｜${dish.title.trim()}` : `料理${dishIndex + 1}`}</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {dishIndex >= MIN_DISH_COUNT && canEditActiveGroup && (
                      <button
                        type="button"
                        className="btn-danger-outline"
                        onClick={() => removeDish(activeGroup, dish.id)}
                      >
                        刪除
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-collapse"
                      onClick={() => toggleDishCollapse(activeGroup, dish.id)}
                      aria-expanded={!isDishCollapsed}
                    >
                      <span className="btn-collapse-label">{isDishCollapsed ? '展開' : '摺疊'}</span>
                      <span
                        className={`btn-collapse-icon ${isDishCollapsed ? 'is-collapsed' : ''}`}
                        aria-hidden="true"
                      >
                        ▲
                      </span>
                    </button>
                  </div>
                </div>

                <div className={`collapse-content ${isDishCollapsed ? 'is-collapsed' : ''}`}>
                  <div className="collapse-inner">
                    <fieldset className="group-edit-fieldset" disabled={!canEditActiveGroup}>
                    <article className="dish-card">
                  <label>
                    <span className="field-label">
                      料理名稱 <span className="required-badge">必填</span>
                    </span>
                    <input
                      value={dish.title}
                      onChange={(event) => updateDish(activeGroup, dish.id, 'title', event.target.value)}
                      placeholder="例如：韓式泡菜煎餅"
                      className={!dish.title.trim() ? 'input-required' : ''}
                    />
                  </label>
                  <label>
                    製作影片或食譜網址
                    <input
                      value={dish.videoUrl}
                      onChange={(event) => updateDish(activeGroup, dish.id, 'videoUrl', event.target.value)}
                      onBlur={(event) =>
                        updateDish(activeGroup, dish.id, 'videoUrl', normalizeUrlInput(event.target.value))
                      }
                      placeholder="貼上 YouTube 或其他料理網址（選填）"
                    />
                  </label>
                  {dish.videoUrl.trim() && (() => {
                    const parsedUrl = toValidHttpUrl(dish.videoUrl)
                    if (!parsedUrl) {
                      return <p className="field-error">網址格式不正確，請輸入 http(s) 連結。</p>
                    }

                    const embedUrl = getEmbeddablePreviewUrl(parsedUrl.toString())
                    const normalizedPreviewUrl = parsedUrl.toString()
                    const thumbnailUrl = getThumbnailPreviewUrl(
                      normalizedPreviewUrl,
                      resolvedThumbnailByUrl,
                      thumbnailFetchFailedByUrl,
                    )
                    const isThumbnailLoading =
                      isICookRecipeUrl(parsedUrl) &&
                      !thumbnailUrl &&
                      !thumbnailFetchFailedByUrl[normalizedPreviewUrl]

                    return (
                      <div className="video-preview-block">
                        <a
                          href={parsedUrl.toString()}
                          target="_blank"
                          rel="noreferrer"
                          className="video-link"
                        >
                          開啟連結：{parsedUrl.toString()}
                        </a>
                        {embedUrl ? (
                          <div className="video-embed-wrap">
                            <iframe
                              src={embedUrl}
                              title={`${dish.title || `料理${dishIndex + 1}`} 影片預覽`}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                              allowFullScreen
                            />
                          </div>
                        ) : thumbnailUrl ? (
                          <a
                            href={parsedUrl.toString()}
                            target="_blank"
                            rel="noreferrer"
                            className="link-thumbnail-wrap"
                          >
                            <img
                              src={thumbnailUrl}
                              alt={`${dish.title || `料理${dishIndex + 1}`} 網址縮圖預覽`}
                              className="link-thumbnail"
                              loading="lazy"
                            />
                          </a>
                        ) : (
                          <div className="video-preview-fallback">
                            <p className="hint">
                              {isThumbnailLoading
                                ? '正在載入食譜縮圖…'
                                : '此連結不支援內嵌預覽，可直接點擊上方超連結查看。'}
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  <label>
                    料理圖片（最多 2 張）
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={Boolean(uploadingDishIds[dish.id]) || dish.images.length >= 2}
                      onChange={async (event) => {
                        await handleDishImageUpload(activeGroup, dish.id, event.target.files)
                        event.currentTarget.value = ''
                      }}
                    />
                    {dish.images.length >= 2 && <p className="field-error">已達 2 張上限，請先刪除再上傳</p>}
                  </label>
                  {uploadingDishIds[dish.id] && (
                    <div className="upload-progress-wrap">
                      <p className="hint">圖片上傳中… {uploadProgressByDish[dish.id] ?? 0}%</p>
                      <div className="upload-progress-track">
                        <div
                          className="upload-progress-bar"
                          style={{ width: `${uploadProgressByDish[dish.id] ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="dish-images">
                    {dish.images.length === 0 && <p className="empty">尚未上傳圖片</p>}
                    {dish.images.map((image, imageIndex) => (
                      <div key={`${dish.id}-${imageIndex}`} className="dish-image-item">
                        <img src={image.url} alt={`${dish.title || `料理${dishIndex + 1}`} 圖片 ${imageIndex + 1}`} />
                        <button
                          className="btn-danger"
                          onClick={() => removeDishImage(activeGroup, dish.id, imageIndex)}
                        >
                          刪除圖片
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="dish-steps">
                    {canEditActiveGroup ? (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => toggleDishStepEditor(activeGroup, dish.id)}
                        >
                          {isStepEditorOpen ? '收合料理步驟' : '填寫料理步驟'}
                        </button>
                        {isStepEditorOpen && (
                          <label className="steps-label">
                            料理步驟（每行一個步驟，無須編號）
                            <textarea
                              value={dish.steps}
                              onChange={(event) =>
                                updateDish(activeGroup, dish.id, 'steps', event.target.value)
                              }
                              placeholder={'例如：\n備好所有食材\n熱鍋下油爆香\n起鍋前調味'}
                              rows={6}
                            />
                          </label>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="hint">料理步驟（唯讀）</p>
                        <pre className="steps-readonly">{dish.steps.trim() || '（尚未填寫）'}</pre>
                      </>
                    )}
                  </div>
                    </article>

                    <div className="dish-ingredients section-gap">
                      <h3 className="subsection-title">
                        食材 <span className="count-badge">{dishIngredientRows.length}</span>
                      </h3>
                      <ItemQuickList
                        kind="ingredient"
                        items={dishIngredientRows.map((row) => ({
                          id: row.id,
                          name: row.ingredient,
                          qty: row.totalQty,
                          unit: row.totalUnit,
                          note: row.note,
                        }))}
                        library={ingredientSuggestions}
                        unitChips={INGREDIENT_UNIT_CHIPS}
                        suggestUnit={suggestIngredientUnit}
                        readOnly={!canEditActiveGroup}
                        onCreate={(drafts) => createIngredientRows(activeGroup, dish.id, drafts)}
                        onChange={(id, patch) => patchIngredientRow(activeGroup, id, patch)}
                        onRemove={(id) => removeRowWithUndo(activeGroup, 'ingredientRows', id)}
                        onNotice={(message) => showToast(message)}
                      />
                    </div>
                    </fieldset>
                  </div>
                </div>
              </section>
            )
          })}

          <div className="actions" style={{ marginBottom: '2rem', justifyContent: 'center' }}>
            <button className="btn-secondary" onClick={() => addDish(activeGroup)} disabled={!canEditActiveGroup}>
              ＋ 新增額外料理
            </button>
          </div>

          <section className="panel" id="group-tools">
            <div className="section-header">
              <h2>需要的工具（整組共用）</h2>
              <button
                type="button"
                className="btn-collapse"
                onClick={() => toggleToolsCollapse(activeGroup)}
                aria-expanded={!groupCollapseState[activeGroup].toolsCollapsed}
              >
                <span className="btn-collapse-label">
                  {groupCollapseState[activeGroup].toolsCollapsed ? '展開' : '摺疊'}
                </span>
                <span
                  className={`btn-collapse-icon ${groupCollapseState[activeGroup].toolsCollapsed ? 'is-collapsed' : ''}`}
                  aria-hidden="true"
                >
                  ▲
                </span>
              </button>
            </div>

            <div className={`collapse-content ${groupCollapseState[activeGroup].toolsCollapsed ? 'is-collapsed' : ''}`}>
              <div className="collapse-inner">
                <fieldset className="group-edit-fieldset" disabled={!canEditActiveGroup}>
                  <ItemQuickList
                    kind="tool"
                    items={activeToolRows.map((row) => ({
                      id: row.id,
                      name: row.tool,
                      qty: row.qty,
                      unit: row.unit,
                      note: row.note,
                    }))}
                    library={toolSuggestions}
                    unitChips={TOOL_UNIT_CHIPS}
                    suggestUnit={suggestToolUnit}
                    readOnly={!canEditActiveGroup}
                    onCreate={(drafts) => createToolRows(activeGroup, drafts)}
                    onChange={(id, patch) => patchToolRow(activeGroup, id, patch)}
                    onRemove={(id) => removeRowWithUndo(activeGroup, 'toolRows', id)}
                    onNotice={(message) => showToast(message)}
                  />
                </fieldset>
              </div>
            </div>
          </section>
        </>
      )}

      {currentTab === '食材總表' && adminUnlocked && (
        <>
          <section className="panel">
            <h2>食材總表</h2>
            <p className="hint">
              同名食材會自動合併，kg／台斤會換算成 g、公升會換算成 ml。調整量請用右邊的單位填寫（可填負數）。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>備料</th>
                    <th>食材</th>
                    <th>各組需求</th>
                    <th>合計</th>
                    <th>調整量</th>
                    <th>最終總量</th>
                    <th>單位</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {ingredientSummaryRows.map((row) => {
                    const key = row.key
                    const adjustment = toNumber(ingredientAdjustments[key] ?? '')
                    const finalTotal = row.sumQty + adjustment
                    const extras = [row.hasVague ? VAGUE_QTY : '', row.missingQtyCount > 0 ? `${row.missingQtyCount} 項未填數量` : '']
                      .filter(Boolean)
                      .join('、')

                    return (
                      <tr key={key}>
                        <td data-label="備料">
                          <input
                            type="checkbox"
                            className="prep-checkbox"
                            checked={Boolean(preparedSummaryIngredients[key])}
                            onChange={(event) =>
                              setPreparedSummaryIngredients((previous) => ({
                                ...previous,
                                [key]: event.target.checked,
                              }))
                            }
                            aria-label={`標記 ${row.ingredient} 是否已備料`}
                          />
                        </td>
                        <td data-label="食材">{row.ingredient}</td>
                        <td data-label="各組需求" className="summary-sources">{row.sources.join('、')}</td>
                        <td data-label="合計">
                          {formatNumber(row.sumQty)}
                          {extras && <span className="summary-extra">（另有{extras}）</span>}
                        </td>
                        <td data-label="調整量">
                          <input
                            value={ingredientAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setIngredientAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder="0"
                            inputMode="decimal"
                          />
                        </td>
                        <td data-label="最終總量">{formatNumber(finalTotal)}</td>
                        <td data-label="單位">{row.unit || '-'}</td>
                        <td data-label="備註">{row.note || '-'}</td>
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
          <section className="panel">
            <h2>工具總表</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>備妥</th>
                    <th>工具</th>
                    <th>各組需求</th>
                    <th>需求數量</th>
                    <th>調整量</th>
                    <th>最終數量</th>
                    <th>單位</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {toolSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {toolSummaryRows.map((row) => {
                    const key = row.key
                    const adjustment = toNumber(toolAdjustments[key] ?? '')
                    const finalTotal = row.sumQty + adjustment

                    return (
                      <tr key={key}>
                        <td data-label="備妥">
                          <input
                            type="checkbox"
                            className="prep-checkbox"
                            checked={Boolean(preparedSummaryTools[key])}
                            onChange={(event) =>
                              setPreparedSummaryTools((previous) => ({
                                ...previous,
                                [key]: event.target.checked,
                              }))
                            }
                            aria-label={`標記 ${row.tool} 是否已備妥`}
                          />
                        </td>
                        <td data-label="工具">{row.tool}</td>
                        <td data-label="各組需求" className="summary-sources">{row.sources.join('、')}</td>
                        <td data-label="需求數量">{formatNumber(row.sumQty)}</td>
                        <td data-label="調整量">
                          <input
                            value={toolAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setToolAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder="0"
                          />
                        </td>
                        <td data-label="最終數量">{formatNumber(finalTotal)}</td>
                        <td data-label="單位">{row.unit}</td>
                        <td data-label="備註">{row.note}</td>
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
        <section className="panel">
          <h2>工具庫（管理員）</h2>
          <p className="hint">新增後會提供給所有組別的工具欄位作為建議選項。</p>
          <div className="library-add-row">
            <input
              value={toolLibraryInput}
              onChange={(event) => setToolLibraryInput(event.target.value)}
              placeholder="輸入工具名稱，例如：量杯"
            />
            <button onClick={addLibraryTool}>加入工具庫</button>
          </div>
          {toolLibraryError && <p className="error">{toolLibraryError}</p>}
          <div className="table-wrap section-gap">
            <table>
              <thead>
                <tr>
                  <th>工具名稱</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {toolLibrary.length === 0 && (
                  <tr>
                    <td colSpan={2} className="empty">
                      目前工具庫沒有資料
                    </td>
                  </tr>
                )}
                {toolLibrary.map((name) => (
                  <tr key={name}>
                    <td data-label="工具名稱">{name}</td>
                    <td data-label="操作">
                      <button className="btn-danger" onClick={() => removeLibraryTool(name)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {currentTab === INGREDIENT_LIBRARY_TAB && adminUnlocked && (
        <section className="panel">
          <h2>食材庫（管理員）</h2>
          <p className="hint">新增後會提供給所有組別的食材欄位作為建議選項。</p>
          <div className="library-add-row">
            <input
              value={libraryInput}
              onChange={(event) => setLibraryInput(event.target.value)}
              placeholder="輸入食材名稱，例如：雞蛋"
            />
            <button onClick={addLibraryIngredient}>加入食材庫</button>
          </div>
          {libraryError && <p className="error">{libraryError}</p>}
          <div className="table-wrap section-gap">
            <table>
              <thead>
                <tr>
                  <th>食材名稱</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ingredientLibrary.length === 0 && (
                  <tr>
                    <td colSpan={2} className="empty">
                      目前食材庫沒有資料
                    </td>
                  </tr>
                )}
                {ingredientLibrary.map((name) => (
                  <tr key={name}>
                    <td data-label="食材名稱">{name}</td>
                    <td data-label="操作">
                      <button className="btn-danger" onClick={() => removeLibraryIngredient(name)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {currentTab === GROUP_INGREDIENT_LIBRARY_TAB && adminUnlocked && (
        <section className="panel">
          <h2>各組食材表（管理員）</h2>
          <p className="hint">此頁顯示各組明細，不進行跨組食材合併。</p>
          {ingredientLibraryByGroup.map(({ groupName, rows }) => (
            <article key={groupName} className="panel section-gap">
              <div className="section-header">
                <h3>{groupName}</h3>
                <button
                  type="button"
                  className="btn-collapse"
                  onClick={() => toggleGroupIngredientTableCollapse(groupName)}
                  aria-expanded={!groupCollapseState[groupName].groupIngredientTableCollapsed}
                >
                  <span className="btn-collapse-label">
                    {groupCollapseState[groupName].groupIngredientTableCollapsed ? '展開' : '摺疊'}
                  </span>
                  <span
                    className={`btn-collapse-icon ${groupCollapseState[groupName].groupIngredientTableCollapsed ? 'is-collapsed' : ''}`}
                    aria-hidden="true"
                  >
                    ▲
                  </span>
                </button>
              </div>

              <div
                className={`collapse-content ${groupCollapseState[groupName].groupIngredientTableCollapsed ? 'is-collapsed' : ''}`}
              >
                <div className="collapse-inner table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>備料</th>
                        <th>料理</th>
                        <th>食材</th>
                        <th>數量</th>
                        <th>單位</th>
                        <th>備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="empty">
                            此組目前尚未填寫食材
                          </td>
                        </tr>
                      )}
                      {rows.map((row) => {
                        const preparedKey = `${groupName}-${row.id}`

                        return (
                          <tr key={row.id}>
                            <td data-label="備料">
                              <input
                                type="checkbox"
                                className="prep-checkbox"
                                checked={Boolean(preparedGroupIngredients[preparedKey])}
                                onChange={(event) =>
                                  setPreparedGroupIngredients((previous) => ({
                                    ...previous,
                                    [preparedKey]: event.target.checked,
                                  }))
                                }
                                aria-label={`標記 ${groupName} ${row.ingredient} 是否已備料`}
                              />
                            </td>
                            <td data-label="料理">{row.dishName}</td>
                            <td data-label="食材">{row.ingredient}</td>
                            <td data-label="數量">{row.totalQty || '-'}</td>
                            <td data-label="單位">{row.totalUnit || '-'}</td>
                            <td data-label="備註">{row.note || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {currentTab === GROUP_TOOL_LIBRARY_TAB && adminUnlocked && (
        <section className="panel">
          <h2>各組工具表（管理員）</h2>
          <p className="hint">此頁顯示各組工具明細，不進行跨組工具合併。</p>
          {toolLibraryByGroup.map(({ groupName, rows }) => (
            <article key={groupName} className="panel section-gap">
              <div className="section-header">
                <h3>{groupName}</h3>
                <button
                  type="button"
                  className="btn-collapse"
                  onClick={() => toggleGroupToolTableCollapse(groupName)}
                  aria-expanded={!groupCollapseState[groupName].groupToolTableCollapsed}
                >
                  <span className="btn-collapse-label">
                    {groupCollapseState[groupName].groupToolTableCollapsed ? '展開' : '摺疊'}
                  </span>
                  <span
                    className={`btn-collapse-icon ${groupCollapseState[groupName].groupToolTableCollapsed ? 'is-collapsed' : ''}`}
                    aria-hidden="true"
                  >
                    ▲
                  </span>
                </button>
              </div>

              <div
                className={`collapse-content ${groupCollapseState[groupName].groupToolTableCollapsed ? 'is-collapsed' : ''}`}
              >
                <div className="collapse-inner table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>備妥</th>
                        <th>工具</th>
                        <th>需求數量</th>
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
                        const preparedKey = `${groupName}-tool-${row.id}`

                        return (
                          <tr key={row.id}>
                            <td data-label="備妥">
                              <input
                                type="checkbox"
                                className="prep-checkbox"
                                checked={Boolean(preparedGroupTools[preparedKey])}
                                onChange={(event) =>
                                  setPreparedGroupTools((previous) => ({
                                    ...previous,
                                    [preparedKey]: event.target.checked,
                                  }))
                                }
                                aria-label={`標記 ${groupName} ${row.tool} 是否已備妥`}
                              />
                            </td>
                            <td data-label="工具">{row.tool}</td>
                            <td data-label="需求數量">{row.qty || '-'}</td>
                            <td data-label="單位">{row.unit || '-'}</td>
                            <td data-label="備註">{row.note || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {currentTab === SHOPPING_LIST_TAB && adminUnlocked && (
        <ShoppingBoard
          needs={shoppingNeeds}
          stores={shoppingStores}
          setStores={setShoppingStores}
          onNotice={showToast}
          createId={createId}
        />
      )}

      {currentTab === CHANGELOG_TAB && (
        <section className="panel">
          <h2>版本日誌</h2>
          <div className="changelog-list">
            {CHANGELOG_ENTRIES.map((entry) => (
              <article key={entry.version} className="changelog-item">
                <h3>{entry.version}</h3>
                <p className="hint">更新日期：{entry.date}</p>
                <ul>
                  {entry.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.undo?.()
                setToast(null)
              }}
            >
              復原
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="關閉通知">
            ✕
          </button>
        </div>
      )}
    </main>
  )
}

export default App
