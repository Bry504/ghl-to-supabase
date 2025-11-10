import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

// ----------------------- helpers tipados (sin any) -----------------------

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
  // 1) Top-level / custom data comunes
  const top =
    getStr(body, 'fullName') ??
    getStr(body, 'full_name') ??
    getStr(body, 'name') ??
    join2(getStr(body, 'firstName'), getStr(body, 'lastName')) ??
    join2(getStr(body, 'first_name'), getStr(body, 'last_name'))
  if (top) return top

  // 2) data.*
  const fromData =
    getStr(body, 'data.fullName') ??
    getStr(body, 'data.full_name') ??
    getStr(body, 'data.name') ??
    join2(getStr(body, 'data.firstName'), getStr(body, 'data.lastName')) ??
    join2(getStr(body, 'data.first_name'), getStr(body, 'data.last_name'))
  if (fromData) return fromData

  // 3) customData.*
  const fromCustomData =
    getStr(body, 'customData.fullName') ??
    getStr(body, 'customData.full_name') ??
    getStr(body, 'customData.name') ??
    join2(getStr(body, 'customData.firstName'), getStr(body, 'customData.lastName')) ??
    join2(getStr(body, 'customData.first_name'), getStr(body, 'customData.last_name'))
  if (fromCustomData) return fromCustomData

  // 4) contact.* (en cualquiera de los contenedores)
  const fromContact =
    getStr(body, 'contact.name') ??
    getStr(body, 'contact.fullName') ??
    getStr(body, 'contact.full_name') ??
    join2(getStr(body, 'contact.firstName'), getStr(body, 'contact.lastName')) ??
    join2(getStr(body, 'contact.first_name'), getStr(body, 'contact.last_name')) ??
    getStr(body, 'data.contact.name') ??
    getStr(body, 'customData.contact.name')
  if (fromContact) return fromContact

  // 5) Fallback: título de la oportunidad
  const title =
    getStr(body, 'title') ??
    getStr(body, 'opportunity.title') ??
    getStr(body, 'data.opportunity.title') ??
    getStr(body, 'customData.opportunity.title')
  if (title) return title

  return 'Sin nombre'
}

function resolveCreatedAt(body: unknown): Date {
  // prueba varios lugares y formatos (epoch ms / ISO / date_added)
  const candidatesStr = [
    'createdAt', 'created_at',
    'data.createdAt', 'data.created_at',
    'customData.createdAt', 'customData.created_at',
    'opportunity.createdAt', 'opportunity.created_at',
    'data.opportunity.createdAt', 'data.opportunity.created_at',
    'contact.date_added', 'data.contact.date_added'
  ]

  for (const p of candidatesStr) {
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

// ----------------------- handlers -----------------------

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== process.env.GHL_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({} as unknown))

    // (opcional) log para inspeccionar payload real en Vercel Logs
    console.log('[GHL webhook body]', JSON.stringify(body))

    const nombre = resolveFullName(body)
    const fecha = resolveCreatedAt(body)

    const { error } = await supabaseAdmin
      .from('candidatos')
      .insert([{ nombre_completo: nombre, fecha_creacion: fecha.toISOString() }])

    if (error) {
      console.error('Supabase insert error', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, nombre })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}