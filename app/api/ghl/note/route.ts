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
    'changedAt','changed_at','createdAt','created_at',
    'timestamp','data.timestamp','customData.timestamp'
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
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({} as unknown))
    console.log('[GHL note body]', JSON.stringify(body))

    // === SOLO CONTACT ID ===
    const hlContactId =
      S(body, 'customData.contactId') ??
      S(body, 'contact.id') ??
      S(body, 'data.contact.id') ??
      S(body, 'contact_id') ??
      S(body, 'data.contact_id')

    const notaTexto =
      S(body, 'note') ??
      S(body, 'customData.note') ??
      S(body, 'data.note') ??
      S(body, 'nota') ??
      S(body, 'customData.nota') ??
      S(body, 'data.nota') ??
      S(body, 'note.body') ??
      S(body, 'data.note.body')

    const userGhlId =
      S(body, 'customData.userGhlId') ??
      S(body, 'userGhlId') ??
      S(body, 'opportunity.updatedBy') ??
      S(body, 'data.opportunity.updatedBy')

    const changedAt = resolveDate(body)

    if (!notaTexto) {
      return NextResponse.json({ error: 'Missing note' }, { status: 400 })
    }
    if (!hlContactId) {
      // Falta el ID clave para amarrar la nota al candidato
      return NextResponse.json({ error: 'Missing contactId' }, { status: 400 })
    }

    // === Resolver candidato estrictamente por contactId ===
    const { data: cand } = await supabaseAdmin
      .from('candidatos')
      .select('id, etapa_actual')
      .eq('hl_contact_id', hlContactId)
      .maybeSingle()

    if (!cand?.id) {
      console.warn('note: candidate not found by hl_contact_id=', hlContactId)
      // No rompas el workflow de GHL:
      return NextResponse.json({ ok: true, skipped: 'candidate-not-found-by-contactId' }, { status: 202 })
    }

    // Mapear usuario (opcional)
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
    const { error } = await supabaseAdmin.from('notas').insert([{
      candidato_id: cand.id,
      usuario_id: usuarioId,
      nota: notaTexto,
      etapa_registro: cand.etapa_actual ?? 'Sin etapa',
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