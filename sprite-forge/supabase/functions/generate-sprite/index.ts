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
  } catch { return '' }
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
  } catch { return '' }
}

function estimateNeurons(width: number, height: number, referenceCount: number) {
  const outputTiles = Math.ceil(width / 512) * Math.ceil(height / 512)
  return Math.max(1, Math.ceil(outputTiles * 26.1 + referenceCount * 5.4 + 3))
}

function base64FromArrayBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function normalizeBase64(value: string) {
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : value
}

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
  } catch { return storageUrl }
}

function extractBase64FromJson(payload: unknown): string {
  if (typeof payload === 'string' && payload.length > 1000) return normalizeBase64(payload)
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>
  const r = p?.result as Record<string, unknown> | undefined
  const candidates: unknown[] = [
    r?.image, r?.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>)?.image : undefined,
    r, p?.image,
    p?.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>)?.image : undefined,
    p?.data,
  ]
  for (const c of candidates)
    if (typeof c === 'string' && c.length > 1000 && c !== '[object Object]') return normalizeBase64(c)
  return ''
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Always return CORS headers — even on unhandled errors (via the outer catch)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  // All code wrapped so unhandled exceptions still return JSON with CORS headers
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const publishableKey = getPublishableKey()
    const secretKey = getSecretKey()
    const authHeader = req.headers.get('Authorization') || ''
    const cloudflareAccountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') || ''
    const cloudflareToken = Deno.env.get('CLOUDFLARE_API_TOKEN') || ''
    const model = Deno.env.get('CLOUDFLARE_IMAGE_MODEL') || '@cf/black-forest-labs/flux-2-klein-4b'

    console.log(JSON.stringify({ stage: 'start', hasSupabaseUrl: !!supabaseUrl, hasPublishableKey: !!publishableKey, hasSecretKey: !!secretKey, hasAuth: !!authHeader, hasCF: !!(cloudflareAccountId && cloudflareToken) }))

    if (!supabaseUrl || !publishableKey || !secretKey)
      return json({ error: 'Supabase no está configurado en la función' }, 500)
    if (!cloudflareAccountId || !cloudflareToken)
      return json({ error: 'Faltan los secretos de Cloudflare en la función' }, 503)
    if (!authHeader.startsWith('Bearer '))
      return json({ error: 'Sesión requerida' }, 401)

    // ── Auth ────────────────────────────────────────────────────────────────
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser()
    console.log(JSON.stringify({ stage: 'auth', hasUser: !!userData?.user, error: userError?.message }))
    if (userError || !userData?.user) return json({ error: 'Sesión inválida', detail: userError?.message }, 401)

    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json()
    const mode = String(body?.mode || 'frame').toLowerCase()
    const prompt = String(body?.prompt || '').trim().slice(0, 8000)
    if (!prompt) return json({ error: 'Falta el prompt' }, 400)

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
      .map((v: unknown) => String(v || ''))
      .filter((v: string) => {
        try {
          const u = new URL(v)
          return u.protocol === 'https:' && u.host === allowedHost && u.pathname.includes('/storage/v1/object/public/sprite-assets/')
        } catch { return false }
      })

    const estimatedNeurons = estimateNeurons(width, height, referenceUrls.length)

    // ── Budget check (optional — skip if RPC doesn't exist) ─────────────────
    let budgetClaimed = false
    let budgetRemaining: number | null = null
    try {
      const { data: budget, error: budgetError } = await adminClient.rpc('claim_sprite_ai_budget', {
        p_user_id: userData.user.id,
        p_estimated_neurons: estimatedNeurons,
      })
      if (!budgetError) {
        budgetClaimed = true
        budgetRemaining = budget?.remaining ?? null
        if (!budget?.allowed) {
          const reason = budget?.reason === 'daily_user_limit'
            ? 'Has alcanzado tu límite familiar de hoy.'
            : 'La familia ha agotado la cuota estimada de hoy.'
          return json({ error: reason, remainingEstimatedNeurons: budget?.remaining ?? 0 }, 429)
        }
      } else {
        // RPC doesn't exist or failed — log and continue without budget check
        console.log(JSON.stringify({ stage: 'budget_skip', reason: budgetError.message }))
      }
    } catch (budgetEx) {
      console.log(JSON.stringify({ stage: 'budget_skip', reason: String(budgetEx) }))
    }

    console.log(JSON.stringify({ stage: 'request_info', mode, width, height, referenceCount: referenceUrls.length, estimatedNeurons }))

    // ── Build FormData for Cloudflare ────────────────────────────────────────
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('width', String(width))
    form.append('height', String(height))
    form.append('guidance', String(guidance))
    form.append('seed', String(seed))

    for (let idx = 0; idx < referenceUrls.length; idx++) {
      const resizedUrl = toResizedUrl(referenceUrls[idx])
      const resp = await fetch(resizedUrl, { signal: AbortSignal.timeout(15_000) })
      if (!resp.ok) throw new Error(`No se pudo obtener la referencia ${idx + 1} (HTTP ${resp.status}). Supabase Image Transformation puede no estar habilitado.`)
      const ct = resp.headers.get('content-type') || 'image/png'
      if (!ct.startsWith('image/')) throw new Error(`La referencia ${idx + 1} no es una imagen`)
      const blob = await resp.blob()
      if (blob.size > 5_000_000) throw new Error(`La referencia ${idx + 1} es demasiado grande`)
      form.append(`input_image_${idx}`, blob, `reference-${idx}.${ct.includes('jpeg') ? 'jpg' : 'png'}`)
    }

    const startedAt = Date.now()
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${model}`
    console.log(JSON.stringify({ stage: 'before_cloudflare', model, mode, width, height, referenceCount: referenceUrls.length }))

    const cfResponse = await fetch(cloudflareUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflareToken}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })

    const contentType = cfResponse.headers.get('content-type') || ''
    console.log(JSON.stringify({ stage: 'cloudflare_response', status: cfResponse.status, contentType, elapsedMs: Date.now() - startedAt }))

    if (!cfResponse.ok) {
      const detail = contentType.includes('application/json')
        ? JSON.stringify(await cfResponse.json())
        : await cfResponse.text()
      throw new Error(`Cloudflare respondió ${cfResponse.status}: ${detail.slice(0, 600)}`)
    }

    let imageBase64 = ''
    let mimeType = 'image/png'

    if (contentType.startsWith('image/')) {
      mimeType = contentType.split(';')[0].trim()
      imageBase64 = base64FromArrayBuffer(await cfResponse.arrayBuffer())
    } else {
      const payload = await cfResponse.json()
      console.log(JSON.stringify({ stage: 'cloudflare_json', topLevelKeys: Object.keys(payload || {}), resultType: typeof payload?.result }))
      imageBase64 = extractBase64FromJson(payload)
      if (!imageBase64) {
        return json({ error: 'Cloudflare respondió sin una imagen reconocible', cloudflareStatus: cfResponse.status, contentType, topLevelKeys: Object.keys(payload || {}) }, 502)
      }
    }

    console.log(JSON.stringify({ stage: 'return_image', mode, mimeType, imageLength: imageBase64?.length || 0, seed }))

    if (budgetClaimed) {
      // refund is handled client-side on error; on success we keep the budget consumed
    }

    return json({ imageBase64, mimeType, seed, mode, estimatedNeurons, remainingEstimatedNeurons: budgetRemaining })

  } catch (error) {
    // Top-level catch: always return JSON with CORS headers
    const msg = error instanceof Error ? error.message : String(error)
    console.error('generate-sprite unhandled error:', msg)

    // Best-effort budget refund (may fail if adminClient not yet created)
    // Skipped here to keep this catch block simple and error-free

    return json({ error: msg }, 500)
  }
})
