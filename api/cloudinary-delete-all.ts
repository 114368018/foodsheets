import crypto from 'node:crypto'

type VercelRequest = {
  method?: string
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (payload: unknown) => void
}

type CloudinaryResourceListResponse = {
  resources?: Array<{ public_id?: string }>
  next_cursor?: string
  error?: { message?: string }
}

type CloudinaryDeleteResponse = {
  deleted?: Record<string, string>
  partial?: boolean
  error?: { message?: string }
}

const getBodyPayload = (
  body: unknown,
): { prefix: string; publicIds: string[]; excludePublicIds: string[] } => {
  if (!body || typeof body !== 'object') {
    return { prefix: '', publicIds: [], excludePublicIds: [] }
  }

  const bodyObj = body as { prefix?: unknown; publicIds?: unknown; excludePublicIds?: unknown }
  const prefix = typeof bodyObj.prefix === 'string' ? bodyObj.prefix.trim() : ''
  const rawPublicIds = Array.isArray(bodyObj.publicIds) ? bodyObj.publicIds : []
  const rawExcludePublicIds = Array.isArray(bodyObj.excludePublicIds) ? bodyObj.excludePublicIds : []

  const publicIds = rawPublicIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)

  const excludePublicIds = rawExcludePublicIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)

  return { prefix, publicIds, excludePublicIds }
}

const createCloudinarySignature = (params: Record<string, string>, apiSecret: string): string => {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  return crypto.createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex')
}

const destroySingleResource = async (
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  publicId: string,
): Promise<{ ok: boolean; message?: string }> => {
  const timestamp = Math.floor(Date.now() / 1000)
  const paramsToSign = {
    invalidate: 'true',
    public_id: publicId,
    timestamp: String(timestamp),
  }

  const signature = createCloudinarySignature(paramsToSign, apiSecret)
  const formData = new URLSearchParams()
  formData.set('public_id', publicId)
  formData.set('timestamp', String(timestamp))
  formData.set('api_key', apiKey)
  formData.set('signature', signature)
  formData.set('invalidate', 'true')

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  })

  const payload = (await response.json()) as { result?: string; error?: { message?: string } }

  if (!response.ok) {
    return { ok: false, message: payload.error?.message ?? `HTTP ${response.status}` }
  }

  if (payload.result !== 'ok' && payload.result !== 'not found') {
    return { ok: false, message: `Unexpected destroy result: ${payload.result ?? 'unknown'}` }
  }

  return { ok: true }
}

const listResourcesByPrefix = async (
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  prefix: string,
): Promise<{ ok: boolean; publicIds: string[]; message?: string }> => {
  if (!prefix) {
    return { ok: true, publicIds: [] }
  }

  const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
  const collected = new Set<string>()
  let nextCursor = ''

  while (true) {
    const url = new URL(`https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`)
    url.searchParams.set('prefix', prefix)
    url.searchParams.set('max_results', '500')
    if (nextCursor) {
      url.searchParams.set('next_cursor', nextCursor)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    })

    const payload = (await response.json()) as CloudinaryResourceListResponse
    if (!response.ok) {
      return {
        ok: false,
        publicIds: [],
        message: payload.error?.message ?? `Cloudinary list failed: HTTP ${response.status}`,
      }
    }

    ;(payload.resources ?? []).forEach((resource) => {
      if (typeof resource.public_id === 'string' && resource.public_id.trim()) {
        collected.add(resource.public_id.trim())
      }
    })

    if (!payload.next_cursor) {
      break
    }

    nextCursor = payload.next_cursor
  }

  return { ok: true, publicIds: Array.from(collected) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    res.status(500).json({ error: 'Missing Cloudinary server environment variables' })
    return
  }

  const {
    prefix,
    publicIds: explicitPublicIds,
    excludePublicIds,
  } = getBodyPayload(req.body)
  const listedResult = await listResourcesByPrefix(cloudName, apiKey, apiSecret, prefix)
  if (!listedResult.ok) {
    res.status(502).json({ error: listedResult.message ?? 'Failed to list Cloudinary resources' })
    return
  }

  const excluded = new Set(excludePublicIds)
  const allPublicIds = Array.from(new Set([...explicitPublicIds, ...listedResult.publicIds])).filter(
    (publicId) => !excluded.has(publicId),
  )
  if (allPublicIds.length === 0) {
    res.status(200).json({ deletedCount: 0, failedCount: 0 })
    return
  }

  const failed: Array<{ publicId: string; reason: string }> = []
  let deletedCount = 0

  for (const publicId of allPublicIds) {
    try {
      const result = await destroySingleResource(cloudName, apiKey, apiSecret, publicId)
      if (result.ok) {
        deletedCount += 1
      } else {
        failed.push({ publicId, reason: result.message ?? 'destroy failed' })
      }
    } catch {
      failed.push({ publicId, reason: 'destroy call failed' })
    }
  }

  if (failed.length > 0) {
    res.status(502).json({
      error: 'Cloudinary delete-all partially failed',
      deletedCount,
      failedCount: failed.length,
      failed,
    })
    return
  }

  res.status(200).json({ deletedCount, failedCount: 0 })
}
