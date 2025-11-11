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
    'data.changedAt','data.changed_at',
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

    // Custom Data esperados en GHL:
    // opportunityId, pipelineId, oldStageName, newStageName, changedAt, userGhlId (opcional)
    const hlOpportunityId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')

    const etapaOrigen =
      S(body, 'customData.oldStageName') ?? S(body, 'oldStageName') ??
      S(body, 'opportunity.oldStageName') ?? S(body, 'data.opportunity.oldStageName')

    const etapaDestino =
      S(body, 'customData.newStageName') ?? S(body, 'newStageName') ??
      S(body, 'opportunity.stage_name') ?? S(body, 'opportunity.stageName') ??
      S(body, 'data.opportunity.stage_name') ?? S(body, 'data.opportunity.stageName')

    const changedAt = resolveDate(body)

    const userGhlId =
      S(body, 'customData.userGhlId') ?? S(body, 'userGhlId') ??
      S(body, 'opportunity.updatedBy') ?? S(body, 'data.opportunity.updatedBy')

    // encontrar candidato por hl_opportunity_id
    let candidatoId: string | null = null
    if (hlOpportunityId) {
      const { data: cand } = await supabaseAdmin
        .from('candidatos')
        .select('id')
        .eq('hl_opportunity_id', hlOpportunityId)
        .maybeSingle()
      if (cand?.id) candidatoId = cand.id
    }

    // mapear usuario (si mandas userGhlId en custom data)
    let usuarioId: string | null = null
    if (userGhlId) {
      const { data: usr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', userGhlId)
        .maybeSingle()
      if (usr?.id) usuarioId = usr.id
    }

    // inserta en historial
    const { error } = await supabaseAdmin.from('historial_etapas').insert([{
      candidato_id: candidatoId,
      hl_opportunity_id: hlOpportunityId ?? null,
      etapa_origen: etapaOrigen ?? null,
      etapa_destino: etapaDestino ?? null,
      changed_at: changedAt.toISOString(),
      source: 'WEBHOOK_HL',
      usuario_id: usuarioId
    }])

    if (error) {
      console.error('Supabase insert historial error', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // El trigger actualizará candidatos.etapa_actual y stage_changed_at
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}