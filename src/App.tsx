import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import {
  db,
  firebaseProjectDocId,
  isFirebaseConfigured,
  missingFirebaseEnvKeys,
} from './firebase'

const GROUP_TABS = ['第一組', '第二組', '第三組', '第四組', '第五組', '第六組', '學長姐組'] as const
const SUMMARY_TABS = ['食材總表', '工具總表'] as const
const SUMMARY_EDIT_PASSCODE = 'foodsheets-admin'
const STORAGE_KEY = 'foodsheets.v1.state'
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const isCloudinaryConfigured = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET)

type GroupTab = (typeof GROUP_TABS)[number]
type TabName = GroupTab | (typeof SUMMARY_TABS)[number]

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

type Dish = {
  id: number
  title: string
  videoUrl: string
  images: DishImage[]
}

type PersistedState = {
  currentTab: TabName
  groupData: Record<GroupTab, GroupData>
  ingredientAdjustments: Record<string, string>
  toolAdjustments: Record<string, string>
}

const isValidTab = (value: unknown): value is TabName => {
  if (typeof value !== 'string') {
    return false
  }

  return [...GROUP_TABS, ...SUMMARY_TABS].includes(value as TabName)
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
})

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

const createInitialGroupData = (): Record<GroupTab, GroupData> => {
  return GROUP_TABS.reduce(
    (acc, groupName, index) => {
      const offset = (index + 1) * 1000
      const dishes = [emptyDish(offset + 201), emptyDish(offset + 202), emptyDish(offset + 203)]
      acc[groupName] = {
        teamName: '',
        cuisineType: '',
        dishes,
        ingredientRows: [
          emptyIngredientRow(offset + 1, dishes[0].id),
          emptyIngredientRow(offset + 2, dishes[1].id),
          emptyIngredientRow(offset + 3, dishes[2].id),
        ],
        toolRows: [emptyToolRow(offset + 101), emptyToolRow(offset + 102)],
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

    const normalizedDishes = Array.isArray(sourceObj.dishes)
      ? sourceObj.dishes.slice(0, 3).map((dish, dishIndex) => {
          const dishObj = (dish ?? {}) as Record<string, unknown>
          return {
            id: Number(dishObj.id) || groupOffset + 201 + dishIndex,
            title: typeof dishObj.title === 'string' ? dishObj.title : '',
            videoUrl: typeof dishObj.videoUrl === 'string' ? dishObj.videoUrl : '',
            images: Array.isArray(dishObj.images)
              ? uniqueDishImages(dishObj.images.map(normalizeDishImage).filter((value): value is DishImage => Boolean(value))).slice(0, 2)
              : [],
          }
        })
      : []

    while (normalizedDishes.length < 3) {
      normalizedDishes.push(emptyDish(groupOffset + 201 + normalizedDishes.length))
    }

    const normalizedIngredientRows = Array.isArray(sourceObj.ingredientRows)
      ? sourceObj.ingredientRows.map((row, rowIndex) => {
          const rowObj = (row ?? {}) as Record<string, unknown>
          const fallbackDishId = normalizedDishes[rowIndex % 3]?.id ?? normalizedDishes[0].id
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
      ingredientRows:
        normalizedIngredientRows.length > 0 ? normalizedIngredientRows : base[groupName].ingredientRows,
      toolRows: normalizedToolRows.length > 0 ? normalizedToolRows : base[groupName].toolRows,
    }
  })

  return base
}

const mergeRemoteWithLocalImages = (
  remote: Record<GroupTab, GroupData>,
  local: Record<GroupTab, GroupData>,
): Record<GroupTab, GroupData> => {
  const merged = { ...remote }

  GROUP_TABS.forEach((groupName) => {
    merged[groupName] = {
      ...remote[groupName],
      dishes: remote[groupName].dishes.map((remoteDish) => {
        const localDish = local[groupName]?.dishes.find((dish) => dish.id === remoteDish.id)

        if (remoteDish.images.length > 0) {
          const localImagesByUrl = new Map((localDish?.images ?? []).map((image) => [image.url, image]))
          const mergedImages = remoteDish.images.map((image) => {
            const localImage = localImagesByUrl.get(image.url)
            return {
              ...image,
              publicId: localImage?.publicId ?? image.publicId,
            }
          })

          return {
            ...remoteDish,
            images: uniqueDishImages(mergedImages).slice(0, 2),
          }
        }

        return {
          ...remoteDish,
          images: uniqueDishImages(localDish?.images ?? []).slice(0, 2),
        }
      }),
    }
  })

  return merged
}

const stripImagesForCloud = (data: Record<GroupTab, GroupData>): Record<GroupTab, GroupData> => {
  const stripped = { ...data }

  GROUP_TABS.forEach((groupName) => {
    stripped[groupName] = {
      ...data[groupName],
      dishes: data[groupName].dishes.map((dish) => ({
        ...dish,
        images: uniqueDishImages(dish.images)
          .filter((image) => image.url.startsWith('https://') || image.url.startsWith('http://'))
          .map((image) => ({ url: image.url, publicId: image.publicId }))
          .slice(0, 2),
      })),
    }
  })

  return stripped
}

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

const deleteCloudinaryByPublicId = async (publicId: string): Promise<boolean> => {
  if (!publicId) {
    return false
  }

  const response = await fetch('/api/cloudinary-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publicId }),
  })

  return response.ok
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
      : '第一組'

    return {
      currentTab: validTab,
      groupData: normalizeGroupData(parsed.groupData),
      ingredientAdjustments: parsed.ingredientAdjustments ?? {},
      toolAdjustments: parsed.toolAdjustments ?? {},
    }
  } catch {
    return null
  }
}

function App() {
  const persistedState = useMemo(loadPersistedState, [])
  const [currentTab, setCurrentTab] = useState<TabName>(persistedState?.currentTab ?? '第一組')
  const [groupData, setGroupData] = useState<Record<GroupTab, GroupData>>(
    persistedState?.groupData ?? createInitialGroupData,
  )
  const [summaryUnlocked, setSummaryUnlocked] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [passcodeError, setPasscodeError] = useState('')
  const [ingredientAdjustments, setIngredientAdjustments] = useState<Record<string, string>>(
    persistedState?.ingredientAdjustments ?? {},
  )
  const [toolAdjustments, setToolAdjustments] = useState<Record<string, string>>(
    persistedState?.toolAdjustments ?? {},
  )
  const [uploadingDishIds, setUploadingDishIds] = useState<Record<number, boolean>>({})
  const [uploadProgressByDish, setUploadProgressByDish] = useState<Record<number, number>>({})
  const [imageUploadError, setImageUploadError] = useState('')
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured
      ? 'Firebase 已設定，雲端同步初始化中…'
      : `尚未設定 Firebase，目前僅本機保存（缺少：${missingFirebaseEnvKeys.join(', ')}）`,
  )

  const applyingRemoteRef = useRef(false)
  const remoteLoadedRef = useRef(false)

  const activeGroup: GroupTab = GROUP_TABS.includes(currentTab as GroupTab)
    ? (currentTab as GroupTab)
    : '第一組'

  const activeIngredientRows = groupData[activeGroup].ingredientRows
  const activeToolRows = groupData[activeGroup].toolRows
  const activeDishes = groupData[activeGroup].dishes

  const allIngredientRows = useMemo(
    () => GROUP_TABS.flatMap((groupName) => groupData[groupName].ingredientRows),
    [groupData],
  )

  const allToolRows = useMemo(
    () => GROUP_TABS.flatMap((groupName) => groupData[groupName].toolRows),
    [groupData],
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

  const removeIngredientRow = (groupName: GroupTab, id: number, dishId: number) => {
    setGroupData((previous) => {
      const nextRows = previous[groupName].ingredientRows.filter((row) => row.id !== id)
      const hasDishRow = nextRows.some((row) => row.dishId === dishId)

      return {
        ...previous,
        [groupName]: {
          ...previous[groupName],
          ingredientRows:
            nextRows.length > 0
              ? hasDishRow
                ? nextRows
                : [...nextRows, emptyIngredientRow(Date.now(), dishId)]
              : [emptyIngredientRow(Date.now(), dishId)],
        },
      }
    })
  }

  const removeToolRow = (groupName: GroupTab, id: number) => {
    setGroupData((previous) => {
      const nextRows = previous[groupName].toolRows.filter((row) => row.id !== id)
      return {
        ...previous,
        [groupName]: {
          ...previous[groupName],
          toolRows: nextRows.length > 0 ? nextRows : [emptyToolRow(Date.now())],
        },
      }
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

  const updateDish = (groupName: GroupTab, dishId: number, field: 'title' | 'videoUrl', value: string) => {
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
      const deleted = await deleteCloudinaryByPublicId(publicId)
      if (!deleted) {
        setImageUploadError('圖片已從表單移除，但 Cloudinary 同步刪除失敗（請確認已部署 API 與伺服器端金鑰）。')
      }
    } catch {
      setImageUploadError('圖片已從表單移除，但 Cloudinary 同步刪除失敗（請確認已部署 API 與伺服器端金鑰）。')
    }
  }

  const unlockSummaryEdit = () => {
    if (passcode !== SUMMARY_EDIT_PASSCODE) {
      setPasscodeError('權限碼錯誤，無法編輯總表。')
      return
    }

    setPasscodeError('')
    setSummaryUnlocked(true)
    setPasscode('')
  }

  const lockSummaryEdit = () => {
    setSummaryUnlocked(false)
    setPasscode('')
    setPasscodeError('')
  }

  const renderSummaryGuard = () => (
    <section className="panel">
      <div className="lock-row">
        <p className="hint lock-text">總表預設唯讀，避免誤改。需管理權限才可輸入「調整量」。</p>
        {summaryUnlocked ? (
          <button className="btn-danger" onClick={lockSummaryEdit}>
            鎖定總表編輯
          </button>
        ) : (
          <div className="lock-form">
            <input
              type="password"
              placeholder="輸入權限碼"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
            />
            <button onClick={unlockSummaryEdit}>授權編輯</button>
          </div>
        )}
      </div>
      {passcodeError && <p className="error">{passcodeError}</p>}
    </section>
  )

  useEffect(() => {
    const payload: PersistedState = {
      currentTab,
      groupData,
      ingredientAdjustments,
      toolAdjustments,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [currentTab, groupData, ingredientAdjustments, toolAdjustments])

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const unsubscribe = onSnapshot(
      projectRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          remoteLoadedRef.current = true
          setSyncStatus('已連線雲端：首次資料將由目前內容建立')
          return
        }

        const data = snapshot.data() as Partial<PersistedState>
        if (!data.groupData || !data.currentTab) {
          remoteLoadedRef.current = true
          setSyncStatus('已連線雲端：資料格式不完整，保留本機內容')
          return
        }

        applyingRemoteRef.current = true
        setCurrentTab(isValidTab(data.currentTab) ? data.currentTab : '第一組')
        setGroupData((previous) =>
          mergeRemoteWithLocalImages(normalizeGroupData(data.groupData), previous),
        )
        setIngredientAdjustments(data.ingredientAdjustments ?? {})
        setToolAdjustments(data.toolAdjustments ?? {})
        remoteLoadedRef.current = true
        setSyncStatus('已連線雲端：即時同步中')
        setTimeout(() => {
          applyingRemoteRef.current = false
        }, 0)
      },
      () => {
        setSyncStatus('雲端同步失敗，已切換為本機模式')
      },
    )

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !db || !remoteLoadedRef.current || applyingRemoteRef.current) {
      return
    }

    const payload: PersistedState = {
      currentTab,
      groupData: stripImagesForCloud(groupData),
      ingredientAdjustments,
      toolAdjustments,
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const timer = window.setTimeout(() => {
      setDoc(projectRef, payload, { merge: true }).catch(() => {
        setSyncStatus('雲端寫入失敗，資料仍保留在本機')
      })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [currentTab, groupData, ingredientAdjustments, toolAdjustments])

  return (
    <main className="page">
      <h1>料理採購管理</h1>
      <p className="hint">{syncStatus}</p>
      {imageUploadError && <p className="error">{imageUploadError}</p>}

      <section className="tabs panel">
        {[...GROUP_TABS, ...SUMMARY_TABS].map((tabName) => (
          <button
            key={tabName}
            className={currentTab === tabName ? 'tab-active' : ''}
            onClick={() => setCurrentTab(tabName)}
          >
            {tabName}
          </button>
        ))}
      </section>

      {GROUP_TABS.includes(currentTab as GroupTab) && (
        <>
          <p className="hint">{activeGroup}：有填食材時，總量必填；有填工具時，數量必填。</p>

          <section className="panel">
            <h2>{activeGroup}</h2>
            <div className="meta-grid">
              <label>
                廚神（自行填寫名字）
                <input
                  value={groupData[activeGroup].teamName}
                  onChange={(event) => updateGroupMeta(activeGroup, 'teamName', event.target.value)}
                  placeholder="例如：廚神隊 / 成員名稱"
                  className={!groupData[activeGroup].teamName.trim() ? 'input-error' : ''}
                />
                {!groupData[activeGroup].teamName.trim() && <p className="field-error">此欄位為必填</p>}
              </label>
              <label>
                料理種類（自行填入）
                <input
                  value={groupData[activeGroup].cuisineType}
                  onChange={(event) => updateGroupMeta(activeGroup, 'cuisineType', event.target.value)}
                  placeholder="例如：韓式 / 義式 / 台式"
                  className={!groupData[activeGroup].cuisineType.trim() ? 'input-error' : ''}
                />
                {!groupData[activeGroup].cuisineType.trim() && <p className="field-error">此欄位為必填</p>}
              </label>
            </div>
          </section>

          {activeDishes.map((dish, dishIndex) => {
            const dishIngredientRows = activeIngredientRows.filter((row) => row.dishId === dish.id)

            return (
              <section key={`input-${dish.id}`} className="panel">
                <h2>{`料理${dishIndex + 1}`}</h2>

                <article className="dish-card">
                  <label>
                    料理名稱
                    <input
                      value={dish.title}
                      onChange={(event) => updateDish(activeGroup, dish.id, 'title', event.target.value)}
                      placeholder="請輸入料理名稱"
                      className={!dish.title.trim() ? 'input-error' : ''}
                    />
                    {!dish.title.trim() && <p className="field-error">料理名稱必填</p>}
                  </label>
                  <label>
                    製作影片網址
                    <input
                      value={dish.videoUrl}
                      onChange={(event) => updateDish(activeGroup, dish.id, 'videoUrl', event.target.value)}
                      placeholder="貼上 YouTube 或其他料理網址"
                      className={!dish.videoUrl.trim() ? 'input-error' : ''}
                    />
                    {!dish.videoUrl.trim() && <p className="field-error">影片網址必填</p>}
                  </label>
                  <label>
                    料理圖片（最多 2 張）
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={Boolean(uploadingDishIds[dish.id])}
                      onChange={async (event) => {
                        await handleDishImageUpload(activeGroup, dish.id, event.target.files)
                        event.currentTarget.value = ''
                      }}
                    />
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
                </article>

                <div className="table-wrap section-gap">
                  <table>
                    <thead>
                      <tr>
                        <th>食材</th>
                        <th>一份數量</th>
                        <th>單位</th>
                        <th>總量*</th>
                        <th>總量單位</th>
                        <th>備註</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dishIngredientRows.map((row) => (
                        <tr key={row.id} className={invalidIngredientRowIds.has(row.id) ? 'row-invalid' : ''}>
                          <td>
                            <input
                              value={row.ingredient}
                              onChange={(event) =>
                                updateIngredientRow(activeGroup, row.id, 'ingredient', event.target.value)
                              }
                              placeholder="例如：辣椒粉"
                            />
                          </td>
                          <td>
                            <input
                              value={row.perServingQty}
                              onChange={(event) =>
                                updateIngredientRow(activeGroup, row.id, 'perServingQty', event.target.value)
                              }
                              placeholder="例如：10"
                            />
                          </td>
                          <td>
                            <input
                              value={row.perServingUnit}
                              onChange={(event) =>
                                updateIngredientRow(activeGroup, row.id, 'perServingUnit', event.target.value)
                              }
                              placeholder="例如：g"
                            />
                          </td>
                          <td>
                            <input
                              value={row.totalQty}
                              onChange={(event) =>
                                updateIngredientRow(activeGroup, row.id, 'totalQty', event.target.value)
                              }
                              placeholder="必填（有食材時）"
                              className={invalidIngredientRowIds.has(row.id) ? 'input-error' : ''}
                            />
                            {invalidIngredientRowIds.has(row.id) && <p className="field-error">缺少總量</p>}
                          </td>
                          <td>
                            <input
                              value={row.totalUnit}
                              onChange={(event) =>
                                updateIngredientRow(activeGroup, row.id, 'totalUnit', event.target.value)
                              }
                              placeholder="例如：包"
                            />
                          </td>
                          <td>
                            <input
                              value={row.note}
                              onChange={(event) =>
                                updateIngredientRow(activeGroup, row.id, 'note', event.target.value)
                              }
                              placeholder="例如：共用材料"
                            />
                          </td>
                          <td>
                            <button
                              className="btn-danger"
                              onClick={() => removeIngredientRow(activeGroup, row.id, dish.id)}
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="actions">
                  <button onClick={() => addIngredientRow(activeGroup, dish.id)}>新增食材列</button>
                </div>
              </section>
            )
          })}

          <section className="panel">
            <h2>工具欄位（不分料理）</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>工具</th>
                    <th>數量*</th>
                    <th>單位</th>
                    <th>備註</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeToolRows.map((row) => (
                    <tr key={row.id} className={invalidToolRowIds.has(row.id) ? 'row-invalid' : ''}>
                      <td>
                        <input
                          value={row.tool}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'tool', event.target.value)}
                          placeholder="例如：炒鍋"
                        />
                      </td>
                      <td>
                        <input
                          value={row.qty}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'qty', event.target.value)}
                          placeholder="有填工具時必填"
                          className={invalidToolRowIds.has(row.id) ? 'input-error' : ''}
                        />
                        {invalidToolRowIds.has(row.id) && <p className="field-error">缺少數量</p>}
                      </td>
                      <td>
                        <input
                          value={row.unit}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'unit', event.target.value)}
                          placeholder="例如：個"
                        />
                      </td>
                      <td>
                        <input
                          value={row.note}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'note', event.target.value)}
                          placeholder="例如：共用"
                        />
                      </td>
                      <td>
                        <button className="btn-danger" onClick={() => removeToolRow(activeGroup, row.id)}>
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button onClick={() => addToolRow(activeGroup)}>新增工具列</button>
            </div>
          </section>

          {invalidIngredientRowIds.size > 0 && (
            <p className="error">目前有 {invalidIngredientRowIds.size} 列未填總量，未被納入食材總表。</p>
          )}
          {invalidToolRowIds.size > 0 && (
            <p className="error">目前有 {invalidToolRowIds.size} 列未填工具數量，未被納入工具總表。</p>
          )}
        </>
      )}

      {currentTab === '食材總表' && (
        <>
          {renderSummaryGuard()}
          <section className="panel">
            <h2>食材總表</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>食材</th>
                    <th>一份數量總和</th>
                    <th>單位</th>
                    <th>總量總和</th>
                    <th>調整量</th>
                    <th>最終總量</th>
                    <th>總量單位</th>
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
                    const key = `${row.ingredient}-${row.perServingUnit}-${row.totalUnit}-${row.note}`
                    const adjustment = toNumber(ingredientAdjustments[key] ?? '')
                    const finalTotal = row.sumTotalQty + adjustment

                    return (
                      <tr key={key}>
                        <td>{row.ingredient}</td>
                        <td>{formatNumber(row.sumPerServingQty)}</td>
                        <td>{row.perServingUnit}</td>
                        <td>{formatNumber(row.sumTotalQty)}</td>
                        <td>
                          <input
                            value={ingredientAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setIngredientAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            disabled={!summaryUnlocked}
                            placeholder="0"
                          />
                        </td>
                        <td>{formatNumber(finalTotal)}</td>
                        <td>{row.totalUnit}</td>
                        <td>{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {currentTab === '工具總表' && (
        <>
          {renderSummaryGuard()}
          <section className="panel">
            <h2>工具總表</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>工具</th>
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
                      <td colSpan={6} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {toolSummaryRows.map((row) => {
                    const key = `${row.tool}-${row.unit}-${row.note}`
                    const adjustment = toNumber(toolAdjustments[key] ?? '')
                    const finalTotal = row.sumQty + adjustment

                    return (
                      <tr key={key}>
                        <td>{row.tool}</td>
                        <td>{formatNumber(row.sumQty)}</td>
                        <td>
                          <input
                            value={toolAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setToolAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            disabled={!summaryUnlocked}
                            placeholder="0"
                          />
                        </td>
                        <td>{formatNumber(finalTotal)}</td>
                        <td>{row.unit}</td>
                        <td>{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

export default App
