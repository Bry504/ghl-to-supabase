import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

/**
 * Webhook: "Opportunity Created" (GHL)
 * Filtras por pipeline en GHL y apuntas acá con ?token=...
 * Inserta en public.candidatos: (nombre_completo, fecha_creacion)
 */

const BodySchema = z.object({
  // HighLevel suele mandar un objeto con contact y opportunity; deja flex/robusto
  contact: z.object({
    firstName: z.string().optional().default(''),
    lastName: z.string().optional().default(''),
    name: z.string().optional() // a veces viene name completo
  }).optional(),
  opportunity: z.object({
    id: z.string().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(), // ms epoch o ISO
    pipelineId: z.string().optional(),
    title: z.string().optional() // a veces el título trae nombre
  }).optional()
})

function safeFullName(payload: z.infer<typeof BodySchema>) {
  const contact = payload.contact
  if (contact?.name && contact.name.trim()) return contact.name.trim()
  const fn = contact?.firstName?.trim() ?? ''
  const ln = contact?.lastName?.trim() ?? ''
  const joined = `${fn} ${ln}`.trim()
  // fallback: opportunity.title como nombre si no hay contacto
  if (joined) return joined
  const title = payload.opportunity?.title?.trim() ?? ''
  return title || 'Sin nombre'
}

function parseCreatedAt(v: unknown): Date {
  // GHL a veces manda epoch ms, otras ISO
  if (typeof v === 'number') return new Date(v)
  if (typeof v === 'string') {
    const num = Number(v)
    if (!Number.isNaN(num) && v.length >= 12) return new Date(num) // probablemente epoch ms
    return new Date(v)
  }
  return new Date()
}

export async function POST(req: NextRequest) {
  try {
    // 1) Seguridad simple por token en query
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2) Lee cuerpo
    const json = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Bad payload', details: parsed.error.flatten() }, { status: 400 })
    }

    // 3) Deriva campos
    const nombreCompleto = safeFullName(parsed.data)
    const fecha = parseCreatedAt(parsed.data.opportunity?.createdAt)

    // 4) Inserta en Supabase
    const { error } = await supabaseAdmin
      .from('candidatos')
      .insert([{ nombre_completo: nombreCompleto, fecha_creacion: fecha.toISOString() }])

    if (error) {
      console.error('Supabase insert error', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
  console.error(e)
  if (e instanceof Error) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
  return NextResponse.json({ error: 'Server error' }, { status: 500 })
}
}

// Opcional: endpoint GET para healthcheck
export async function GET() {
  return NextResponse.json({ ok: true })
}