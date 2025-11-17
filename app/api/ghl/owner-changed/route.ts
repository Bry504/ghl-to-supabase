import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

interface OwnerChangePayloadClean {
  hl_opportunity_id: string;
  nuevo_propietario_hl_id: string;
  changed_by_hl_id: string;
}

interface CandidatoRow {
  id: string;
  propietario_id: string | null;
}

interface UsuarioByIdRow {
  id: string;
  ghl_id: string | null;
}

interface UsuarioByGhlRow {
  id: string;
}

interface ReasignacionInsert {
  candidato_id: string;
  propietario_anterior: string | null;
  propietario_actual: string;
  changed_by: string;
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

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');
    const expectedToken =
      process.env.GHL_OWNER_CHANGE_TOKEN ??
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

    // 3) Extraer customData si existe
    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    // 4) Resolver campos limpios
    const hlOpportunityId =
      getStringField(customData, 'hl_opportunity_id') ??
      getStringField(root, 'hl_opportunity_id');

    const nuevoPropietarioHlId =
      getStringField(customData, 'propietario_id') ??
      getStringField(root, 'propietario_id');

    const changedByHlId =
      getStringField(customData, 'changed_by') ??
      getStringField(root, 'changed_by');

    if (!hlOpportunityId || !nuevoPropietarioHlId || !changedByHlId) {
      console.error('Payload incompleto (owner-change):', root);
      return NextResponse.json(
        {
          ok: false,
          error: 'missing_fields',
          details:
            'hl_opportunity_id, propietario_id y changed_by son obligatorios'
        },
        { status: 400 }
      );
    }

    const cleaned: OwnerChangePayloadClean = {
      hl_opportunity_id: hlOpportunityId,
      nuevo_propietario_hl_id: nuevoPropietarioHlId,
      changed_by_hl_id: changedByHlId
    };

    // 5) Buscar candidato por hl_opportunity_id
    const { data: candidato, error: candidatoError } = await supabaseAdmin
      .from('candidatos')
      .select<'id, propietario_id', CandidatoRow>('id, propietario_id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (candidatoError) {
      console.error(
        'Error buscando candidato por hl_opportunity_id (owner-change):',
        candidatoError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: candidatoError.message },
        { status: 500 }
      );
    }

    if (!candidato) {
      return NextResponse.json(
        {
          ok: false,
          error: 'candidate_not_found',
          details: 'No candidate found for that hl_opportunity_id'
        },
        { status: 404 }
      );
    }

    const candidatoId = candidato.id;
    const propietarioAnteriorId = candidato.propietario_id; // puede ser null

    // 6) Buscar usuario NUEVO por ghl_id (nuevo propietario)
    const { data: nuevoPropietarioRow, error: nuevoPropietarioError } =
      await supabaseAdmin
        .from('usuarios')
        .select<'id', UsuarioByGhlRow>('id')
        .eq('ghl_id', cleaned.nuevo_propietario_hl_id)
        .maybeSingle();

    if (nuevoPropietarioError) {
      console.error(
        'Error buscando nuevo propietario por ghl_id (owner-change):',
        nuevoPropietarioError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: nuevoPropietarioError.message },
        { status: 500 }
      );
    }

    if (!nuevoPropietarioRow) {
      return NextResponse.json(
        {
          ok: false,
          error: 'new_owner_not_found',
          details:
            'No user found in usuarios for the new propietario_id (ghl_id)'
        },
        { status: 404 }
      );
    }

    const propietarioActualUuid = nuevoPropietarioRow.id;

    // 7) Buscar quién hizo el cambio (changed_by) por ghl_id
    const { data: changedByRow, error: changedByError } = await supabaseAdmin
      .from('usuarios')
      .select<'id', UsuarioByGhlRow>('id')
      .eq('ghl_id', cleaned.changed_by_hl_id)
      .maybeSingle();

    if (changedByError) {
      console.error(
        'Error buscando changed_by por ghl_id (owner-change):',
        changedByError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: changedByError.message },
        { status: 500 }
      );
    }

    if (!changedByRow) {
      return NextResponse.json(
        {
          ok: false,
          error: 'changed_by_not_found',
          details:
            'No user found in usuarios for the changed_by ghl_id'
        },
        { status: 404 }
      );
    }

    const changedByUuid = changedByRow.id;

    // 8) Si el propietario NO cambió, no hacemos nada
    if (propietarioAnteriorId === propietarioActualUuid) {
      return NextResponse.json({
        ok: true,
        change: 'none',
        candidato_id: candidatoId,
        propietario_id: propietarioActualUuid
      });
    }

    // 9) Insertar fila en reasignaciones + actualizar candidatos
    const nowIso = new Date().toISOString();

    const reasignacion: ReasignacionInsert = {
      candidato_id: candidatoId,
      propietario_anterior: propietarioAnteriorId,
      propietario_actual: propietarioActualUuid,
      changed_by: changedByUuid,
      created_at: nowIso
    };

    const { error: insertError } = await supabaseAdmin
      .from('reasignaciones')
      .insert(reasignacion);

    if (insertError) {
      console.error('Error insertando en reasignaciones (owner-change):', insertError);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('candidatos')
      .update({
        propietario_id: propietarioActualUuid,
        updated_at: nowIso
      })
      .eq('id', candidatoId);

    if (updateError) {
      console.error('Error actualizando propietario en candidatos (owner-change):', updateError);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      change: 'owner_changed',
      candidato_id: candidatoId,
      propietario_anterior: propietarioAnteriorId,
      propietario_actual: propietarioActualUuid,
      changed_by: changedByUuid
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/owner-change:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}