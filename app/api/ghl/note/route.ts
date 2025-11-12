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
  const fields = [
    'changedAt','changed_at','createdAt','created_at',
    'timestamp','data.timestamp','customData.timestamp'
  ]
  for (const p of fields) {
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
    console.log('[GHL note body]', JSON.stringify(body))

    // 1) Datos principales
    const hlOpportunityId =
      S(body, 'customData.opportunityId') ?? S(body, 'opportunityId') ??
      S(body, 'opportunity.id') ?? S(body, 'data.opportunity.id')

    let notaTexto =
      S(body, 'note') ?? S(body, 'customData.note') ?? S(body, 'data.note') ??
      S(body, 'nota') ?? S(body, 'customData.nota') ?? S(body, 'data.nota')

    // Si viene como objeto note.body
    if (!notaTexto) {
      notaTexto = S(body, 'note.body') ?? S(body, 'data.note.body')
    }

    const userGhlId =
      S(body, 'customData.userGhlId') ?? S(body, 'userGhlId') ??
      S(body, 'opportunity.updatedBy') ?? S(body, 'data.opportunity.updatedBy')

    const changedAt = resolveDate(body)

    if (!notaTexto) {
      return NextResponse.json({ error: 'Missing note' }, { status: 400 })
    }

    // 2) Resolver candidato
    let candidatoId: string | null = null
    let etapaActual: string | undefined

    // 2A: por opportunityId (ideal)
    if (hlOpportunityId) {
      const { data: candByOpp } = await supabaseAdmin
        .from('candidatos')
        .select('id, etapa_actual')
        .eq('hl_opportunity_id', hlOpportunityId)
        .maybeSingle()
      if (candByOpp?.id) {
        candidatoId = candByOpp.id
        etapaActual = candByOpp.etapa_actual ?? etapaActual
      }
    }

    // 2B: plan B por contacto/email/phone si no hubo opportunityId
    if (!candidatoId) {
      const contactId = S(body, 'contact_id') ?? S(body, 'data.contact_id')
      const email = S(body, 'email') ?? S(body, 'contact.email') ?? S(body, 'data.contact.email')
      // En HL suele venir con +51..., normaliza solo para comparar simple
      let phone = S(body, 'phone') ?? S(body, 'contact.phone') ?? S(body, 'data.contact.phone')
      if (phone) phone = phone.replace(/\s+/g, '')

      if (email || phone) {
        // Busca por email o celular (último creado primero)
        const { data: candList } = await supabaseAdmin
          .from('candidatos')
          .select('id, etapa_actual, email, celular')
          .or([
            email ? `email.eq.${email}` : '',
            phone ? `celular.eq.${phone}` : ''
          ].filter(Boolean).join(','))
          .order('created_at', { ascending: false })
          .limit(1)

        if (candList && candList.length > 0) {
          candidatoId = candList[0].id
          etapaActual = candList[0].etapa_actual ?? etapaActual
        }
      }

      // Si no hay email/phone pero sí contactId, podrías tenerlo guardado en otra tabla;
      // por ahora lo dejamos como último fallback sin resolver.
      if (!candidatoId && contactId) {
        console.warn('No opportunityId. Received contact_id but no resolver is configured.')
      }
    }

    if (!candidatoId) {
      return NextResponse.json({ error: 'Candidato no encontrado (no opportunityId y no match por email/phone)' }, { status: 404 })
    }

    // 3) Mapear usuario
    let usuarioId: string | null = null
    if (userGhlId) {
      const { data: usr } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', userGhlId)
        .maybeSingle()
      usuarioId = usr?.id ?? null
    }

    // 4) Insertar nota
    const { error } = await supabaseAdmin.from('notas').insert([{
      candidato_id: candidatoId,
      usuario_id: usuarioId,
      nota: notaTexto,
      etapa_registro: etapaActual ?? 'Sin etapa',
      changed_at: changedAt.toISOString()
    }])

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