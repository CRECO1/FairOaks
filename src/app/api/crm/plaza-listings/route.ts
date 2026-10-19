import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Directory listings for fairoaksranchplaza.com (plaza_listings) and their opt-in invites (plaza_listing_invites).
// Admin-only. A tenant's submission waits in the invite row; nothing reaches the public listing until `approve`.

const LF = 'id, name, suite, building, category, description, phone, website, hours, published, sort_order, logo_url';
const BUCKET = 'plaza-logos';
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

function parseLogo(dataUrl: unknown): { buf: Buffer; type: string; ext: string } | null {
  const m = typeof dataUrl === 'string' ? /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m || m[3].length > 700000) return null;
  return { buf: Buffer.from(m[3], 'base64'), type: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2] };
}

async function saveLogo(listingId: string, logo: { buf: Buffer; type: string; ext: string }) {
  const sb = adminClient();
  const path = `${listingId}.${logo.ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, logo.buf, { contentType: logo.type, upsert: true });
  if (error) throw error;
  // The path is stable across replacements, so add a version to bust CDN/browser caches.
  return `${sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
}

export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const sb = adminClient();
  const [l, i] = await Promise.all([
    sb.from('plaza_listings').select(LF).order('building').order('sort_order').order('name').limit(500),
    sb.from('plaza_listing_invites').select('id, listing_id, token, contact_name, contact_email, status, submitted, submitted_at').limit(1000),
  ]);
  if (l.error || i.error) { console.error('[plaza-listings] GET', l.error || i.error); return bad('Internal error', 500); }
  const byListing = new Map((i.data ?? []).map(x => [x.listing_id, x]));
  return NextResponse.json({ listings: (l.data ?? []).map(x => ({ ...x, invite: byListing.get(x.id) ?? null })) });
}

export async function POST(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const action = typeof b.action === 'string' ? b.action : 'create';
  const sb = adminClient();

  if (action === 'create') {
    const name = str(b.name, 160);
    if (!name) return bad('Name is required');
    const { data, error } = await sb.from('plaza_listings').insert({
      name, suite: str(b.suite, 40), building: [1, 2, 3].includes(Number(b.building)) ? Number(b.building) : null,
      category: str(b.category, 60) || null, published: false,
    }).select(LF).single();
    if (error || !data) { console.error('[plaza-listings] create', error); return bad('Could not create', 500); }
    await sb.from('plaza_listing_invites').insert({ listing_id: data.id, contact_name: str(b.contact_name, 120) || null, contact_email: str(b.contact_email, 160) || null });
    return NextResponse.json({ ok: true });
  }

  const id = str(b.id, 64);
  if (!id) return bad('id required');
  const { data: inv } = await sb.from('plaza_listing_invites').select('*').eq('listing_id', id).maybeSingle();

  if (action === 'approve') {
    const sub = inv?.submitted as Record<string, string> | null;
    if (!inv || !sub) return bad('Nothing to approve');
    const patch: Record<string, unknown> = {
      name: sub.display_name || undefined, category: sub.category || null, description: sub.description || '',
      phone: sub.phone || null, website: sub.website || null, hours: sub.hours || null, published: true,
    };
    if (sub.logo_data) {
      const logo = parseLogo(sub.logo_data);
      if (logo) { try { patch.logo_url = await saveLogo(id, logo); } catch (e) { console.error('[plaza-listings] logo', e); return bad('Could not save the logo', 500); } }
    }
    const { error } = await sb.from('plaza_listings').update(patch).eq('id', id);
    if (error) { console.error('[plaza-listings] approve', error); return bad('Could not approve', 500); }
    const { logo_data: _drop, ...rest } = sub;
    await sb.from('plaza_listing_invites').update({
      status: 'approved', submitted: rest,
      contact_name: sub.contact_name || inv.contact_name, contact_email: sub.contact_email || inv.contact_email,
    }).eq('id', inv.id);
    return NextResponse.json({ ok: true });
  }
  if (action === 'decline') {
    if (!inv) return bad('No invite');
    await sb.from('plaza_listing_invites').update({ status: 'declined' }).eq('id', inv.id);
    return NextResponse.json({ ok: true });
  }
  if (action === 'newlink') {
    if (!inv) return bad('No invite');
    await sb.from('plaza_listing_invites').update({ token: randomBytes(16).toString('hex'), status: 'invited', submitted: null, submitted_at: null }).eq('id', inv.id);
    return NextResponse.json({ ok: true });
  }
  if (action === 'contact') {
    if (!inv) return bad('No invite');
    await sb.from('plaza_listing_invites').update({ contact_name: str(b.contact_name, 120) || null, contact_email: str(b.contact_email, 160) || null }).eq('id', inv.id);
    return NextResponse.json({ ok: true });
  }
  if (action === 'logo') {
    const logo = parseLogo(b.logo_data);
    if (!logo) return bad('Upload a PNG, JPG or WebP image');
    try {
      const url = await saveLogo(id, logo);
      await sb.from('plaza_listings').update({ logo_url: url }).eq('id', id);
    } catch (e) { console.error('[plaza-listings] logo', e); return bad('Could not save the logo', 500); }
    return NextResponse.json({ ok: true });
  }
  return bad('Unknown action');
}

export async function PATCH(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return bad('id required');
  const b = await req.json().catch(() => ({}));
  const out: Record<string, unknown> = {};
  if ('name' in b) { const n = str(b.name, 160); if (!n) return bad('Name is required'); out.name = n; }
  if ('suite' in b) out.suite = str(b.suite, 40);
  if ('building' in b) out.building = [1, 2, 3].includes(Number(b.building)) ? Number(b.building) : null;
  for (const [k, max] of [['category', 60], ['phone', 40], ['hours', 400]] as const) if (k in b) out[k] = str(b[k], max) || null;
  if ('description' in b) out.description = str(b.description, 400);
  if ('website' in b) { const w = str(b.website, 300); if (w && !/^https?:\/\//i.test(w)) return bad('Website must start with http:// or https://'); out.website = w || null; }
  if ('published' in b) out.published = b.published === true;
  const { data, error } = await adminClient().from('plaza_listings').update(out).eq('id', id).select(LF).single();
  if (error) { console.error('[plaza-listings] PATCH', error); return bad('Could not update', 500); }
  return NextResponse.json({ listing: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return bad('id required');
  const { error } = await adminClient().from('plaza_listings').delete().eq('id', id);
  if (error) { console.error('[plaza-listings] DELETE', error); return bad('Could not delete', 500); }
  return NextResponse.json({ ok: true });
}
