// app/api/ghl/contact-created/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin';

type ContactPayload = {
  hl_contact_id?: string;
  nombre_completo?: string;
  celular?: string;
  dni_ce?: string;
  estado_civil?: string;
  distrito_de_residencia?: string;
  profesion?: string;
  email?: string;
  fuente?: string;
  detalle?: string;
  sub_detalle?: string;
  sub_sub_detalle?: string;
  sub_sub_sub_detalle?: string;
  fecha_de_nacimiento?: string; // la mandamos como string (YYYY-MM-DD)
};

// helper para strings vacíos -> null
const clean = (value?: string | null) => {
  if (!value) return null;
  const t = value.trim();
  return t === '' ? null : t;
};

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token de querystring
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    const EXPECTED_TOKEN =
      process.env.GHL_CONTACT_CREATED_TOKEN ??
      'pit-18b2740c-0b32-40a1-8624-1148633a0f15'; // opcionalmente lo pones en env

    if (!token || token !== EXPECTED_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: invalid token' },
        { status: 401 }
      );
    }

    // 2) Leer body
    const body = (await req.json()) as ContactPayload;

    if (!body.hl_contact_id) {
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

    // 3) Preparar datos para Supabase
    const payloadToInsert: Record<string, unknown> = {
      hl_contact_id: clean(body.hl_contact_id),
      nombre_completo: clean(body.nombre_completo),
      celular: clean(body.celular),
      dni_ce: clean(body.dni_ce),
      estado_civil: clean(body.estado_civil),
      distrito_de_residencia: clean(body.distrito_de_residencia),
      profesion: clean(body.profesion),
      email: clean(body.email),
      fuente_id: clean(body.fuente), // si tu columna se llama "fuente" cambia aquí
      detalle: clean(body.detalle),
      sub_detalle: clean(body.sub_detalle),
      sub_sub_detalle: clean(body.sub_sub_detalle),
      sub_sub_sub_detalle: clean(body.sub_sub_sub_detalle),
      updated_at: new Date().toISOString()
    };

    // fecha de nacimiento (tipo date en Supabase)
    if (body.fecha_de_nacimiento) {
      // confío en que viene YYYY-MM-DD; si no, la limpias antes en HL
      payloadToInsert.fecha_de_nacimiento = body.fecha_de_nacimiento;
    }

    // 4) Upsert en tabla "contactos" usando hl_contact_id como clave única
    const { data, error } = await supabaseAdmin
      .from('contactos')
      .upsert(payloadToInsert, {
        onConflict: 'hl_contact_id',
        ignoreDuplicates: false
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error upserting contacto', error);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, contacto_id: data.id });
  } catch (err) {
    console.error('Unexpected error in /contact-created', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}