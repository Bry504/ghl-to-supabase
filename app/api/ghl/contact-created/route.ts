// app/api/ghl/contact-created/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin';

interface ContactPayloadClean {
  hl_contact_id: string;
  nombre_completo?: string | null;
  celular?: string | null;
  dni_ce?: string | null;
  estado_civil?: string | null;
  distrito_de_residencia?: string | null;
  profesion?: string | null;
  email?: string | null;
  fuente?: string | null;
  detalle?: string | null;
  sub_detalle?: string | null;
  sub_sub_detalle?: string | null;
  sub_sub_sub_detalle?: string | null;
  fecha_de_nacimiento?: string | null;
}

interface ContactRowInsert {
  hl_contact_id: string;
  nombre_completo?: string | null;
  celular?: string | null;
  dni_ce?: string | null;
  estado_civil?: string | null;
  distrito_de_residencia?: string | null;
  profesion?: string | null;
  email?: string | null;
  fuente_id?: string | null;
  detalle?: string | null;
  sub_detalle?: string | null;
  sub_sub_detalle?: string | null;
  sub_sub_sub_detalle?: string | null;
  fecha_de_nacimiento?: string | null;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(
  obj: Record<string, unknown>,
  key: string
): string | null {
  const value = obj[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

// Busca en customData y luego en root, con alias
function getFromSources(
  primary: string,
  aliases: string[],
  root: Record<string, unknown>,
  custom: Record<string, unknown>
): string | null {
  let value = getStringField(custom, primary);
  if (value !== null) return value;

  value = getStringField(root, primary);
  if (value !== null) return value;

  for (const alias of aliases) {
    value = getStringField(custom, alias) ?? getStringField(root, alias);
    if (value !== null) return value;
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');
    const expectedToken =
      process.env.GHL_CONTACT_CREATED_TOKEN ??
      'pit-18b2740c-0b32-40a1-8624-1148633a0f15';

    if (!tokenFromQuery || tokenFromQuery !== expectedToken) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: invalid token' },
        { status: 401 }
      );
    }

    // 2) Leer body
    const rawBody: unknown = await req.json();
    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // 3) Extraer contact y customData
    let contactObj: Record<string, unknown> = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contactObj = root['contact'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    // 4) Resolver hl_contact_id (id de HL)
    const hlContactIdFromRoot =
      getStringField(root, 'hl_contact_id') ??
      getStringField(root, 'contact_id') ??
      getStringField(root, 'id');

    let hlContactId: string | null = hlContactIdFromRoot;

    if (!hlContactId) {
      hlContactId =
        getStringField(contactObj, 'id') ??
        getStringField(customData, 'hl_contact_id');
    }

    if (!hlContactId) {
      console.error('Body sin hl_contact_id reconocible:', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

    // 5) Extraer campos con alias (nombres abreviados de tu workflow)
    const cleaned: ContactPayloadClean = {
      hl_contact_id: hlContactId,
      nombre_completo: getFromSources(
        'nombre_completo',
        ['nombre_comp'],
        root,
        customData
      ),
      celular: getFromSources(
        'celular',
        ['phone'],
        root,
        customData
      ),
      dni_ce: getFromSources('dni_ce', [], root, customData),
      estado_civil: getFromSources('estado_civil', [], root, customData),
      distrito_de_residencia: getFromSources(
        'distrito_de_residencia',
        ['distrito_de_res'],
        root,
        customData
      ),
      profesion: getFromSources('profesion', [], root, customData),
      email: getFromSources('email', [], root, customData),
      fuente: getFromSources('fuente', [], root, customData),
      detalle: getFromSources('detalle', [], root, customData),
      sub_detalle: getFromSources('sub_detalle', [], root, customData),
      sub_sub_detalle: getFromSources(
        'sub_sub_detalle',
        ['sub_sub_detal'],
        root,
        customData
      ),
      sub_sub_sub_detalle: getFromSources(
        'sub_sub_sub_detalle',
        ['sub_sub_sub_'],
        root,
        customData
      ),
      fecha_de_nacimiento: getFromSources(
        'fecha_de_nacimiento',
        ['fecha_de_naci'],
        root,
        customData
      )
    };

    // 6) Construir payload para Supabase
    const payloadToInsert: ContactRowInsert = {
      hl_contact_id: cleaned.hl_contact_id,
      updated_at: new Date().toISOString()
    };

    if (cleaned.nombre_completo !== null) {
      payloadToInsert.nombre_completo = cleaned.nombre_completo;
    }
    if (cleaned.celular !== null) {
      payloadToInsert.celular = cleaned.celular;
    }
    if (cleaned.dni_ce !== null) {
      payloadToInsert.dni_ce = cleaned.dni_ce;
    }
    if (cleaned.estado_civil !== null) {
      payloadToInsert.estado_civil = cleaned.estado_civil;
    }
    if (cleaned.distrito_de_residencia !== null) {
      payloadToInsert.distrito_de_residencia = cleaned.distrito_de_residencia;
    }
    if (cleaned.profesion !== null) {
      payloadToInsert.profesion = cleaned.profesion;
    }
    if (cleaned.email !== null) {
      payloadToInsert.email = cleaned.email;
    }
    if (cleaned.fuente !== null) {
      // si tu columna se llama "fuente" en vez de "fuente_id", cámbialo aquí
      payloadToInsert.fuente_id = cleaned.fuente;
    }
    if (cleaned.detalle !== null) {
      payloadToInsert.detalle = cleaned.detalle;
    }
    if (cleaned.sub_detalle !== null) {
      payloadToInsert.sub_detalle = cleaned.sub_detalle;
    }
    if (cleaned.sub_sub_detalle !== null) {
      payloadToInsert.sub_sub_detalle = cleaned.sub_sub_detalle;
    }
    if (cleaned.sub_sub_sub_detalle !== null) {
      payloadToInsert.sub_sub_sub_detalle = cleaned.sub_sub_sub_detalle;
    }
    if (cleaned.fecha_de_nacimiento !== null) {
      payloadToInsert.fecha_de_nacimiento = cleaned.fecha_de_nacimiento;
    }

    // 7) Upsert en "contactos"
    const { data, error } = await supabaseAdmin
      .from('contactos')
      .upsert(payloadToInsert, {
        onConflict: 'hl_contact_id',
        ignoreDuplicates: false
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error upserting contacto:', error);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, contacto_id: data.id });
  } catch (err) {
    console.error('Unexpected error in /ghl/contact-created:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}