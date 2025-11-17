import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

interface StageChangePayloadClean {
  hl_opportunity_id: string;
  etapa_origen?: string | null;
  etapa_destino?: string | null;
}

interface CandidateRow {
  id: string;
}

interface HistorialRow {
  id: string;
  source: string | null;
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
      process.env.GHL_STAGE_CHANGE_TOKEN ??
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

    // 3) Extraer opportunity y customData si existen
    let opportunityObj: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunityObj = root['opportunity'] as Record<string, unknown>;
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
      console.error('Body sin hl_opportunity_id reconocible (stage-change):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // 5) Limpiar etapas
    const cleaned: StageChangePayloadClean = {
      hl_opportunity_id: hlOpportunityId,
      etapa_origen: getStringField(customData, 'etapa_origen'),
      etapa_destino: getStringField(customData, 'etapa_destino')
    };

    const etapaDestinoFinal = cleaned.etapa_destino ?? 'SIN_ETAPA';

    // 6) Buscar candidato por hl_opportunity_id
    const { data: candidatoRow, error: candidatoError } = await supabaseAdmin
      .from('candidatos')
      .select<'id', CandidateRow>('id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (candidatoError) {
      console.error('Error buscando candidato por hl_opportunity_id:', candidatoError);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: candidatoError.message },
        { status: 500 }
      );
    }

    if (!candidatoRow) {
      return NextResponse.json(
        {
          ok: false,
          error: 'not_found',
          details: 'No candidate found for that hl_opportunity_id'
        },
        { status: 404 }
      );
    }

    const candidatoId = candidatoRow.id;

    // 7) Verificar si ya hay un registro SISTEMA muy reciente (últimos ~10s)
    const tenSecondsAgoIso = new Date(Date.now() - 10_000).toISOString();

    const { data: recientes, error: recientesError } = await supabaseAdmin
      .from('historial_etapas')
      .select<'id, source, created_at', HistorialRow>('id, source, created_at')
      .eq('candidato_id', candidatoId)
      .eq('source', 'SISTEMA')
      .gte('created_at', tenSecondsAgoIso);

    if (recientesError) {
      console.error('Error consultando historial_etapas recientes:', recientesError);
      // no bloqueamos por este error; seguimos insertando
    }

    if (recientes && recientes.length > 0) {
      // Hay un registro SISTEMA muy reciente (proveniente del trigger de creación)
      // Evitamos duplicar el evento de creación.
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'recent_system_initial_stage'
      });
    }

    // 8) Insertar cambio de etapa normal
    const nowIso = new Date().toISOString();

    const { data: insertData, error: insertError } = await supabaseAdmin
      .from('historial_etapas')
      .insert({
        candidato_id: candidatoId,
        etapa_origen: cleaned.etapa_origen,
        etapa_destino: etapaDestinoFinal,
        changed_at: nowIso,
        source: 'WEBHOOK_HL',
        created_at: nowIso
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Error insertando historial_etapas (stage-change):', insertError);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      historial_etapas_id: insertData.id,
      candidato_id: candidatoId
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/stage-change:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}