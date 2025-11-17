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

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token en querystring
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

    // 2) Leer body sin usar any
    const rawBody: unknown = await req.json();

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    // 3) Resolver hl_contact_id desde varias posibles claves
    const hlContactIdFromRoot =
      getStringField(rawBody, 'hl_contact_id') ??
      getStringField(rawBody, 'contact_id') ??
      getStringField(rawBody, 'id');

    let hlContactId: string | null = hlContactIdFromRoot;

    if (!hlContactId && 'contact' in rawBody) {
      const contactObj = rawBody['contact'];
      if (isRecord(contactObj)) {
        hlContactId = getStringField(contactObj, 'id');
      }
    }

    if (!hlContactId) {
      // Logueamos lo que llegó para debug (sin romper tipos)
      console.error('Body sin hl_contact_id reconocible:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

    // 4) Extraer y limpiar campos opcionales
    const cleaned: ContactPayloadClean = {
      hl_contact_id: hlContactId,
      nombre_completo: getStringField(rawBody, 'nombre_completo'),
      celular: getStringField(rawBody, 'celular'),
      dni_ce: getStringField(rawBody, 'dni_ce'),
      estado_civil: getStringField(rawBody, 'estado_civil'),
      distrito_de_residencia: getStringField(
        rawBody,
        'distrito_de_residencia'
      ),
      profesion: getStringField(rawBody, 'profesion'),
      email: getStringField(rawBody, 'email'),
      fuente: getStringField(rawBody, 'fuente'),
      detalle: getStringField(rawBody, 'detalle'),
      sub_detalle: getStringField(rawBody, 'sub_detalle'),
      sub_sub_detalle: getStringField(rawBody, 'sub_sub_detalle'),
      sub_sub_sub_detalle: getStringField(rawBody, 'sub_sub_sub_detalle'),
      fecha_de_nacimiento: getStringField(rawBody, 'fecha_de_nacimiento')
    };

    // 5) Construir objeto para insertar en Supabase
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
      payloadToInsert.distrito_de_residencia =
        cleaned.distrito_de_residencia;
    }
    if (cleaned.profesion !== null) {
      payloadToInsert.profesion = cleaned.profesion;
    }
    if (cleaned.email !== null) {
      payloadToInsert.email = cleaned.email;
    }
    if (cleaned.fuente !== null) {
      // en tu BD la columna es fuente_id (FK a tabla fuente)
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
      // Asumimos formato YYYY-MM-DD que encaja en columna date
      payloadToInsert.fecha_de_nacimiento = cleaned.fecha_de_nacimiento;
    }

    // 6) Upsert en "contactos" usando hl_contact_id como clave única
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