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
  // Precios de FLUX.2 Klein 4B convertidos aproximadamente a neurons.
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

function normalizeBase64(value: string) {
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : value
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

  if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: 'Supabase no está configurado en la función' }, 500)
  if (!cloudflareAccountId || !cloudflareToken) return json({ error: 'Faltan los secretos de Cloudflare' }, 503)
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
    const prompt = String(body?.prompt || '').trim().slice(0, 8000)
    if (!prompt) return json({ error: 'Falta el prompt' }, 400)

    const width = clampInt(body?.width, 256, 1920, 512)
    const height = clampInt(body?.height, 256, 1920, 512)
    const guidance = clampFloat(body?.guidance, 1, 10, 4)
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

    const form = new FormData()
    form.append('prompt', prompt)
    form.append('width', String(width))
    form.append('height', String(height))
    form.append('guidance', String(guidance))
    form.append('seed', String(seed))

    for (let index = 0; index < referenceUrls.length; index++) {
      const response = await fetch(referenceUrls[index], { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`No se pudo cargar la referencia ${index + 1}`)
      const contentType = response.headers.get('content-type') || 'image/png'
      if (!contentType.startsWith('image/')) throw new Error(`La referencia ${index + 1} no es una imagen`)
      const blob = await response.blob()
      if (blob.size > 5_000_000) throw new Error(`La referencia ${index + 1} es demasiado grande`)
      form.append(`input_image_${index}`, blob, `reference-${index}.${contentType.includes('jpeg') ? 'jpg' : 'png'}`)
    }

    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${model}`
    const cfResponse = await fetch(cloudflareUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflareToken}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })

    const contentType = cfResponse.headers.get('content-type') || ''
    if (!cfResponse.ok) {
      const detail = contentType.includes('application/json')
        ? JSON.stringify(await cfResponse.json())
        : await cfResponse.text()
      throw new Error(`Cloudflare respondió ${cfResponse.status}: ${detail.slice(0, 600)}`)
    }

    let imageBase64 = ''
    let mimeType = 'image/png'

    if (contentType.startsWith('image/')) {
      mimeType = contentType.split(';')[0]
      imageBase64 = base64FromArrayBuffer(await cfResponse.arrayBuffer())
    } else {
      const payload = await cfResponse.json()
      const result = payload?.result ?? payload
      const candidate = result?.image ?? result?.data?.image ?? result
      if (typeof candidate !== 'string') throw new Error('Cloudflare no devolvió una imagen reconocible')
      imageBase64 = normalizeBase64(candidate)
    }

    return json({
      imageBase64,
      mimeType,
      seed,
      estimatedNeurons,
      remainingEstimatedNeurons: budget?.remaining ?? null,
    })
  } catch (error) {
    console.error(error)
    if (budgetClaimed && estimatedNeurons > 0) {
      await adminClient.rpc('refund_sprite_ai_budget', {
        p_user_id: userData.user.id,
        p_estimated_neurons: estimatedNeurons,
      })
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
