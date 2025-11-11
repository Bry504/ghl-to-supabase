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
const D = (o: unknown, p: string): Date | undefined => {
  const v = get(o, p)
  if (v instanceof Date) return v
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d }
  if (typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d }
  return undefined
}

async function tryUnassignInGHL(opportunityId: string): Promise<{ ok: boolean; status: number }> {
  const base = 'https://services.leadconnectorhq.com'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.GHL_API_KEY ?? ''}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (process.env.GHL_LOCATION_ID) headers['Location-Id'] = process.env.GHL_LOCATION_ID

  // intento 1: null
  let r = await fetch(`${base}/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ assignedTo: null }),
  })
  if (r.ok) return { ok: true, status: r.status }

  // intento 2: string vacío
  r = await fetch(`${base}/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ assignedTo: '' }),
  })
  return { ok: r.ok, status: r.status }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({} as unknown))
    console.log('[GHL abandoned body]', JSON.stringify(body))

    // Esperados (Custom Data del workflow):
    // opportunityId, currentStageName, abandonedAt, abandonedReason, assignedTo
    const oppId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')
    if (!oppId) return NextResponse.json({ error: 'Missing opportunityId' }, { status: 400 })

    const etapaActual =
      S(body, 'customData.currentStageName') ?? S(body, 'currentStageName') ??
      S(body, 'opportunity.stage_name') ?? S(body, 'opportunity.stageName') ??
      S(body, 'data.opportunity.stage_name') ?? S(body, 'data.opportunity.stageName') ?? 'Desconocida'

    const fechaAbandono =
      D(body, 'customData.abandonedAt') ?? D(body, 'abandonedAt') ??
      D(body, 'opportunity.updated_at') ?? D(body, 'data.opportunity.updated_at') ?? new Date()

    const razonAbandono =
      S(body, 'customData.abandonedReason') ?? S(body, 'abandonedReason') ??
      S(body, 'opportunity.abandoned_reason') ?? S(body, 'data.opportunity.abandoned_reason')

    const duenioHlId =
      S(body, 'customData.assignedTo') ?? S(body, 'assignedTo') ??
      S(body, 'opportunity.assignedTo') ?? S(body, 'data.opportunity.assignedTo')

    // buscar candidato
    const { data: cand } = await supabaseAdmin
      .from('candidatos')
      .select('id')
      .eq('hl_opportunity_id', oppId)
      .maybeSingle()

    const candidatoId = cand?.id ?? null

    // mapear usuario_id por usuarios.ghl_id
    let usuarioId: string | null = null
    if (duenioHlId) {
      const { data: usr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', duenioHlId)
        .maybeSingle()
      if (usr?.id) usuarioId = usr.id
    }

    // inserta en no_interesados
    const insertRow = {
      candidato_id: candidatoId,
      hl_opportunity_id: oppId,
      etapa_actual: etapaActual,
      fecha_abandono: fechaAbandono.toISOString(),
      duenio_hl_id: duenioHlId ?? null,
      usuario_id: usuarioId,
      razon_abandono: razonAbandono ?? null
    }
    const { error: errNI } = await supabaseAdmin.from('no_interesados').insert([insertRow])
    if (errNI) {
      console.error('Supabase insert no_interesados error', errNI)
      return NextResponse.json({ ok: false, error: errNI.message }, { status: 500 })
    }

    // actualiza candidato (estado/etapa/fecha)
    const { error: errCand } = await supabaseAdmin
      .from('candidatos')
      .update({
        estado: 'ABANDONADA',
        etapa_actual: etapaActual,
        stage_changed_at: fechaAbandono.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('hl_opportunity_id', oppId)
    if (errCand) console.error('Supabase update candidato error', errCand)

    // registra en historial_etapas (opcional pero recomendado)
    if (candidatoId) {
      await supabaseAdmin.from('historial_etapas').insert([{
        candidato_id: candidatoId,
        hl_opportunity_id: oppId,
        etapa_origen: etapaActual,          // si quieres, puedes leer la anterior como hicimos en stage-change
        etapa_destino: etapaActual,
        changed_at: fechaAbandono.toISOString(),
        source: 'WEBHOOK_HL',
        usuario_id: usuarioId
      }])
    }

    // desasignar en HighLevel (para poder reasignar)
    let unassignStatus: number | null = null
    if (process.env.GHL_API_KEY) {
      const res = await tryUnassignInGHL(oppId)
      unassignStatus = res.status
      if (!res.ok) {
        console.error('GHL unassign failed. status=', res.status)
      }
    } else {
      console.warn('GHL_API_KEY not set; skipping unassign call')
    }

    return NextResponse.json({ ok: true, unassignStatus })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}