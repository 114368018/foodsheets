import crypto from 'node:crypto'

type VercelRequest = {
  method?: string
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (payload: unknown) => void
}

const getBodyPublicId = (body: unknown): string => {
  if (!body || typeof body !== 'object') {
    return ''
  }

  const value = (body as { publicId?: unknown }).publicId
  return typeof value === 'string' ? value.trim() : ''
}

const createCloudinarySignature = (params: Record<string, string>, apiSecret: string): string => {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  return crypto.createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex')
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

  const publicId = getBodyPublicId(req.body)
  if (!publicId) {
    res.status(400).json({ error: 'publicId is required' })
    return
  }

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

  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    })

    const payload = (await response.json()) as { result?: string; error?: { message?: string } }

    if (!response.ok) {
      res.status(response.status).json({
        error: payload.error?.message ?? 'Cloudinary destroy failed',
      })
      return
    }

    if (payload.result !== 'ok' && payload.result !== 'not found') {
      res.status(500).json({ error: `Unexpected destroy result: ${payload.result ?? 'unknown'}` })
      return
    }

    res.status(200).json({ result: payload.result })
  } catch {
    res.status(500).json({ error: 'Failed to call Cloudinary destroy API' })
  }
}
