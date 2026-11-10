import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { CRM_ATTACH_KINDS, resolveCrmAttachments, type CrmAttachKind } from '@/lib/crm-attachments';

// GET /api/crm/attachment-preview?kind=…&id=…
// The bytes of ONE CRM-side attachment (a deal doc, form, signed copy, property flyer, forwarded file…) so the composer
// can show the agent exactly what is about to go out. Authorized by the same resolver the Send route uses, so nobody can
// preview anything they couldn't attach. Only PDFs and pictures are shown; the response is sandboxed and never HTML.

const SHOWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;
const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const kind = req.nextUrl.searchParams.get('kind') as CrmAttachKind | null;
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!kind || !CRM_ATTACH_KINDS.includes(kind) || !id || id.length > 300) return NextResponse.json({ error: 'Invalid attachment' }, { status: 400 });

  const r = await resolveCrmAttachments([{ kind, id }], ctx);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const file = r.files[0];
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const mime = SHOWABLE.test(file.mimeType) ? file.mimeType.toLowerCase() : (MIME_BY_EXT[ext] ?? '');
  if (!mime) return NextResponse.json({ error: 'No preview for this file type', name: file.name }, { status: 415 });

  const bytes = Buffer.from(file.data, 'base64');
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'X-Attachment-Name': encodeURIComponent(file.name),
      'Cache-Control': 'private, no-store',
    },
  });
}
