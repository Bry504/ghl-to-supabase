import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

// 1) Schema que acepta: Custom Data (flat) + estándar de GHL
const WebhookSchema = z.object({
  // Custom Data (los que agregas en el webhook)
  fullName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  createdAt: z.union([z.string(), z.number(), z.date()]).optional(),

  // Payload estándar de GHL (si viene)
  contact: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    name: z.string().optional()
  }).optional(),
  opportunity: z.object({
    id: z.string().optional(),
    createdAt: z.union([z.string(), z.number(), z.date()]).optional(),
    pipelineId: z.string().optional(),
    title: z.string().optional()
  }).optional()
})

type WebhookPayload = z.infer<typeof WebhookSchema>

// 2) Helpers tipados (sin any)
function safeFullName(payload: WebhookPayload): string {
  if (payload.fullName && payload.fullName.trim()) return payload.fullName.trim()

  const fromCustom = `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim()
  if (fromCustom) return fromCustom

  const c = payload.contact
  if (c?.name && c.name.trim()) return c.name.trim()

  const fn = c?.firstName?.trim() ?? ''
  const ln = c?.lastName?.trim() ?? ''
  const joined = `${fn} ${ln}`.trim()
  if (joined) return joined

  const title = payload.opportunity?.title?.trim() ?? ''
  return title || 'Sin nombre'
}

function parseCreatedAt(value: WebhookPayload['createdAt'] | WebhookPayload['opportunity'] extends infer O
  ? O extends { createdAt?: unknown } ? O['createdAt'] : never
  : never): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') {
    const n = Number(value)
    if (!Number.isNaN(n) && value.length >= 12) return new Date(n) // epoch ms
    return new Date(value) // ISO
  }
  return new Date()
}

// 3) Handler
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const raw = await req.json().catch(() => ({}))
    const parsed = WebhookSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Bad payload', details: parsed.error.flatten() }, { status: 400 })
    }

    const body = parsed.data
    const nombreCompleto = safeFullName(body)
    const fecha = parseCreatedAt(body.createdAt ?? body.opportunity?.createdAt)

    const { error } = await supabaseAdmin
      .from('candidatos')
      .insert([{ nombre_completo: nombreCompleto, fecha_creacion: fecha.toISOString() }])

    if (error) {
      console.error('Supabase insert error', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}