import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function clampFloat(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function getPublishableKey() {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY')
  if (legacy) return legacy
  const direct = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  if (direct) return direct
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (!raw) return ''
  try {
    const keys = JSON.parse(raw)
    return keys.default || Object.values(keys)[0] || ''
  } catch {
    return ''
  }
}

function getSecretKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const direct = Deno.env.get('SUPABASE_SECRET_KEY')
  if (direct) return direct
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) return ''
  try {
    const keys = JSON.parse(raw)
    return keys.default || Object.values(keys)[0] || ''
  } catch {
    return ''
  }
}

function estimateNeurons(width: number, height: number, referenceCount: number) {
  const outputTiles = Math.ceil(width / 512) * Math.ceil(height / 512)
  return Math.max(1, Math.ceil(outputTiles * 26.1 + referenceCount * 5.4 + 3))
}

function base64FromArrayBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Strip data URI prefix if present. */
function normalizeBase64(value: string) {
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : value
}

/**
 * Convert a Supabase Storage public object URL to its image-transform equivalent
 * so the server fetches a ≤480×480 version instead of the full-size file.
 */
function toResizedUrl(storageUrl: string): string {
  try {
    const url = new URL(storageUrl)
    const transformed = url.pathname.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/',
    )
    if (transformed === url.pathname) return storageUrl
    url.pathname = transformed
    url.searchParams.set('width', '480')
    url.searchParams.set('height', '480')
    url.searchParams.set('resize', 'contain')
    return url.toString()
  } catch {
    return storageUrl
  }
}

/**
 * Walk every plausible location in a Cloudflare Workers AI JSON response and
 * return the first non-empty base64 string found, or '' if none.
 */
function extractBase64FromJson(payload: unknown): string {
  if (typeof payload === 'string' && payload.length > 1000) {
    return normalizeBase64(payload)
  }
  if (!payload || typeof payload !== 'object') return ''

  const p = payload as Record<string, unknown>

  const candidates: unknown[] = [
    p?.result && typeof p.result === 'object' ? (p.result as Record<string, unknown>)?.image : undefined,
    p?.result && typeof p.result === 'object' ? (p.result as Record<string, unknown>)?.data &&
      typeof (p.result as Record<string, unknown>).data === 'object'
        ? ((p.result as Record<string, unknown>).data as Record<string, unknown>)?.image
        : undefined : undefined,
    p?.result,
    p?.image,
    p?.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>)?.image : undefined,
    p?.data,
  ]

  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 1000 && c !== '[object Object]') {
      return normalizeBase64(c)
    }
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const publishableKey = getPublishableKey()
  const secretKey = getSecretKey()
  const authHeader = req.headers.get('Authorization') || ''
  const cloudflareAccountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') || ''
  const cloudflareToken = Deno.env.get('CLOUDFLARE_API_TOKEN') || ''
  const model = Deno.env.get('CLOUDFLARE_IMAGE_MODEL') || '@cf/black-forest-labs/flux-2-klein-4b'

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.log(JSON.stringify({ stage: 'config_error', missing: 'supabase_keys' }))
    return json({ error: 'Supabase no está configurado en la función' }, 500)
  }
  if (!cloudflareAccountId || !cloudflareToken) {
    console.log(JSON.stringify({ stage: 'config_error', missing: 'cloudflare_secrets' }))
    return json({ error: 'Faltan los secretos de Cloudflare' }, 503)
  }
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sesión requerida' }, 401)

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Sesión inválida' }, 401)

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let estimatedNeurons = 0
  let budgetClaimed = false

  try {
    const body = await req.json()

    // ── Mode routing ────────────────────────────────────────────────────────
    // mode: "spritesheet" — generate a full horizontal spritesheet (wide image)
    // mode: "reference"  — generate a single reference image (character facing East)
    // mode: (default)    — frame-by-frame generation (legacy / experimental)
    const mode = String(body?.mode || 'frame').toLowerCase()

    const prompt = String(body?.prompt || '').trim().slice(0, 8000)
    if (!prompt) return json({ error: 'Falta el prompt' }, 400)

    // For spritesheet mode, the caller sends width = frame_size * frame_count
    // We cap individual dimension to keep memory within model limits
    const maxDim = mode === 'spritesheet' ? 4096 : 1920
    const width = clampInt(body?.width, 256, maxDim, mode === 'spritesheet' ? 3072 : 512)
    const height = clampInt(body?.height, 256, 1920, 512)
    const guidance = clampFloat(body?.guidance, 1, 10, mode === 'reference' ? 6 : 4)
    const seed = body?.seed == null || body?.seed === ''
      ? Math.floor(Math.random() * 2_147_483_647)
      : clampInt(body.seed, 0, 2_147_483_647, 1)

    const rawReferenceUrls = Array.isArray(body?.referenceUrls) ? body.referenceUrls.slice(0, 4) : []
    const allowedHost = new URL(supabaseUrl).host
    const referenceUrls = rawReferenceUrls
      .map((value: unknown) => String(value || ''))
      .filter((value: string) => {
        try {
          const url = new URL(value)
          return url.protocol === 'https:'
            && url.host === allowedHost
            && url.pathname.includes('/storage/v1/object/public/sprite-assets/')
        } catch {
          return false
        }
      })

    estimatedNeurons = estimateNeurons(width, height, referenceUrls.length)
    const { data: budget, error: budgetError } = await adminClient.rpc('claim_sprite_ai_budget', {
      p_user_id: userData.user.id,
      p_estimated_neurons: estimatedNeurons,
    })
    if (budgetError) throw new Error(`No se pudo comprobar la cuota: ${budgetError.message}`)
    if (!budget?.allowed) {
      const reason = budget?.reason === 'daily_user_limit'
        ? 'Has alcanzado tu límite familiar de hoy.'
        : 'La familia ha agotado la cuota estimada de hoy.'
      return json({ error: reason, remainingEstimatedNeurons: budget?.remaining ?? 0 }, 429)
    }
    budgetClaimed = true

    // ── Build FormData for Cloudflare ────────────────────────────────────────
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('width', String(width))
    form.append('height', String(height))
    form.append('guidance', String(guidance))
    form.append('seed', String(seed))

    console.log(JSON.stringify({
      stage: 'request_info',
      mode,
      width,
      height,
      referenceCount: referenceUrls.length,
      estimatedNeurons,
    }))

    for (let index = 0; index < referenceUrls.length; index++) {
      const resizedUrl = toResizedUrl(referenceUrls[index])
      const response = await fetch(resizedUrl, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) {
        console.log(JSON.stringify({
          stage: 'reference_resize_error',
          index,
          transformStatus: response.status,
          hint: 'Supabase Image Transformation may not be enabled on this project plan.',
        }))
        throw new Error(
          `No se pudo redimensionar la referencia ${index + 1} (HTTP ${response.status}). ` +
          `Asegúrate de que Supabase Image Transformation esté habilitado.`,
        )
      }
      const refContentType = response.headers.get('content-type') || 'image/png'
      if (!refContentType.startsWith('image/')) throw new Error(`La referencia ${index + 1} no es una imagen`)
      const blob = await response.blob()
      if (blob.size > 5_000_000) throw new Error(`La referencia ${index + 1} es demasiado grande`)
      form.append(`input_image_${index}`, blob, `reference-${index}.${refContentType.includes('jpeg') ? 'jpg' : 'png'}`)
    }

    // ── Diagnostic log before Cloudflare call ────────────────────────────────
    const startedAt = Date.now()
    console.log(JSON.stringify({
      stage: 'before_cloudflare',
      model,
      mode,
      width,
      height,
      referenceCount: referenceUrls.length,
    }))

    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${model}`
    const cfResponse = await fetch(cloudflareUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflareToken}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })

    const contentType = cfResponse.headers.get('content-type') || ''

    // ── Diagnostic log after Cloudflare response ─────────────────────────────
    console.log(JSON.stringify({
      stage: 'cloudflare_response',
      status: cfResponse.status,
      contentType,
      elapsedMs: Date.now() - startedAt,
    }))

    if (!cfResponse.ok) {
      const detail = contentType.includes('application/json')
        ? JSON.stringify(await cfResponse.json())
        : await cfResponse.text()
      throw new Error(`Cloudflare respondió ${cfResponse.status}: ${detail.slice(0, 600)}`)
    }

    // ── Parse image from response ─────────────────────────────────────────────
    let imageBase64 = ''
    let mimeType = 'image/png'

    if (contentType.startsWith('image/')) {
      mimeType = contentType.split(';')[0].trim()
      imageBase64 = base64FromArrayBuffer(await cfResponse.arrayBuffer())
    } else {
      const payload = await cfResponse.json()

      console.log(JSON.stringify({
        stage: 'cloudflare_json',
        topLevelKeys: Object.keys(payload || {}),
        resultType: typeof payload?.result,
        resultKeys: payload?.result && typeof payload.result === 'object'
          ? Object.keys(payload.result)
          : [],
      }))

      imageBase64 = extractBase64FromJson(payload)

      if (!imageBase64) {
        return json({
          error: 'Cloudflare respondió sin una imagen reconocible',
          cloudflareStatus: cfResponse.status,
          contentType,
          topLevelKeys: Object.keys(payload || {}),
          resultType: typeof payload?.result,
          resultKeys: payload?.result && typeof payload.result === 'object'
            ? Object.keys(payload.result as object)
            : [],
        }, 502)
      }
    }

    // ── Diagnostic log before returning to frontend ───────────────────────────
    console.log(JSON.stringify({
      stage: 'return_image',
      mode,
      mimeType,
      imageLength: imageBase64?.length || 0,
      seed,
    }))

    return json({
      imageBase64,
      mimeType,
      seed,
      mode,
      estimatedNeurons,
      remainingEstimatedNeurons: budget?.remaining ?? null,
    })

  } catch (error) {
    console.error('generate-sprite error:', error instanceof Error ? error.message : String(error))
    if (budgetClaimed && estimatedNeurons > 0) {
      await adminClient.rpc('refund_sprite_ai_budget', {
        p_user_id: userData.user.id,
        p_estimated_neurons: estimatedNeurons,
      }).catch(() => {})
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
