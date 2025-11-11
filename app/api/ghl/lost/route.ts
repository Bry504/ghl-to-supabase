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
  // En HL/LeadConnector suele ser PATCH /opportunities/{id} con { assignedTo: null } o "".
  // Implementamos dos intentos seguros; si ambos fallan, solo lo logueamos.
  const base = 'https://services.leadconnectorhq.com'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.GHL_API_KEY ?? ''}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json'
  }

  // Intento 1: assignedTo: null
  let r = await fetch(`${base}/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ assignedTo: null })
  })
  if (r.ok) return { ok: true, status: r.status }

  // Intento 2: assignedTo: '' (string vacío)
  r = await fetch(`${base}/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ assignedTo: '' })
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
    console.log('[GHL lost body]', JSON.stringify(body))

    // Esperamos que el workflow de HL mande por Custom Data:
    // opportunityId, currentStageName, lostAt, lostReason, assignedTo
    const oppId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')
    if (!oppId) return NextResponse.json({ error: 'Missing opportunityId' }, { status: 400 })

    const etapaActual =
      S(body, 'customData.currentStageName') ?? S(body, 'currentStageName') ??
      S(body, 'opportunity.stage_name') ?? S(body, 'opportunity.stageName') ??
      S(body, 'data.opportunity.stage_name') ?? S(body, 'data.opportunity.stageName') ?? 'Desconocida'

    const fechaPerdida =
      D(body, 'customData.lostAt') ?? D(body, 'lostAt') ??
      D(body, 'opportunity.updated_at') ?? D(body, 'data.opportunity.updated_at') ?? new Date()

    const razonPerdida =
      S(body, 'customData.lostReason') ?? S(body, 'lostReason') ??
      S(body, 'opportunity.lost_reason') ?? S(body, 'data.opportunity.lost_reason')

    const duenioHlId =
      S(body, 'customData.assignedTo') ?? S(body, 'assignedTo') ??
      S(body, 'opportunity.assignedTo') ?? S(body, 'data.opportunity.assignedTo')

    // Buscar candidato por opportunity id
    const { data: cand } = await supabaseAdmin
      .from('candidatos')
      .select('id')
      .eq('hl_opportunity_id', oppId)
      .maybeSingle()

    const candidatoId = cand?.id ?? null

    // Mapear a usuarios.id por ghl_id
    let usuarioId: string | null = null
    if (duenioHlId) {
      const { data: usr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', duenioHlId)
        .maybeSingle()
      if (usr?.id) usuarioId = usr.id
    }

    // Inserción en no_contactables
    const insertNoC = {
      candidato_id: candidatoId,
      hl_opportunity_id: oppId,
      etapa_actual: etapaActual,
      fecha_perdida: fechaPerdida.toISOString(),
      duenio_hl_id: duenioHlId ?? null,
      usuario_id: usuarioId,
      razon_perdida: razonPerdida ?? null
    }
    const { error: errNC } = await supabaseAdmin.from('no_contactables').insert([insertNoC])
    if (errNC) {
      console.error('Supabase insert no_contactables error', errNC)
      return NextResponse.json({ ok: false, error: errNC.message }, { status: 500 })
    }

    // Actualiza candidato (estado/etapa/fecha)
    const { error: errCand } = await supabaseAdmin
      .from('candidatos')
      .update({
        estado: 'PERDIDA',
        etapa_actual: etapaActual,
        stage_changed_at: fechaPerdida.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('hl_opportunity_id', oppId)
    if (errCand) console.error('Supabase update candidato error', errCand)

    // (Opcional) registra historial de etapas con source=WEBHOOK_HL
    if (candidatoId) {
      await supabaseAdmin.from('historial_etapas').insert([{
        candidato_id: candidatoId,
        hl_opportunity_id: oppId,
        etapa_origen: etapaActual,            // si quieres puedes leer la anterior, pero aquí anotamos la final
        etapa_destino: etapaActual,
        changed_at: fechaPerdida.toISOString(),
        source: 'WEBHOOK_HL',
        usuario_id: usuarioId
      }])
    }

    // Desasignar en HighLevel (para poder reasignar la base)
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