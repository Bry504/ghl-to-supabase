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
const join2 = (a?: string, b?: string): string | undefined => {
  const s = `${a ?? ''} ${b ?? ''}`.trim(); return s ? s : undefined
}

function resolveFullName(body: unknown): string {
  const top =
    S(body, 'fullName') ??
    S(body, 'full_name') ??
    S(body, 'name') ??
    join2(S(body, 'firstName'), S(body, 'lastName')) ??
    join2(S(body, 'firstname'), S(body, 'lastName')) ??
    join2(S(body, 'first_name'), S(body, 'last_name'))
  if (top) return top

  const fromData =
    S(body, 'data.fullName') ??
    S(body, 'data.full_name') ??
    S(body, 'data.name') ??
    join2(S(body, 'data.firstName'), S(body, 'data.lastName')) ??
    join2(S(body, 'data.first_name'), S(body, 'data.last_name'))
  if (fromData) return fromData

  const contact =
    S(body, 'contact.name') ??
    S(body, 'contact.fullName') ??
    S(body, 'contact.full_name') ??
    join2(S(body, 'contact.firstName'), S(body, 'contact.lastName')) ??
    join2(S(body, 'contact.first_name'), S(body, 'contact.last_name'))
  if (contact) return contact

  const title =
    S(body, 'title') ??
    S(body, 'opportunity.title') ??
    S(body, 'data.opportunity.title')
  return title ?? 'Sin nombre'
}

function resolveCreatedAt(body: unknown): Date {
  const cand = [
    'createdAt','created_at',
    'data.createdAt','data.created_at',
    'opportunity.createdAt','opportunity.created_at',
    'data.opportunity.createdAt','data.opportunity.created_at',
    'contact.date_added'
  ]
  for (const p of cand) {
    const n = N(body, p)
    if (typeof n === 'number' && String(n).length >= 12) {
      const d = new Date(n); if (!Number.isNaN(d.getTime())) return d
    }
    const s = S(body, p)
    if (s) { const d = new Date(s); if (!Number.isNaN(d.getTime())) return d }
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
    console.log('[GHL opportunity body]', JSON.stringify(body))

    // Campos mínimos
    const hlOpportunityId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')
    if (!hlOpportunityId) {
      return NextResponse.json({ error: 'Missing opportunityId' }, { status: 400 })
    }

    // Si ya existe el candidato con este HL id, NO hacer nada (creación idempotente)
    const { data: existing } = await supabaseAdmin
      .from('candidatos')
      .select('id')
      .eq('hl_opportunity_id', hlOpportunityId)
      .maybeSingle()

    if (existing?.id) {
      return NextResponse.json({ ok: true, skipped: 'already-exists' })
    }

    const nombre = resolveFullName(body)
    const createdAt = resolveCreatedAt(body)

    const Sfield = (p: string) => S(body, p)

    const etapaActual =
      Sfield('etapa_actual') ??
      Sfield('customData.etapa_actual') ??
      Sfield('opportunity.stage_name') ?? Sfield('opportunity.stageName') ??
      Sfield('data.opportunity.stage_name') ?? Sfield('data.opportunity.stageName') ??
      'Nuevos candidatos'

    const celular =
      Sfield('phone') ?? Sfield('customData.phone') ?? Sfield('contact.phone') ?? Sfield('data.contact.phone')

    const email =
      Sfield('email') ?? Sfield('customData.email') ?? Sfield('contact.email') ?? Sfield('data.contact.email')

    const dni_ce =
      Sfield('dni_ce') ??
      Sfield('customData.dni_ce') ??
      Sfield('contact.documento_de_identidad') ??
      Sfield('data.contact.documento_de_identidad')

    const canal =
      Sfield('canal') ?? Sfield('customData.canal') ?? Sfield('opportunity.canal') ?? Sfield('data.opportunity.canal')

    const fuente_del_candidato =
      Sfield('fuente_del_candidato') ??
      Sfield('customData.fuente_del_candidato') ??
      Sfield('opportunity.fuente_del_candidato') ??
      Sfield('data.opportunity.fuente_del_candidato')

    const ownerGhlId =
      Sfield('propietario') ?? Sfield('customData.propietario') ??
      Sfield('opportunity.assignedTo') ?? Sfield('data.opportunity.assignedTo')

    let propietario_id: string | null = null
    if (ownerGhlId) {
      const { data: ownerRow } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', ownerGhlId)
        .maybeSingle()
      propietario_id = ownerRow?.id ?? null
    }

    // Inserta candidato (nueva oportunidad)
    const insertRow = {
      nombre_completo: nombre,
      fecha_creacion: createdAt.toISOString(),
      celular: celular ?? null,
      dni_ce: dni_ce ?? null,
      email: email ?? null,
      canal: canal ?? null,
      fuente_del_candidato: fuente_del_candidato ?? null,
      estado: 'ABIERTO',
      etapa_actual: etapaActual,
      hl_opportunity_id: hlOpportunityId,
      hl_pipeline_id:
        Sfield('pipelineId') ?? Sfield('opportunity.pipeline_id') ?? Sfield('data.opportunity.pipeline_id') ?? null,
      propietario_id,
      updated_at: new Date().toISOString()
    }

    const { data: candIns, error: candErr } = await supabaseAdmin
      .from('candidatos')
      .insert([insertRow])
      .select('id')
      .maybeSingle()

    if (candErr) {
      console.error('Supabase insert candidatos error', candErr)
      return NextResponse.json({ ok: false, error: candErr.message }, { status: 500 })
    }

    const candidatoId = candIns?.id ?? null

    // Inserta SOLO 1 historial inicial (SISTEMA)
    if (candidatoId) {
      const { data: already } = await supabaseAdmin
        .from('historial_etapas')
        .select('id')
        .eq('hl_opportunity_id', hlOpportunityId)
        .limit(1)

      if (!already || already.length === 0) {
        const { error: histErr } = await supabaseAdmin.from('historial_etapas').insert([{
          candidato_id: candidatoId,
          hl_opportunity_id: hlOpportunityId,
          etapa_origen: null,
          etapa_destino: etapaActual,
          changed_at: createdAt.toISOString(),
          source: 'SISTEMA',
          usuario_id: propietario_id
        }])
        if (histErr) {
          console.error('Supabase insert historial (SISTEMA) error', histErr)
          return NextResponse.json({ ok: false, error: histErr.message }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ ok: true, candidato_id: candidatoId })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}