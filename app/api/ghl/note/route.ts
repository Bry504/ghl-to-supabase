import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

type Dict = Record<string, unknown>
const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null
const get = (o: unknown, p: string): unknown => {
  if (!isObj(o)) return undefined
  return p.split('.').reduce<unknown>((acc, k) => (isObj(acc) ? (acc as Dict)[k] : undefined), o)
}
const S = (o: unknown, p: string) => {
  const v = get(o, p)
  if (typeof v === 'string') {
    const t = v.trim()
    return t ? t : undefined
  }
  return undefined
}
const N = (o: unknown, p: string) => {
  const v = get(o, p)
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function resolveDate(body: unknown): Date {
  const fields = [
    'changedAt', 'changed_at',
    'createdAt', 'created_at',
    'timestamp', 'data.timestamp',
    'customData.timestamp'
  ]
  for (const p of fields) {
    const n = N(body, p)
    if (typeof n === 'number' && String(n).length >= 12) {
      const d = new Date(n)
      if (!Number.isNaN(d.getTime())) return d
    }
    const s = S(body, p)
    if (s) {
      const d = new Date(s)
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  return new Date()
}

export async function POST(req: NextRequest) {
  try {
    // Validar token
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse del body
    const body = await req.json().catch(() => ({} as unknown))
    console.log('[GHL note body]', JSON.stringify(body))

    // Extraer campos
    const hlOpportunityId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')

    const notaTexto =
      S(body, 'note') ?? S(body, 'nota') ?? S(body, 'customData.note') ??
      S(body, 'customData.nota') ?? S(body, 'data.note') ?? S(body, 'data.nota')

    const userGhlId =
      S(body, 'customData.userGhlId') ?? S(body, 'userGhlId') ??
      S(body, 'opportunity.updatedBy') ?? S(body, 'data.opportunity.updatedBy')

    const changedAt = resolveDate(body)

    if (!hlOpportunityId || !notaTexto) {
      return NextResponse.json({ error: 'Missing opportunityId or note' }, { status: 400 })
    }

    // Buscar candidato
    const { data: cand } = await supabaseAdmin
      .from('candidatos')
      .select('id, etapa_actual')
      .eq('hl_opportunity_id', hlOpportunityId)
      .maybeSingle()

    if (!cand?.id) {
      return NextResponse.json({ ok: false, error: 'Candidato no encontrado' }, { status: 404 })
    }

    // Mapear usuario
    let usuarioId: string | null = null
    if (userGhlId) {
      const { data: usr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', userGhlId)
        .maybeSingle()
      usuarioId = usr?.id ?? null
    }

    // Insertar nota
    const { error } = await supabaseAdmin.from('notas').insert([
      {
        candidato_id: cand.id,
        usuario_id: usuarioId,
        nota: notaTexto,
        etapa_registro: cand.etapa_actual ?? 'Sin etapa',
        changed_at: changedAt.toISOString()
      }
    ])

    if (error) {
      console.error('Supabase insert nota error', error)
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