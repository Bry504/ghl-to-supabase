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

interface ContactRowUpdate {
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
      process.env.GHL_CONTACT_MODIFIED_TOKEN ??
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

    // 3) Sacar contact y customData
    let contactObj: Record<string, unknown> = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contactObj = root['contact'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    // 4) Resolver hl_contact_id
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
      console.error('Body sin hl_contact_id reconocible (modified):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

    // 5) Extraer campos igual que en contact-created (con alias)
    const cleaned: ContactPayloadClean = {
      hl_contact_id: hlContactId,
      nombre_completo: getFromSources(
        'nombre_completo',
        ['nombre_comp'],
        root,
        customData
      ),
      celular: getFromSources('celular', ['phone'], root, customData),
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

    // 6) Construir payload de UPDATE
    const payloadToUpdate: ContactRowUpdate = {
      updated_at: new Date().toISOString()
    };

    if (cleaned.nombre_completo !== null) {
      payloadToUpdate.nombre_completo = cleaned.nombre_completo;
    }
    if (cleaned.celular !== null) {
      payloadToUpdate.celular = cleaned.celular;
    }
    if (cleaned.dni_ce !== null) {
      payloadToUpdate.dni_ce = cleaned.dni_ce;
    }
    if (cleaned.estado_civil !== null) {
      payloadToUpdate.estado_civil = cleaned.estado_civil;
    }
    if (cleaned.distrito_de_residencia !== null) {
      payloadToUpdate.distrito_de_residencia = cleaned.distrito_de_residencia;
    }
    if (cleaned.profesion !== null) {
      payloadToUpdate.profesion = cleaned.profesion;
    }
    if (cleaned.email !== null) {
      payloadToUpdate.email = cleaned.email;
    }
    if (cleaned.fuente !== null) {
      payloadToUpdate.fuente_id = cleaned.fuente;
    }
    if (cleaned.detalle !== null) {
      payloadToUpdate.detalle = cleaned.detalle;
    }
    if (cleaned.sub_detalle !== null) {
      payloadToUpdate.sub_detalle = cleaned.sub_detalle;
    }
    if (cleaned.sub_sub_detalle !== null) {
      payloadToUpdate.sub_sub_detalle = cleaned.sub_sub_detalle;
    }
    if (cleaned.sub_sub_sub_detalle !== null) {
      payloadToUpdate.sub_sub_sub_detalle = cleaned.sub_sub_sub_detalle;
    }
    if (cleaned.fecha_de_nacimiento !== null) {
      payloadToUpdate.fecha_de_nacimiento = cleaned.fecha_de_nacimiento;
    }

    // Si solo vino hl_contact_id y ningún otro campo, no tiene sentido actualizar
    const keysToUpdate = Object.keys(payloadToUpdate).filter(
      (k) => k !== 'updated_at'
    );
    if (keysToUpdate.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'Nothing to update'
      });
    }

    // 7) UPDATE en lugar de UPSERT
    const { data, error } = await supabaseAdmin
      .from('contactos')
      .update(payloadToUpdate)
      .eq('hl_contact_id', hlContactId)
      .select('id');

    if (error) {
      console.error('Error updating contacto (modified):', error);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      // No había contacto con ese hl_contact_id (no creamos nada)
      return NextResponse.json({
        ok: false,
        error: 'not_found',
        details: 'No contact found with that hl_contact_id'
      });
    }

    return NextResponse.json({
      ok: true,
      contacto_id: data[0].id
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/contact-modified:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}