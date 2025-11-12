import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

type Dict = Record<string, unknown>

function isObj(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null
}

function get(obj: unknown, path: string): unknown {
  if (!isObj(obj)) return undefined
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (!isObj(cur)) return undefined
    cur = (cur as Dict)[key]
  }
  return cur
}

function getStr(obj: unknown, path: string): string | undefined {
  const v = get(obj, path)
  if (typeof v === 'string') {
    const s = v.trim()
    return s ? s : undefined
  }
  return undefined
}

function getNum(obj: unknown, path: string): number | undefined {
  const v = get(obj, path)
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function join2(a?: string, b?: string): string | undefined {
  const s = `${a ?? ''} ${b ?? ''}`.trim()
  return s ? s : undefined
}

function resolveFullName(body: unknown): string {
  const top =
    getStr(body, 'fullName') ??
    getStr(body, 'full_name') ??
    getStr(body, 'name') ??
    join2(getStr(body, 'firstName'), getStr(body, 'lastName')) ??
    join2(getStr(body, 'firstname'), getStr(body, 'lastName')) ??
    join2(getStr(body, 'first_name'), getStr(body, 'last_name'))
  if (top) return top

  const fromData =
    getStr(body, 'data.fullName') ??
    getStr(body, 'data.full_name') ??
    getStr(body, 'data.name') ??
    join2(getStr(body, 'data.firstName'), getStr(body, 'data.lastName')) ??
    join2(getStr(body, 'data.first_name'), getStr(body, 'data.last_name'))
  if (fromData) return fromData

  const contact =
    getStr(body, 'contact.name') ??
    getStr(body, 'contact.fullName') ??
    getStr(body, 'contact.full_name') ??
    join2(getStr(body, 'contact.firstName'), getStr(body, 'contact.lastName')) ??
    join2(getStr(body, 'contact.first_name'), getStr(body, 'contact.last_name'))
  if (contact) return contact

  const title =
    getStr(body, 'title') ??
    getStr(body, 'opportunity.title') ??
    getStr(body, 'data.opportunity.title')
  return title ?? 'Sin nombre'
}

function resolveCreatedAt(body: unknown): Date {
  const candidates = [
    'createdAt', 'created_at',
    'data.createdAt', 'data.created_at',
    'customData.createdAt', 'customData.created_at',
    'opportunity.createdAt', 'opportunity.created_at',
    'data.opportunity.createdAt', 'data.opportunity.created_at',
    'contact.date_added'
  ]
  for (const p of candidates) {
    const n = getNum(body, p)
    if (typeof n === 'number' && String(n).length >= 12) {
      const d = new Date(n)
      if (!Number.isNaN(d.getTime())) return d
    }
    const s = getStr(body, p)
    if (s) {
      const d = new Date(s)
      if (!Number.isNaN(d.getTime())) return d
    }
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
    console.log('[GHL webhook body]', JSON.stringify(body))

    const nombre = resolveFullName(body)
    const fecha = resolveCreatedAt(body)
    const S = (p: string) => getStr(body, p)

    const celular =
      S('phone') ?? S('customData.phone') ?? S('contact.phone') ?? S('data.contact.phone')
    const email =
      S('email') ?? S('customData.email') ?? S('contact.email') ?? S('data.contact.email')
    const dni_ce =
      S('dni_ce') ??
      S('customData.dni_ce') ??
      S('contact.documento_de_identidad') ??
      S('data.contact.documento_de_identidad')
    const canal =
      S('canal') ?? S('customData.canal') ?? S('opportunity.canal') ?? S('data.opportunity.canal')
    const fuente_del_candidato =
      S('fuente_del_candidato') ??
      S('customData.fuente_del_candidato') ??
      S('opportunity.fuente_del_candidato') ??
      S('data.opportunity.fuente_del_candidato')
    const estado =
      S('estado') ??
      S('customData.estado') ??
      S('opportunity.status') ??
      S('data.opportunity.status')
    const etapa_actual =
      S('etapa_actual') ??
      S('customData.etapa_actual') ??
      S('opportunity.stage_name') ??
      S('opportunity.stageName') ??
      S('data.opportunity.stage_name') ??
      S('data.opportunity.stageName')
    const hl_opportunity_id =
      S('hl_opportunity_id') ??
      S('customData.hl_opportunity_id') ??
      S('opportunityId') ??
      S('opportunity.id') ??
      S('data.opportunity.id')
    const hl_pipeline_id =
      S('hl_pipeline_id') ??
      S('customData.hl_pipeline_id') ??
      S('pipelineId') ??
      S('opportunity.pipeline_id') ??
      S('data.opportunity.pipeline_id')
    const ownerGhlId =
      S('propietario') ??
      S('customData.propietario') ??
      S('opportunity.assignedTo') ??
      S('data.opportunity.assignedTo')

    let propietario_id: string | null = null
    if (ownerGhlId) {
      const { data: ownerRow } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', ownerGhlId)
        .maybeSingle()
      propietario_id = ownerRow?.id ?? null
    }

    const row = {
      nombre_completo: nombre,
      fecha_creacion: fecha.toISOString(),
      celular: celular ?? null,
      dni_ce: dni_ce ?? null,
      email: email ?? null,
      canal: canal ?? null,
      fuente_del_candidato: fuente_del_candidato ?? null,
      estado: estado ?? null,
      etapa_actual: etapa_actual ?? null,
      hl_opportunity_id: hl_opportunity_id ?? null,
      hl_pipeline_id: hl_pipeline_id ?? null,
      propietario_id,
      updated_at: new Date().toISOString(),
    }

    if (hl_opportunity_id) {
      const { error } = await supabaseAdmin
        .from('candidatos')
        .upsert(row, { onConflict: 'hl_opportunity_id', ignoreDuplicates: false })
      if (error) {
        console.error('Supabase upsert error', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }
    }

    // ---- Previene duplicado en historial ----
    if (hl_opportunity_id && etapa_actual) {
      const { data: already } = await supabaseAdmin
        .from('historial_etapas')
        .select('id')
        .eq('hl_opportunity_id', hl_opportunity_id)
        .limit(1)

      if (!already || already.length === 0) {
        const { data: candRow } = await supabaseAdmin
          .from('candidatos')
          .select('id')
          .eq('hl_opportunity_id', hl_opportunity_id)
          .maybeSingle()

        if (candRow?.id) {
          await supabaseAdmin.from('historial_etapas').insert([{
            candidato_id: candRow.id,
            hl_opportunity_id,
            etapa_origen: null,
            etapa_destino: etapa_actual,
            changed_at: fecha.toISOString(),
            source: 'SISTEMA',
            usuario_id: propietario_id
          }])
        }
      }
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