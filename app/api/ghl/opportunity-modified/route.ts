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

interface CandidateRowUpdate {
  hl_pipeline_id?: string | null;
  contacto_id?: string | null;
  propietario_id?: string | null;
  estado?: string;
  nivel_de_interes?: string | null;
  tipo_de_cliente?: string | null;
  producto?: string | null;
  proyecto?: string | null;
  modalidad_de_pago?: string | null;
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

function mapEstado(raw: string | null): string | null {
  if (!raw) return null;
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
      process.env.GHL_OPPORTUNITY_MODIFIED_TOKEN ??
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

    // 3) Extraer opportunity, contact y customData (si vienen)
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
      console.error('Body sin hl_opportunity_id reconocible (modified):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // 5) Limpiar los campos que vienen del webhook
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

    // 6) Resolver contacto_id (uuid en contactos) si manda hl_contact_id
    let contactoId: string | null = null;

    if (cleaned.hl_contact_id) {
      const { data: contactRow, error: contactError } = await supabaseAdmin
        .from('contactos')
        .select<'id', ContactRow>('id')
        .eq('hl_contact_id', cleaned.hl_contact_id)
        .maybeSingle();

      if (contactError) {
        console.error('Error buscando contacto por hl_contact_id (modified):', contactError);
      } else if (contactRow) {
        contactoId = contactRow.id;
      }
    }

    // 7) Resolver propietario_id (uuid en usuarios) si manda hl_owner_id
    let propietarioId: string | null = null;

    if (cleaned.hl_owner_id) {
      const { data: userRow, error: userError } = await supabaseAdmin
        .from('usuarios')
        .select<'id', UserRow>('id')
        .eq('ghl_id', cleaned.hl_owner_id)
        .maybeSingle();

      if (userError) {
        console.error('Error buscando usuario por ghl_id (modified):', userError);
      } else if (userRow) {
        propietarioId = userRow.id;
      }
    }

    const estadoFinal = mapEstado(cleaned.estado ?? null);

    // 8) Construir payload de UPDATE solo con lo que hay que actualizar
    const nowIso = new Date().toISOString();

    const updatePayload: CandidateRowUpdate = {
      updated_at: nowIso
    };

    if (cleaned.hl_pipeline_id !== null && cleaned.hl_pipeline_id !== undefined) {
      updatePayload.hl_pipeline_id = cleaned.hl_pipeline_id;
    }

    if (contactoId !== null) {
      updatePayload.contacto_id = contactoId;
    }

    if (propietarioId !== null) {
      updatePayload.propietario_id = propietarioId;
    }

    if (estadoFinal !== null) {
      updatePayload.estado = estadoFinal;
    }

    if (cleaned.nivel_de_interes !== null && cleaned.nivel_de_interes !== undefined) {
      updatePayload.nivel_de_interes = cleaned.nivel_de_interes;
    }

    if (cleaned.tipo_de_cliente !== null && cleaned.tipo_de_cliente !== undefined) {
      updatePayload.tipo_de_cliente = cleaned.tipo_de_cliente;
    }

    if (cleaned.producto !== null && cleaned.producto !== undefined) {
      updatePayload.producto = cleaned.producto;
    }

    if (cleaned.proyecto !== null && cleaned.proyecto !== undefined) {
      updatePayload.proyecto = cleaned.proyecto;
    }

    if (
      cleaned.modalidad_de_pago !== null &&
      cleaned.modalidad_de_pago !== undefined
    ) {
      updatePayload.modalidad_de_pago = cleaned.modalidad_de_pago;
    }

    // Si lo único que viene es el updated_at, igual lo actualizamos
    const keysToUpdate = Object.keys(updatePayload);
    if (keysToUpdate.length === 1 && keysToUpdate[0] === 'updated_at') {
      // Nada relevante que actualizar, pero igual devolvemos OK
      const { error: existsError } = await supabaseAdmin
        .from('candidatos')
        .select('id')
        .eq('hl_opportunity_id', hlOpportunityId)
        .limit(1);

      if (existsError) {
        console.error('Error comprobando existencia de candidato:', existsError);
      }

      // No forzamos error, simplemente OK
      return NextResponse.json({
        ok: true,
        message: 'Nothing to update besides updated_at'
      });
    }

    // 9) UPDATE en la fila de candidatos que tenga ese hl_opportunity_id
    const { data, error } = await supabaseAdmin
      .from('candidatos')
      .update(updatePayload)
      .eq('hl_opportunity_id', hlOpportunityId)
      .select('id');

    if (error) {
      console.error('Error actualizando candidato (opportunity-modified):', error);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'not_found',
          details: 'No candidate found with that hl_opportunity_id'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      candidato_id: data[0].id,
      contacto_id: contactoId,
      propietario_id: propietarioId
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/opportunity-modified:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}