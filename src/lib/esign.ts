// ─────────────────────────────────────────────────────────────────────────────
// E-signature engine — server-side helpers shared by the authed envelope routes
// (/api/crm/envelopes) and the public token-gated signing route (/api/sign/[token]).
//
// Email split (see the Gmail vs Resend note): the FIRST invite is sent from the
// broker's own Gmail by the browser (session-bound), so this file only owns the
// server-to-server sends (routing to the next signer, completion) via Resend, plus
// token generation, the audit log, and all pdf-lib signature stamping.
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';

// The CRM (and therefore the /sign page) is served from this origin. Mirrors the
// hardcoded BASE_URL convention in action-plans/send-now + review-request.
export const APP_ORIGIN = 'https://www.fairoaksrealtygroup.com';
export const SIGN_BUCKET = 'transaction-forms';

// ── Tokens & links ───────────────────────────────────────────────────────────
export function genToken(): string {
  return randomBytes(24).toString('base64url'); // opaque, URL-safe, unguessable
}
export function signUrl(token: string): string {
  return `${APP_ORIGIN}/sign/${token}`;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Email (server-to-server via Resend) ──────────────────────────────────────
// Branded per business unit, mirroring action-plans/send-now.
export function resendConfig(businessUnit: string): { from: string; apiKey?: string } {
  return businessUnit === 'residential'
    ? { from: 'Fair Oaks Realty Group <info@fairoaksrealtygroup.com>', apiKey: process.env.RESEND_API_KEY }
    : { from: 'CRECO <info@crecotx.com>', apiKey: process.env.RESEND_API_KEY_COMMERCIAL || process.env.RESEND_API_KEY };
}

export async function sendEsignEmail(
  businessUnit: string, to: string, subject: string, html: string,
): Promise<{ ok: boolean; error?: string }> {
  const { from, apiKey } = resendConfig(businessUnit);
  if (!apiKey) return { ok: false, error: 'RESEND API key not configured' };
  try {
    const { error } = await new Resend(apiKey).emails.send({ from, to, subject, html });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Shared email shell (brand-neutral; the from-address carries the brand).
function shell(brand: string, bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="border-bottom:3px solid #c9922c;padding:14px 0 10px"><span style="font-size:20px;font-weight:800;letter-spacing:.5px;color:#c9922c">${esc(brand)}</span></div>
    <div style="padding:20px 2px;font-size:15px;line-height:1.55">${bodyHtml}</div>
    <div style="border-top:1px solid #eee;margin-top:18px;padding-top:12px;font-size:11px;color:#9ca3af">
      This document is being signed electronically. If you weren’t expecting it, you can ignore this email and no action will be taken.
    </div>
  </div>`;
}
const brandName = (unit: string) => (unit === 'residential' ? 'Fair Oaks Realty Group' : 'CRECO');

export function inviteEmail(unit: string, opts: { signerName: string; docTitle: string; senderName: string; url: string; message?: string }) {
  const body = `<p>Hi ${esc(opts.signerName)},</p>
    <p>${esc(opts.senderName)} has sent you <strong>${esc(opts.docTitle)}</strong> to review and sign.</p>
    ${opts.message ? `<p style="background:#faf7ef;border-left:3px solid #c9922c;padding:10px 12px;border-radius:4px">${esc(opts.message)}</p>` : ''}
    <p style="margin:22px 0"><a href="${esc(opts.url)}" style="background:#c9922c;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Review &amp; Sign</a></p>
    <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${esc(opts.url)}</p>`;
  return { subject: `Please sign: ${opts.docTitle}`, html: shell(brandName(unit), body) };
}

export function routingEmail(unit: string, opts: { signerName: string; docTitle: string; url: string }) {
  const body = `<p>Hi ${esc(opts.signerName)},</p>
    <p>It’s your turn to sign <strong>${esc(opts.docTitle)}</strong>. The previous party has completed their signature.</p>
    <p style="margin:22px 0"><a href="${esc(opts.url)}" style="background:#c9922c;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Review &amp; Sign</a></p>
    <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${esc(opts.url)}</p>`;
  return { subject: `Your signature is requested: ${opts.docTitle}`, html: shell(brandName(unit), body) };
}

export function completedEmail(unit: string, opts: { recipientName: string; docTitle: string }) {
  const body = `<p>Hi ${esc(opts.recipientName)},</p>
    <p><strong>${esc(opts.docTitle)}</strong> has been signed by all parties. The fully executed copy is attached to this email for your records.</p>
    <p style="font-size:13px;color:#6b7280">A Certificate of Completion documenting each signature is included on the final page.</p>`;
  return { subject: `Completed: ${opts.docTitle}`, html: shell(brandName(unit), body) };
}

// ── Audit log ────────────────────────────────────────────────────────────────
export async function logEvent(
  admin: SupabaseClient, envelopeId: string, signerId: string | null, event: string,
  opts?: { actor?: string; ip?: string | null; ua?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await admin.from('crm_envelope_events').insert([{
    envelope_id: envelopeId, signer_id: signerId, event,
    actor: opts?.actor ?? 'system', ip: opts?.ip ?? null, user_agent: opts?.ua ?? null, meta: opts?.meta ?? null,
  }]);
}

export function clientIp(req: Request): string | null {
  const h = req.headers;
  return (h.get('x-forwarded-for')?.split(',')[0].trim()) || h.get('x-real-ip') || null;
}

// ── PDF stamping ─────────────────────────────────────────────────────────────
// A field row from crm_form_fields (fractions x/y/w/h are page-relative; y is the
// underline/baseline fraction from the top, matching TransactionDocEditor).
export interface SignField {
  page: number; x: number; y: number; w: number; h: number;
  type: string; field_key?: string | null; signer_role?: string | null;
}

const winAnsi = (s: string): string =>
  (s || '').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-')
    .replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

// Stamp one signer's fields onto the PDF: signature/initial fields get the drawn
// PNG; date_signed fields get the date; name/text fields get the typed name.
// Returns the new PDF bytes. Coordinate transform mirrors TransactionDocEditor:
// x = fx*W  ·  baseline y = H - fy*H  (image sits its bottom on that baseline).
export async function stampSignerFields(
  baseBytes: Uint8Array,
  fields: SignField[],
  data: { signaturePng?: Uint8Array; typedName: string; dateStr: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cursive = await doc.embedFont(StandardFonts.HelveticaOblique);
  const png = data.signaturePng ? await doc.embedPng(data.signaturePng) : null;
  const pages = doc.getPages();

  for (const f of fields) {
    const pg = pages[f.page - 1];
    if (!pg) continue;
    const { width, height } = pg.getSize();
    const x = f.x * width;
    const baseline = height - f.y * height; // the field's underline, in PDF coords

    if ((f.type === 'signature' || f.type === 'initial')) {
      const boxW = Math.max(40, f.w * width);
      if (png) {
        const scale = boxW / png.width;
        const drawH = Math.min(png.height * scale, 46); // cap height so it sits on the line
        const drawW = drawH * (png.width / png.height);
        pg.drawImage(png, { x, y: baseline, width: drawW, height: drawH });
      } else {
        // typed-signature fallback in a script-like face
        pg.drawText(winAnsi(data.typedName), { x, y: baseline + 2, size: f.type === 'initial' ? 12 : 18, font: cursive, color: rgb(0.05, 0.05, 0.35) });
      }
    } else if (f.type === 'date_signed') {
      pg.drawText(winAnsi(data.dateStr), { x, y: baseline + 2, size: 10, font, color: rgb(0.06, 0.06, 0.1) });
    } else {
      // a text field bound to this signer (e.g. printed name)
      pg.drawText(winAnsi(data.typedName), { x, y: baseline + 2, size: 10, font, color: rgb(0.06, 0.06, 0.1) });
    }
  }
  return doc.save();
}

// Append a Certificate of Completion page (the audit trail that makes it enforceable).
export async function appendCertificate(
  pdfBytes: Uint8Array,
  info: { docTitle: string; envelopeId: string; signers: Array<{ name: string; email: string; role: string; signedAt?: string | null; ip?: string | null }> },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const M = 56;
  let y = 792 - 64;
  const line = (t: string, f = font, size = 10, color = rgb(0.1, 0.1, 0.12)) => { page.drawText(winAnsi(t), { x: M, y, size, font: f, color }); y -= size + 6; };

  page.drawRectangle({ x: 0, y: 792 - 42, width: 612, height: 42, color: rgb(0.788, 0.573, 0.173) });
  page.drawText('Certificate of Completion', { x: M, y: 792 - 30, size: 16, font: bold, color: rgb(1, 1, 1) });
  y = 792 - 74;
  line(`Document: ${info.docTitle}`, bold, 11);
  line(`Envelope ID: ${info.envelopeId}`, font, 9, rgb(0.4, 0.42, 0.46));
  y -= 8;
  line('Signers', bold, 12, rgb(0.62, 0.45, 0.13));
  for (const s of info.signers) {
    line(`${s.name}  (${s.role})`, bold, 10.5);
    line(`   ${s.email}`, font, 9, rgb(0.4, 0.42, 0.46));
    line(`   Signed: ${s.signedAt ? new Date(s.signedAt).toUTCString() : '—'}${s.ip ? `   ·   IP ${s.ip}` : ''}`, font, 9, rgb(0.4, 0.42, 0.46));
    y -= 6;
  }
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: 612 - M, y }, thickness: 0.75, color: rgb(0.9, 0.91, 0.93) });
  y -= 16;
  line('Each party consented to sign electronically (ESIGN/UETA). This certificate records the', font, 8.5, rgb(0.5, 0.52, 0.56));
  line('identity, timestamp, and network address captured at the time of each signature.', font, 8.5, rgb(0.5, 0.52, 0.56));
  return doc.save();
}
