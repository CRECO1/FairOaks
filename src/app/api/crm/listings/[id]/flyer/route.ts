import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

export const dynamic = 'force-dynamic';

const GOLD = rgb(0.788, 0.573, 0.173);
const INK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.42, 0.45, 0.5);

// Helvetica (WinAnsi) can't draw smart quotes/dashes/emoji — flatten to safe ASCII.
function safe(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '').trim();
}
function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? '$' + v.toLocaleString('en-US') : '';
}
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = w; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertCanAccessListing(id, ctx))) return notFound('Listing not found');

  const supabase = adminClient();
  const { data: L } = await supabase.from('crm_listings').select('*').eq('id', id).single();
  if (!L) return notFound('Listing not found');

  const agent = L.listing_agent_id
    ? (await supabase.from('crm_profiles').select('*').eq('id', L.listing_agent_id).maybeSingle()).data as Record<string, unknown> | null
    : null;

  // First embeddable (jpg/png) photo → hero.
  const { data: files } = await supabase.from('crm_listing_files').select('storage_path,file_type,category').eq('listing_id', id);
  let heroBytes: Uint8Array | null = null, heroPng = false;
  for (const f of (files ?? []).filter(f => f.category === 'photo' || (f.file_type || '').startsWith('image/'))) {
    const ft = (f.file_type || '').toLowerCase();
    if (!(ft.includes('png') || ft.includes('jpeg') || ft.includes('jpg'))) continue;
    const { data: blob } = await supabase.storage.from('listing-files').download(f.storage_path);
    if (blob) { heroBytes = new Uint8Array(await blob.arrayBuffer()); heroPng = ft.includes('png'); break; }
  }

  const residential = L.business_unit === 'residential';
  const brand = residential ? 'Fair Oaks Realty Group' : 'CRECO';
  const web = residential ? 'fairoaksrealtygroup.com' : 'crecotx.com';
  const tagline = residential ? 'Residential Real Estate' : 'Commercial Real Estate';

  const pdf = await PDFDocument.create();
  const page: PDFPage = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const M = 42, W = 612 - M * 2;

  // Header band
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: GOLD });
  page.drawText(safe(brand), { x: M, y: 761, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(tagline.toUpperCase()), { x: M, y: 749, size: 8, font, color: rgb(1, 1, 1) });
  const wWeb = font.widthOfTextAtSize(web, 10);
  page.drawText(web, { x: 612 - M - wWeb, y: 755, size: 10, font, color: rgb(1, 1, 1) });

  let y = 716;
  // Title + address
  page.drawText(safe(L.name || L.address || 'Property'), { x: M, y, size: 22, font: bold, color: INK });
  y -= 18;
  const loc = [L.address, L.city, L.state, L.zip].filter(Boolean).map(safe).join(', ');
  if (loc) { page.drawText(loc, { x: M, y, size: 11, font, color: GRAY }); }
  y -= 16;

  // Hero image (contain within a box on a light panel)
  const boxH = 250, boxY = y - boxH;
  page.drawRectangle({ x: M, y: boxY, width: W, height: boxH, color: rgb(0.96, 0.97, 0.98) });
  if (heroBytes) {
    try {
      const img = heroPng ? await pdf.embedPng(heroBytes) : await pdf.embedJpg(heroBytes);
      const scale = Math.min(W / img.width, boxH / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      page.drawImage(img, { x: M + (W - iw) / 2, y: boxY + (boxH - ih) / 2, width: iw, height: ih });
    } catch { /* unembeddable — leave the panel */ }
  } else {
    page.drawText('No photo on file', { x: M + W / 2 - 40, y: boxY + boxH / 2, size: 11, font, color: rgb(0.7, 0.73, 0.77) });
  }
  y = boxY - 26;

  // Stat row
  const price = money(L.sale_price ?? L.asking_price);
  const stats: [string, string][] = [
    ['PRICE', price || '—'],
    ['SIZE', L.sq_ft ? Number(L.sq_ft).toLocaleString() + ' SF' : (safe(L.lot_size) || '—')],
    ['TYPE', safe(L.type) || '—'],
    ['STATUS', safe((L.status || '').replace('_', ' ')).toUpperCase() || '—'],
  ];
  const col = W / stats.length;
  stats.forEach(([k, v], i) => {
    const cx = M + col * i;
    page.drawText(k, { x: cx, y, size: 8, font: bold, color: GOLD });
    page.drawText(v.slice(0, 22), { x: cx, y: y - 15, size: 13, font: bold, color: INK });
  });
  y -= 34;
  page.drawLine({ start: { x: M, y }, end: { x: 612 - M, y }, thickness: 0.75, color: rgb(0.9, 0.91, 0.93) });
  y -= 20;

  // Description
  const desc = safe(L.description || L.notes);
  if (desc) {
    for (const line of wrap(desc, font, 10.5, W).slice(0, 12)) {
      page.drawText(line, { x: M, y, size: 10.5, font, color: rgb(0.28, 0.3, 0.34) });
      y -= 15;
    }
    y -= 8;
  }

  // Agent block (bottom)
  const ay = 96;
  page.drawLine({ start: { x: M, y: ay + 28 }, end: { x: 612 - M, y: ay + 28 }, thickness: 0.75, color: rgb(0.9, 0.91, 0.93) });
  const aname = agent ? safe(`${agent.first_name ?? ''} ${agent.last_name ?? ''}`).trim() : '';
  if (aname) {
    page.drawText('PRESENTED BY', { x: M, y: ay + 12, size: 8, font: bold, color: GOLD });
    page.drawText(aname, { x: M, y: ay - 4, size: 14, font: bold, color: INK });
    const contact = [agent?.phone, agent?.email].filter(Boolean).map(safe).join('   •   ');
    if (contact) page.drawText(contact, { x: M, y: ay - 20, size: 10, font, color: GRAY });
  }

  // Footer
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 34, color: rgb(0.1, 0.11, 0.13) });
  page.drawText(safe(`${brand}  |  ${web}`), { x: M, y: 13, size: 9, font: bold, color: rgb(1, 1, 1) });
  const disc = 'Information deemed reliable but not guaranteed.';
  page.drawText(disc, { x: 612 - M - font.widthOfTextAtSize(disc, 8), y: 13, size: 8, font, color: rgb(0.8, 0.82, 0.85) });

  const bytes = await pdf.save();
  const fname = safe(L.name || L.address || 'listing').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50) || 'flyer';
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fname}-flyer.pdf"` },
  });
}
