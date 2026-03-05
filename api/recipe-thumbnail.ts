type VercelRequest = {
  method?: string
  query?: Record<string, string | string[] | undefined>
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  setHeader: (name: string, value: string) => void
  json: (payload: unknown) => void
}

const getQueryUrl = (query: VercelRequest['query']): string => {
  if (!query || typeof query !== 'object') {
    return ''
  }

  const value = query.url
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : ''
  }

  return typeof value === 'string' ? value.trim() : ''
}

const toSafeHttpUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const isAllowedRecipeHost = (host: string): boolean => {
  const normalized = host.toLowerCase()
  return normalized === 'icook.tw' || normalized.endsWith('.icook.tw')
}

const pickFirstMetaImage = (html: string): string | null => {
  const patterns = [
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  // Fallback: directly pick recipe cover URL from HTML if meta tags are unavailable.
  const recipeCover = html.match(/https?:\/\/[^"'\s]+\/uploads\/recipe\/cover\/\d+\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i)
  if (recipeCover?.[0]) {
    return recipeCover[0]
  }

  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const rawUrl = getQueryUrl(req.query)
  if (!rawUrl) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  const targetUrl = toSafeHttpUrl(rawUrl)
  if (!targetUrl) {
    res.status(400).json({ error: 'Invalid URL' })
    return
  }

  if (!isAllowedRecipeHost(targetUrl.hostname)) {
    res.status(400).json({ error: 'Host is not allowed' })
    return
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'foodsheets-thumbnail-bot/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!upstream.ok) {
      res.status(502).json({ error: 'Failed to fetch recipe page' })
      return
    }

    const html = await upstream.text()
    const imageValue = pickFirstMetaImage(html)

    if (!imageValue) {
      res.status(404).json({ error: 'No thumbnail found' })
      return
    }

    const thumbnailUrl = toSafeHttpUrl(imageValue)
      ? imageValue
      : new URL(imageValue, targetUrl.origin).toString()

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({ thumbnailUrl })
  } catch {
    res.status(500).json({ error: 'Failed to resolve recipe thumbnail' })
  }
}
