// Daily price update. Runs every morning via Vercel Cron (see vercel.json) and can also be started
// from the 價格參考 page. Results go to their own document (projects/<id>--prices), so it never
// competes with people editing the main project document.
import {
  PRODUCE_API,
  aggregateProduce,
  fromFirestoreValue,
  hasTradingData,
  isProductUrl,
  parseProductPrice,
  rocToIso,
  toFirestoreValue,
  toRocDate,
  type ProduceRow,
} from './_price-sources.js'

type VercelRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  setHeader: (name: string, value: string) => void
  json: (payload: unknown) => void
}

export const config = { maxDuration: 60 }

const MANUAL_COOLDOWN_MS = 10 * 60 * 1000
const MAX_PRODUCT_PAGES = 80
const USER_AGENT = 'foodsheets-price-update/1.0 (daily, low volume)'

const env = (...names: string[]) => names.map((name) => process.env[name]).find((value) => value && value.trim())

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 12000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Taiwan date, walking back up to a week to the latest day the markets traded.
const fetchLatestProduce = async (): Promise<{ date: string; rows: ProduceRow[] } | null> => {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  for (let daysBack = 0; daysBack < 7; daysBack += 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack))
    const roc = toRocDate(new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
    const url = `${PRODUCE_API}?$top=10000&StartDate=${roc}&EndDate=${roc}`
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 20000)
    if (!response.ok) {
      continue
    }
    const rows = (await response.json()) as ProduceRow[]
    if (Array.isArray(rows) && hasTradingData(rows)) {
      return { date: rocToIso(roc), rows }
    }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const projectId = env('FIREBASE_PROJECT_ID', 'VITE_FIREBASE_PROJECT_ID')
  const apiKey = env('FIREBASE_API_KEY', 'VITE_FIREBASE_API_KEY')
  const docId = env('VITE_FIREBASE_PROJECT_DOC_ID') ?? 'default'
  if (!projectId || !apiKey) {
    res.status(500).json({ error: 'Firebase is not configured on the server' })
    return
  }

  const cronSecret = env('CRON_SECRET')
  const isCron = Boolean(cronSecret) && req.headers.authorization === `Bearer ${cronSecret}`
  const documents = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/projects`
  const pricesUrl = `${documents}/${encodeURIComponent(`${docId}--prices`)}?key=${apiKey}`

  try {
    const previous = await fetchWithTimeout(pricesUrl)
    if (previous.ok && !isCron) {
      const fields = ((await previous.json()) as { fields?: Record<string, Record<string, unknown>> }).fields ?? {}
      const lastRun = Date.parse(String(fromFirestoreValue(fields.updatedAt) ?? ''))
      if (Number.isFinite(lastRun) && Date.now() - lastRun < MANUAL_COOLDOWN_MS) {
        res.status(429).json({ error: '剛剛已更新過，請 10 分鐘後再試。', updatedAt: new Date(lastRun).toISOString() })
        return
      }
    }

    // Which price entries an admin linked to a shop's product page.
    const projectResponse = await fetchWithTimeout(`${documents}/${encodeURIComponent(docId)}?key=${apiKey}`)
    const projectFields = projectResponse.ok
      ? (((await projectResponse.json()) as { fields?: Record<string, Record<string, unknown>> }).fields ?? {})
      : {}
    const priceBook = (fromFirestoreValue(projectFields.priceBook) as Array<Record<string, unknown>> | undefined) ?? []
    const linked = priceBook
      .filter((entry) => typeof entry.sourceUrl === 'string' && isProductUrl(entry.sourceUrl))
      .slice(0, MAX_PRODUCT_PAGES)

    const errors: string[] = []
    const fetchedAt = new Date().toISOString()

    const produce = await fetchLatestProduce().catch(() => null)
    if (!produce) {
      errors.push('農產品行情：近 7 天沒有可用的交易資料')
    }

    const products: Record<string, { price: number; name: string; inStock: boolean; fetchedAt: string; url: string }> = {}
    // Each product page is fetched once even when several entries link to it (牛奶 and 鮮奶). A few
    // pages at a time keeps this polite and well within the time limit.
    const entriesByUrl = new Map<string, typeof linked>()
    linked.forEach((entry) => {
      const url = String(entry.sourceUrl)
      entriesByUrl.set(url, [...(entriesByUrl.get(url) ?? []), entry])
    })
    const urls = Array.from(entriesByUrl.keys())
    for (let index = 0; index < urls.length; index += 4) {
      await Promise.all(
        urls.slice(index, index + 4).map(async (url) => {
          const entries = entriesByUrl.get(url) ?? []
          const label = `${String(entries[0].store)}：${entries.map((entry) => String(entry.ingredient)).join('、')}`
          try {
            const page = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
            const parsed = page.ok ? parseProductPrice(await page.text()) : null
            if (parsed) {
              entries.forEach((entry) => {
                products[String(entry.id)] = { ...parsed, fetchedAt, url }
              })
            } else {
              errors.push(`${label} 讀不到價格（${page.status}）`)
            }
          } catch {
            errors.push(`${label} 連線逾時`)
          }
        }),
      )
    }

    const payload = {
      updatedAt: fetchedAt,
      trigger: isCron ? 'schedule' : 'manual',
      produceDate: produce?.date ?? '',
      produce: produce ? aggregateProduce(produce.rows) : [],
      products,
      errors,
    }

    const write = await fetchWithTimeout(pricesUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, toFirestoreValue(value)])) }),
    })
    if (!write.ok) {
      res.status(502).json({ error: `寫入資料庫失敗（${write.status}），請確認 Firestore 規則允許寫入 projects/${docId}--prices。` })
      return
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      updatedAt: fetchedAt,
      produceDate: payload.produceDate,
      produceCount: payload.produce.length,
      productCount: Object.keys(products).length,
      linkedCount: linked.length,
      errors,
    })
  } catch {
    res.status(500).json({ error: '價格更新失敗，請稍後再試。' })
  }
}
