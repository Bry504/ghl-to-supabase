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
  if (typeof v === 'string') { const t = v.trim(); return t ? t : undefined }
  return undefined
}
const N = (o: unknown, p: string) => {
  const v = get(o, p)
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : undefined }
  return undefined
}

function resolveDate(body: unknown): Date {
  const cand = [
    'changedAt','changed_at',
    'customData.changedAt','customData.changed_at',
    'opportunity.updatedAt','opportunity.updated_at',
    'data.opportunity.updatedAt','data.opportunity.updated_at'
  ]
  for (const p of cand) {
    const n = N(body, p)
    if (typeof n === 'number' && String(n).length >= 12) {
      const d = new Date(n); if (!Number.isNaN(d.getTime())) return d
    }
    const s = S(body, p); if (s) { const d = new Date(s); if (!Number.isNaN(d.getTime())) return d }
  }
  return new Date()
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({} as unknown))
    console.log('[GHL stage-change body]', JSON.stringify(body))

    const hlOpportunityId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')

    const etapaDestino =
      S(body, 'customData.newStageName') ?? S(body, 'newStageName') ??
      S(body, 'opportunity.stage_name') ?? S(body, 'opportunity.stageName') ??
      S(body, 'data.opportunity.stage_name') ?? S(body, 'data.opportunity.stageName')

    if (!hlOpportunityId || !etapaDestino) {
      return NextResponse.json({ error: 'Missing opportunityId or stage' }, { status: 400 })
    }

    const changedAt = resolveDate(body)

    // Debe existir el candidato YA (si no, no es un cambio válido)
    const { data: cand } = await supabaseAdmin
      .from('candidatos')
      .select('id, etapa_actual')
      .eq('hl_opportunity_id', hlOpportunityId)
      .maybeSingle()

    const candidatoId: string | null = cand?.id ?? null
    let etapaOrigen: string | null = cand?.etapa_actual ?? null
    if (!candidatoId) {
      return NextResponse.json({ ok: true, skipped: 'no-candidato-yet' })
    }

    // Último historial para definir origen real y evitar duplicados
    const { data: lastHist } = await supabaseAdmin
      .from('historial_etapas')
      .select('etapa_destino, source, changed_at')
      .eq('hl_opportunity_id', hlOpportunityId)
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!etapaOrigen && lastHist?.etapa_destino) {
      etapaOrigen = lastHist.etapa_destino
    }

    // Si no hay historial previo (raro) y tampoco origen, no registramos: creación no se procesó aún
    if (!lastHist && !etapaOrigen) {
      return NextResponse.json({ ok: true, skipped: 'initial-not-ready' })
    }

    // Evitar “sin cambio real”
    if (etapaOrigen && etapaDestino && etapaOrigen === etapaDestino) {
      return NextResponse.json({ ok: true, skipped: 'no-stage-change' })
    }

    // Debounce: si el último fue SISTEMA con mismo destino hace < 90s, ignorar
    if (lastHist?.source === 'SISTEMA' && lastHist?.etapa_destino === etapaDestino) {
      const lastTs = new Date(lastHist.changed_at as string).getTime()
      if (changedAt.getTime() - lastTs < 90_000) {
        return NextResponse.json({ ok: true, skipped: 'debounced-dup-after-create' })
      }
    }

    // usuario (opcional)
    const userGhlId =
      S(body, 'customData.userGhlId') ?? S(body, 'userGhlId') ??
      S(body, 'opportunity.updatedBy') ?? S(body, 'data.opportunity.updatedBy')

    let usuarioId: string | null = null
    if (userGhlId) {
      const { data: usr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', userGhlId)
        .maybeSingle()
      usuarioId = usr?.id ?? null
    }

    // Insertar historial (si llegamos hasta aquí, hay cambio real)
    const { error: histErr } = await supabaseAdmin.from('historial_etapas').insert([{
      candidato_id: candidatoId,              // <- siempre lo ponemos
      hl_opportunity_id: hlOpportunityId,
      etapa_origen: etapaOrigen,
      etapa_destino: etapaDestino,
      changed_at: changedAt.toISOString(),
      source: 'WEBHOOK_HL',
      usuario_id: usuarioId
    }])

    if (histErr) {
      console.error('Supabase insert historial error', histErr)
      return NextResponse.json({ ok: false, error: histErr.message }, { status: 500 })
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