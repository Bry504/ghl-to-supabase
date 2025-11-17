import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../scr/lib/supabaseAdmin'

interface NotePayloadClean {
  hl_contact_id: string;
  hl_user_id?: string | null;
  nota: string | null;
}

interface ContactRow {
  id: string;
}

interface UserRow {
  id: string;
}

interface NoteRowInsert {
  contacto_id: string;
  usuario_id?: string | null;
  nota: string | null;
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
      process.env.GHL_NOTE_CREATED_TOKEN ??
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

    // 3) Extraer contact, user, note y customData si existen
    let contactObj: Record<string, unknown> = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contactObj = root['contact'] as Record<string, unknown>;
    }

    let userObj: Record<string, unknown> = {};
    if ('user' in root && isRecord(root['user'])) {
      userObj = root['user'] as Record<string, unknown>;
    }

    let noteObj: Record<string, unknown> = {};
    if ('note' in root && isRecord(root['note'])) {
      noteObj = root['note'] as Record<string, unknown>;
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
      console.error('Body sin hl_contact_id (note-created):', root);
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

    // 5) Resolver hl_user_id (dueño / usuario que hace la nota)
    const hlUserId =
      getStringField(customData, 'hl_user_id') ??
      getStringField(root, 'hl_user_id') ??
      getStringField(userObj, 'id') ??
      getStringField(noteObj, 'user_id');

    // 6) Resolver texto de la nota
    const notaText =
      getStringField(customData, 'nota') ??
      getStringField(root, 'nota') ??
      getStringField(noteObj, 'body') ??
      getStringField(noteObj, 'text');

    const cleaned: NotePayloadClean = {
      hl_contact_id: hlContactId,
      hl_user_id: hlUserId,
      nota: notaText
    };

    // 7) Buscar contacto_id en tabla contactos usando hl_contact_id
    const { data: contactRow, error: contactError } = await supabaseAdmin
      .from('contactos')
      .select<'id', ContactRow>('id')
      .eq('hl_contact_id', cleaned.hl_contact_id)
      .maybeSingle();

    if (contactError) {
      console.error('Error buscando contacto por hl_contact_id (note-created):', contactError);
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

    // 8) Buscar usuario_id (si tenemos hl_user_id)
    let usuarioId: string | null = null;

    if (cleaned.hl_user_id) {
      const { data: userRow, error: userError } = await supabaseAdmin
        .from('usuarios')
        .select<'id', UserRow>('id')
        .eq('ghl_id', cleaned.hl_user_id)
        .maybeSingle();

      if (userError) {
        console.error('Error buscando usuario por ghl_id (note-created):', userError);
      } else if (userRow) {
        usuarioId = userRow.id;
      }
    }

    const nowIso = new Date().toISOString();

    // 9) Construir fila para insertar en "notas"
    const insertPayload: NoteRowInsert = {
      contacto_id: contactoId,
      usuario_id: usuarioId ?? null,
      nota: cleaned.nota,
      created_at: nowIso
    };

    const { data: insertData, error: insertError } = await supabaseAdmin
      .from('notas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error('Error insertando nota (note-created):', insertError);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      nota_id: insertData.id,
      contacto_id: contactoId,
      usuario_id: usuarioId
    });
  } catch (err) {
    console.error('Unexpected error in /ghl/note-created:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}