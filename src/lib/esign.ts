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
import { PDFDocument, StandardFonts, rgb, PDFImage } from 'pdf-lib';
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
  attachments?: Array<{ filename: string; content: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const { from, apiKey } = resendConfig(businessUnit);
  if (!apiKey) return { ok: false, error: 'RESEND API key not configured' };
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from, to, subject, html,
      ...(attachments && attachments.length ? { attachments } : {}),
    });
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

export interface ExecutedSigner {
  name: string; email: string; role: string;
  // 1-based position in the signing order — how a field addresses THIS person.
  index?: number;
  signedAt?: string | null; ip?: string | null;
  signaturePng?: Uint8Array | null; typedName?: string;
  // The signer's initials in the same hand as their signature. Falls back to drawn
  // block letters when a signer typed a name instead of adopting a style.
  initialsPng?: Uint8Array | null;
}

// A signature/initial/date field the agent placed on the doc (from the submission).
// A field addresses a specific signer by their place in the signing order. Role alone
// can't: two clients on the same document would both resolve to the first one.
export interface PlacedField { page: number; fx: number; fy: number; fw: number; type: string; signerRole?: string | null; signerIndex?: number | null }

// Assemble the fully-executed PDF: stamp each signer's signature/initials/date onto
// the fields the agent PLACED (inline, on the doc's own lines); any signer without
// a placed field lands on an appended Signatures page; then the Certificate.
export async function buildExecutedPdf(
  sourceBytes: Uint8Array,
  info: { docTitle: string; envelopeId: string; signers: ExecutedSigner[]; sigFields?: PlacedField[] },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cursive = await doc.embedFont(StandardFonts.HelveticaOblique);
  const pages = doc.getPages();
  const initialsOf = (n: string) => (n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 4);

  // Embed each signer's drawn signature once.
  const png = new Map<string, PDFImage | null>();
  const inits = new Map<string, PDFImage | null>();
  for (const s of info.signers) {
    if (s.signaturePng) { try { png.set(s.email, await doc.embedPng(s.signaturePng)); } catch { png.set(s.email, null); } }
    if (s.initialsPng) { try { inits.set(s.email, await doc.embedPng(s.initialsPng)); } catch { inits.set(s.email, null); } }
  }

  // Inline stamping onto agent-placed fields.
  const placed = (info.sigFields || []).filter(f => ['signature', 'initial', 'date', 'date_signed'].includes(f.type));
  const inline = new Set<string>();
  for (const f of placed) {
    // Prefer the exact signer the agent assigned; fall back to first-of-role for
    // documents whose fields were placed before per-signer assignment existed.
    const s = (f.signerIndex ? info.signers.find(x => x.index === f.signerIndex) : null)
      ?? info.signers.find(x => (x.role || 'client') === (f.signerRole || 'client'));
    if (!s) continue;
    const pg = pages[(f.page || 1) - 1]; if (!pg) continue;
    const { width, height } = pg.getSize();
    const x = f.fx * width; const baseline = height - f.fy * height;
    if (f.type === 'signature') {
      const img = png.get(s.email);
      if (img) { const w = Math.max(40, f.fw * width); const h = Math.min(w / (img.width / img.height), 38); pg.drawImage(img, { x, y: baseline, width: h * (img.width / img.height), height: h }); }
      else pg.drawText(winAnsi(s.typedName || s.name), { x, y: baseline + 2, size: 15, font: cursive, color: rgb(0.05, 0.05, 0.35) });
    } else if (f.type === 'initial') {
      const ini = inits.get(s.email);
      if (ini) { const w = Math.max(20, f.fw * width); const h = Math.min(w / (ini.width / ini.height), 26); pg.drawImage(ini, { x, y: baseline, width: h * (ini.width / ini.height), height: h }); }
      else pg.drawText(winAnsi(initialsOf(s.typedName || s.name)), { x, y: baseline + 2, size: 12, font: cursive, color: rgb(0.05, 0.05, 0.35) });
    } else {
      pg.drawText(winAnsi(s.signedAt ? new Date(s.signedAt).toLocaleDateString('en-US') : ''), { x, y: baseline + 2, size: 10, font, color: rgb(0.06, 0.06, 0.1) });
    }
    inline.add(s.email);
  }

  // Fallback Signatures page for any signer with no placed field.
  const pageSigners = info.signers.filter(s => !inline.has(s.email));
  if (pageSigners.length) {
    let page = doc.addPage([612, 792]);
    const M = 56; let y = 792 - 74;
    page.drawRectangle({ x: 0, y: 792 - 46, width: 612, height: 46, color: rgb(0.788, 0.573, 0.173) });
    page.drawText('Signatures', { x: M, y: 792 - 31, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText(winAnsi(info.docTitle), { x: M, y, size: 11, font, color: rgb(0.3, 0.3, 0.34) });
    y -= 34;
    for (const s of pageSigners) {
      if (y < 150) { page = doc.addPage([612, 792]); y = 792 - 74; }
      page.drawText(winAnsi(s.role.toUpperCase()), { x: M, y, size: 8.5, font: bold, color: rgb(0.62, 0.45, 0.13) }); y -= 8;
      const img = png.get(s.email);
      if (img) { const w = Math.min(210, img.width * 0.5); const h = Math.min(w * (img.height / img.width), 54); page.drawImage(img, { x: M, y: y - h + 6, width: w, height: h }); y -= h; }
      else { page.drawText(winAnsi(s.typedName || s.name), { x: M, y: y - 20, size: 18, font: cursive, color: rgb(0.05, 0.05, 0.35) }); y -= 26; }
      page.drawLine({ start: { x: M, y }, end: { x: M + 270, y }, thickness: 0.7, color: rgb(0.5, 0.5, 0.55) }); y -= 13;
      page.drawText(winAnsi(`${s.name}   ·   ${s.email}`), { x: M, y, size: 9.5, font, color: rgb(0.2, 0.2, 0.24) }); y -= 12;
      page.drawText(winAnsi(`Signed electronically${s.signedAt ? '  ·  ' + new Date(s.signedAt).toUTCString() : ''}${s.ip ? '  ·  IP ' + s.ip : ''}`), { x: M, y, size: 8, font, color: rgb(0.5, 0.52, 0.56) }); y -= 30;
    }
  }

  const withSigs = await doc.save();
  return appendCertificate(withSigs, info);
}

// ── Finalize ─────────────────────────────────────────────────────────────────
// Assemble + store the executed PDF for a fully-signed envelope, mark it completed,
// and email the executed copy to every signer + the broker. Self-contained and
// idempotent-safe (upsert on a stable path), so it backs BOTH the last signer's
// sign callback AND an authed retry for a request that got stuck mid-finalize.
export interface FinalizeSigner {
  name: string; email: string; signer_role: string;
  signed_at: string | null; ip: string | null; signature_path: string | null; typed_name: string | null;
  initials_path?: string | null;
}
export async function finalizeEnvelope(
  admin: SupabaseClient,
  env: { id: string; title: string; business_unit: string; source_path: string | null; submission_id: string | null; created_by: string | null },
  signers: FinalizeSigner[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!env.source_path) return { ok: false, error: 'This request has no source document to execute.' };
    const { data: srcBlob } = await admin.storage.from(SIGN_BUCKET).download(env.source_path);
    if (!srcBlob) return { ok: false, error: 'The source document could not be downloaded.' };
    const srcBytes = new Uint8Array(await srcBlob.arrayBuffer());

    const execSigners: ExecutedSigner[] = [];
    for (const s of signers) {
      const grab = async (path?: string | null): Promise<Uint8Array | null> => {
        if (!path) return null;
        const { data: pb } = await admin.storage.from(SIGN_BUCKET).download(path);
        return pb ? new Uint8Array(await pb.arrayBuffer()) : null;
      };
      const png = await grab(s.signature_path);
      const ini = await grab(s.initials_path);
      execSigners.push({ name: s.name, email: s.email, role: s.signer_role, index: execSigners.length + 1, signedAt: s.signed_at, ip: s.ip, signaturePng: png, initialsPng: ini, typedName: s.typed_name || undefined });
    }

    let sigFields: PlacedField[] = [];
    if (env.submission_id) {
      const { data: sub } = await admin.from('crm_form_submissions').select('values').eq('id', env.submission_id).maybeSingle();
      const vals: Array<{ page?: number; fx: number; fy: number; fw: number; type?: string; signerRole?: string; signerIndex?: number }> = Array.isArray(sub?.values) ? sub!.values : [];
      sigFields = vals
        .filter(f => ['signature', 'initial', 'date', 'date_signed'].includes(String(f.type)))
        .map(f => ({ page: f.page ?? 1, fx: f.fx, fy: f.fy, fw: f.fw, type: String(f.type), signerRole: f.signerRole ?? 'client', signerIndex: f.signerIndex ?? null }));
    }

    const executed = await buildExecutedPdf(srcBytes, { docTitle: env.title, envelopeId: env.id, signers: execSigners, sigFields });
    const execPath = `executed/${env.id}.pdf`;
    const { error: upErr } = await admin.storage.from(SIGN_BUCKET).upload(execPath, Buffer.from(executed), { contentType: 'application/pdf', upsert: true });
    if (upErr) return { ok: false, error: upErr.message };

    const nowIso = new Date().toISOString();
    await admin.from('crm_envelopes').update({ status: 'completed', executed_path: execPath, completed_at: nowIso, updated_at: nowIso }).eq('id', env.id);
    await logEvent(admin, env.id, null, 'completed', { actor: 'system' });

    // Email the executed copy to every signer + the broker (best-effort; the doc is
    // already stored + marked completed, so a mail failure never blocks completion).
    const b64 = Buffer.from(executed).toString('base64');
    const attach = [{ filename: `${(env.title || 'document').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-signed.pdf`, content: b64 }];
    const recipients = new Map<string, string>();
    for (const s of signers) if (s.email) recipients.set(s.email.toLowerCase(), s.name);
    if (env.created_by) {
      const { data: prof } = await admin.from('crm_profiles').select('email, first_name, last_name').eq('id', env.created_by).maybeSingle();
      if (prof?.email) recipients.set(String(prof.email).toLowerCase(), `${prof.first_name ?? ''} ${prof.last_name ?? ''}`.trim() || 'Broker');
    }
    for (const [email, name] of recipients) {
      const { subject, html } = completedEmail(env.business_unit, { recipientName: name, docTitle: env.title });
      await sendEsignEmail(env.business_unit, email, subject, html, attach);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
