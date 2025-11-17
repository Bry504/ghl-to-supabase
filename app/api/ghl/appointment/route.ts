// app/api/ghl/contact-created/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin';

interface AppointmentPayloadClean {
  hl_contact_id: string;
  ghl_appointment_id: string;
  titulo: string | null;
  fecha_hora_inicio: string | null;
}

interface ContactRow {
  id: string; // contactos.id (uuid)
}

interface CandidateRow {
  id: string;              // candidatos.id (uuid)
  created_at: string;  // candidatos.created_at (timestamp)
}

interface CitaRowInsert {
  candidato_id: string;
  ghl_appointment_id: string;
  tipo: string | null;
  fecha_hora_inicio: string;
  created_at: string;
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

// Inferir tipo en base al título del appointment
function inferTipo(titulo: string | null): string | null {
  if (!titulo) return null;
  const t = titulo.toLowerCase();

  // PRESENTACIÓN si contiene "pres" o "ofi"
  if (t.includes('pres') || t.includes('ofi')) {
    return 'PRESENTACIÓN';
  }

  // VISITA PROYECTO si contiene "vis" o "proy"
  if (t.includes('vis') || t.includes('proy')) {
    return 'VISITA PROYECTO';
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');
    const expectedToken =
      process.env.GHL_APPOINTMENT_CREATED_TOKEN ??
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

    // 3) Extraer contact, appointment y customData si existen
    let contactObj: Record<string, unknown> = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contactObj = root['contact'] as Record<string, unknown>;
    }

    let appointmentObj: Record<string, unknown> = {};
    if ('appointment' in root && isRecord(root['appointment'])) {
      appointmentObj = root['appointment'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    // 4) Resolver hl_contact_id
    let hlContactId =
      getStringField(customData, 'hl_contact_id') ??
      getStringField(root, 'hl_contact_id');

    if (!hlContactId) {
      hlContactId =
        getStringField(contactObj, 'id') ??
        getStringField(root, 'contact_id');
    }

    if (!hlContactId) {
      console.error('Body sin hl_contact_id (appointment):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

    // 5) Resolver ghl_appointment_id
    let ghlAppointmentId =
      getStringField(customData, 'ghl_appointment_id') ??
      getStringField(root, 'ghl_appointment_id');

    if (!ghlAppointmentId) {
      ghlAppointmentId =
        getStringField(appointmentObj, 'id') ??
        getStringField(root, 'appointment_id');
    }

    if (!ghlAppointmentId) {
      console.error('Body sin ghl_appointment_id (appointment):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing ghl_appointment_id' },
        { status: 400 }
      );
    }

    // 6) Resolver título y fecha/hora de inicio
    const titulo =
      getStringField(customData, 'titulo') ??
      getStringField(appointmentObj, 'title');

    const fechaInicioRaw =
      getStringField(customData, 'fecha_hora_inicio') ??
      getStringField(appointmentObj, 'start_time') ??
      getStringField(appointmentObj, 'start');

    const cleaned: AppointmentPayloadClean = {
      hl_contact_id: hlContactId,
      ghl_appointment_id: ghlAppointmentId,
      titulo,
      fecha_hora_inicio: fechaInicioRaw
    };

    // 7) Buscar contacto_id en tabla contactos usando hl_contact_id
    const { data: contactRow, error: contactError } = await supabaseAdmin
      .from('contactos')
      .select<'id', ContactRow>('id')
      .eq('hl_contact_id', cleaned.hl_contact_id)
      .maybeSingle();

    if (contactError) {
      console.error(
        'Error buscando contacto por hl_contact_id (appointment):',
        contactError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: contactError.message },
        { status: 500 }
      );
    }

    if (!contactRow) {
      return NextResponse.json(
        {
          ok: false,
          error: 'contact_not_found',
          details: 'No contact found for that hl_contact_id'
        },
        { status: 404 }
      );
    }

    const contactoId = contactRow.id;

    // 8) Buscar la ÚLTIMA oportunidad (candidato) de ese contacto
    const { data: candidatoRow, error: candidatoError } = await supabaseAdmin
      .from('candidatos')
      .select<'id, created_at', CandidateRow>('id, created_at')
      .eq('contacto_id', contactoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (candidatoError) {
      console.error(
        'Error buscando último candidato por contacto_id (appointment):',
        candidatoError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: candidatoError.message },
        { status: 500 }
      );
    }

    if (!candidatoRow) {
      return NextResponse.json(
        {
          ok: false,
          error: 'candidate_not_found',
          details:
            'No candidate found for that contact. Cannot link appointment to candidato.'
        },
        { status: 404 }
      );
    }

    const candidatoId = candidatoRow.id;

    // 9) Inferir tipo según el título
    const tipo = inferTipo(cleaned.titulo);

    const nowIso = new Date().toISOString();
    const fechaInicioFinal = cleaned.fecha_hora_inicio ?? nowIso;

    // 🔟 Construir fila para insertar en citas_programadas
    const insertPayload: CitaRowInsert = {
      candidato_id: candidatoId,
      ghl_appointment_id: cleaned.ghl_appointment_id,
      tipo,
      fecha_hora_inicio: fechaInicioFinal,
      created_at: nowIso
    };

    const { data: insertData, error: insertError } = await supabaseAdmin
      .from('citas_programadas')
      .insert(insertPayload)
      .select('ghl_appointment_id')
      .single();

    if (insertError) {
      console.error(
        'Error insertando cita en citas_programadas (appointment):',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      candidato_id: candidatoId,
      contacto_id: contactoId,
      ghl_appointment_id: insertData.ghl_appointment_id,
      tipo
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/appointment:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}