import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = 'deal-docs';

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// ── GET: list docs for a deal (with signed download URLs) ─────────────────────
export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get('dealId');
  if (!dealId) return NextResponse.json({ error: 'dealId required' }, { status: 400 });

  const supabase = adminClient();
  const { data: docs, error } = await supabase
    .from('crm_deal_docs')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Generate a signed URL for each doc (1-hour expiry)
  const withUrls = await Promise.all(
    (docs ?? []).map(async (doc) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 3600);
      return { ...doc, url: data?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ docs: withUrls });
}

// ── POST: upload a doc ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const dealId = formData.get('dealId') as string | null;
  const uploadedBy = formData.get('uploadedBy') as string | null;

  if (!file || !dealId) {
    return NextResponse.json({ error: 'file and dealId required' }, { status: 400 });
  }

  const supabase = adminClient();
  const ext = file.name.split('.').pop() ?? '';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${dealId}/${Date.now()}_${safeName}`;

  // Upload to Supabase Storage
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Save metadata to DB
  const { data: doc, error: dbError } = await supabase
    .from('crm_deal_docs')
    .insert([{
      deal_id: dealId,
      name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      file_type: file.type || ext,
      uploaded_by: uploadedBy ?? null,
    }])
    .select()
    .single();

  if (dbError) {
    // Clean up uploaded file if DB insert fails
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ doc });
}

// ── DELETE: remove a doc ──────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { docId } = await req.json();
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });

  const supabase = adminClient();

  // Get the storage path first
  const { data: doc } = await supabase
    .from('crm_deal_docs')
    .select('storage_path')
    .eq('id', docId)
    .single();

  if (doc?.storage_path) {
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  }

  await supabase.from('crm_deal_docs').delete().eq('id', docId);

  return NextResponse.json({ success: true });
}
