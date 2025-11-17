import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

interface AbandonedPayloadClean {
  hl_opportunity_id: string;
}

interface CandidateIdRow {
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

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');
    const expectedToken =
      process.env.GHL_OPPORTUNITY_ABANDONED_TOKEN ??
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
      console.error('Body sin hl_opportunity_id (opportunity-abandoned):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    const cleaned: AbandonedPayloadClean = {
      hl_opportunity_id: hlOpportunityId
    };

    const nowIso = new Date().toISOString();

    // 5) Actualizar candidato cruzando por hl_opportunity_id
    const { data: updatedRow, error: updateError } = await supabaseAdmin
      .from('candidatos')
      .update({
        estado: 'ABANDONADA',
        updated_at: nowIso
      })
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .select<'id', CandidateIdRow>('id')
      .maybeSingle();

    if (updateError) {
      console.error(
        'Error actualizando candidato (opportunity-abandoned):',
        updateError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: updateError.message },
        { status: 500 }
      );
    }

    if (!updatedRow) {
      return NextResponse.json(
        {
          ok: false,
          error: 'not_found',
          details: 'No candidate found for that hl_opportunity_id'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      candidato_id: updatedRow.id,
      estado: 'ABANDONADA'
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/opportunity-abandoned:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}