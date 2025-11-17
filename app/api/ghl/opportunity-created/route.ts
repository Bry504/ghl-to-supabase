import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

interface OpportunityPayloadClean {
  hl_opportunity_id: string;
  hl_pipeline_id?: string | null;
  hl_contact_id?: string | null;
  hl_owner_id?: string | null;
  estado?: string | null;
  nivel_de_interes?: string | null;
  tipo_de_cliente?: string | null;
  producto?: string | null;
  proyecto?: string | null;
  modalidad_de_pago?: string | null;
}

interface CandidateRowInsert {
  hl_opportunity_id: string;
  hl_pipeline_id?: string | null;
  contacto_id?: string | null;    // uuid de contactos.id
  propietario_id?: string | null; // uuid de usuarios.id
  estado: string;
  nivel_de_interes?: string | null;
  tipo_de_cliente?: string | null;
  producto?: string | null;
  proyecto?: string | null;
  modalidad_de_pago?: string | null;
  fecha_creacion: string;
  updated_at: string;
}

interface ContactRow {
  id: string;
}

interface UserRow {
  id: string;
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

function mapEstado(raw: string | null): string {
  if (!raw) return 'ABIERTO';
  const t = raw.toLowerCase();

  if (t === 'open' || t === 'abierto') return 'ABIERTO';
  if (t === 'lost' || t === 'perdida' || t === 'perdido') return 'PERDIDA';
  if (t === 'abandoned' || t === 'abandonada' || t === 'abandonado') {
    return 'ABANDONADA';
  }

  return raw.toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');
    const expectedToken =
      process.env.GHL_OPPORTUNITY_CREATED_TOKEN ??
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

    // 3) Extraer objetos opportunity, contact y customData (por si HL los manda)
    let opportunityObj: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunityObj = root['opportunity'] as Record<string, unknown>;
    }

    let contactObj: Record<string, unknown> = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contactObj = root['contact'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    // 4) Resolver hl_opportunity_id
    let hlOpportunityId =
      getStringField(customData, 'hl_opportunity_id') ??
      getStringField(root, 'hl_opportunity_id');

    if (!hlOpportunityId) {
      hlOpportunityId =
        getStringField(opportunityObj, 'id') ??
        getStringField(root, 'opportunity_id');
    }

    if (!hlOpportunityId) {
      console.error('Body sin hl_opportunity_id reconocible:', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // 5) Leer el resto de campos desde customData (y fallback a opportunity/contact)
    const cleaned: OpportunityPayloadClean = {
      hl_opportunity_id: hlOpportunityId,
      hl_pipeline_id:
        getStringField(customData, 'hl_pipeline_id') ??
        getStringField(opportunityObj, 'pipelineId') ??
        getStringField(opportunityObj, 'pipeline_id'),
      hl_contact_id:
        getStringField(customData, 'hl_contact_id') ??
        getStringField(contactObj, 'id'),
      hl_owner_id:
        getStringField(customData, 'hl_owner_id') ??
        getStringField(opportunityObj, 'userId') ??
        getStringField(opportunityObj, 'user_id'),
      estado:
        getStringField(customData, 'estado') ??
        getStringField(opportunityObj, 'status'),
      nivel_de_interes: getStringField(customData, 'nivel_de_interes'),
      tipo_de_cliente: getStringField(customData, 'tipo_de_cliente'),
      producto: getStringField(customData, 'producto'),
      proyecto: getStringField(customData, 'proyecto'),
      modalidad_de_pago: getStringField(customData, 'modalidad_de_pago')
    };

    // 6) Resolver contacto_id (uuid en tu tabla contactos)
    let contactoId: string | null = null;

    if (cleaned.hl_contact_id) {
      const { data: contactRow, error: contactError } = await supabaseAdmin
        .from('contactos')
        .select<'id', ContactRow>('id')
        .eq('hl_contact_id', cleaned.hl_contact_id)
        .maybeSingle();

      if (contactError) {
        console.error('Error buscando contacto por hl_contact_id:', contactError);
      } else if (contactRow) {
        contactoId = contactRow.id;
      }
    }

    // 7) Resolver propietario_id (uuid en tabla usuarios, usando usuarios.ghl_id)
    let propietarioId: string | null = null;

    if (cleaned.hl_owner_id) {
      const { data: userRow, error: userError } = await supabaseAdmin
        .from('usuarios')
        .select<'id', UserRow>('id')
        .eq('ghl_id', cleaned.hl_owner_id)
        .maybeSingle();

      if (userError) {
        console.error('Error buscando usuario por ghl_id:', userError);
      } else if (userRow) {
        propietarioId = userRow.id;
      }
    }

    const estadoFinal = mapEstado(cleaned.estado ?? null);

    // 8) Construir fila para insertar en "candidatos"
    const nowIso = new Date().toISOString();

    const insertPayload: CandidateRowInsert = {
      hl_opportunity_id: cleaned.hl_opportunity_id,
      hl_pipeline_id: cleaned.hl_pipeline_id ?? null,
      contacto_id: contactoId ?? null,        // asegúrate de que en la BD pueda ser NULL
      propietario_id: propietarioId ?? null,  // idem
      estado: estadoFinal,
      nivel_de_interes: cleaned.nivel_de_interes ?? null,
      tipo_de_cliente: cleaned.tipo_de_cliente ?? null,
      producto: cleaned.producto ?? null,
      proyecto: cleaned.proyecto ?? null,
      modalidad_de_pago: cleaned.modalidad_de_pago ?? null,
      fecha_creacion: nowIso,
      updated_at: nowIso
    };

    const { data, error } = await supabaseAdmin
      .from('candidatos')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      console.error('Error insertando candidato (opportunity-created):', error);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      candidato_id: data.id,
      contacto_id: contactoId,
      propietario_id: propietarioId
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/opportunity-created:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}