/**
 * Universal Lead Webhook
 * POST /api/webhook/lead?apiKey=<WEBHOOK_SECRET>
 *
 * Use this endpoint with Zapier, Make, or any platform that can send a webhook.
 * Supports leads from Crexi, LoopNet, CoStar, or any other source.
 *
 * Body (all fields optional except first_name/last_name OR name, and email):
 * {
 *   "first_name": "John",
 *   "last_name": "Doe",
 *   "name": "John Doe",          // alternative to first/last
 *   "email": "john@example.com",
 *   "phone": "210-555-1234",
 *   "source": "Crexi",           // e.g. Crexi, LoopNet, CoStar, Referral, etc.
 *   "type": "Tenant",            // Buyer | Seller | Tenant | Landlord/Investor | Agent | Broker
 *   "message": "Interested in...",
 *   "tags": ["Hot Lead"],        // extra tags to add (New Lead always added)
 *   "asset_types": ["Industrial"],
 *   "budget": "$5,000/mo",
 *   "size_range": "5,000-10,000 SF",
 *   "city": "San Antonio",
 *   "state": "TX",
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@fairoaksrealtygroup.com';

function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

export async function POST(req: NextRequest) {
  // ── Auth: require apiKey query param ──────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const apiKey = searchParams.get('apiKey');
  if (!WEBHOOK_SECRET || apiKey !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    first_name: rawFirst,
    last_name: rawLast,
    name: rawName,
    email,
    phone,
    source = 'Unknown',
    type: rawType,
    message,
    tags: extraTags = [],
    asset_types,
    budget,
    size_range,
    city,
    state,
  } = body;

  // Parse name
  let first_name = rawFirst ?? '';
  let last_name = rawLast ?? '';
  if (!first_name && rawName) {
    const parts = rawName.trim().split(/\s+/);
    first_name = parts[0] ?? rawName;
    last_name = parts.slice(1).join(' ');
  }

  if (!first_name || !email) {
    return NextResponse.json({ error: 'first_name (or name) and email are required' }, { status: 400 });
  }

  // Validate type
  const VALID_TYPES = ['Buyer', 'Seller', 'Tenant', 'Landlord/Investor', 'Agent', 'Broker'];
  const clientType = VALID_TYPES.includes(rawType) ? rawType : 'Buyer';

  const supabase = adminClient();

  // ── Find admin to assign lead to ──────────────────────────────────────────
  const { data: adminProfile } = await supabase.from('crm_profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
  const adminId = adminProfile?.id;
  if (!adminId) return NextResponse.json({ error: 'No admin found to assign lead to' }, { status: 500 });

  // ── Deduplicate by email ──────────────────────────────────────────────────
  const { data: existing } = await supabase.from('crm_clients').select('id, tags, lead_source').eq('email', email).maybeSingle();

  let clientId: string;
  let isNew = false;

  if (existing) {
    // Update tags on existing client (add New Lead + extra tags if not already there)
    const mergedTags = [...new Set([...(existing.tags ?? []), 'New Lead', ...extraTags])];
    await supabase.from('crm_clients').update({
      tags: mergedTags,
      lead_source: existing.lead_source || source,
    }).eq('id', existing.id);
    clientId = existing.id;
  } else {
    isNew = true;
    const unsubscribe_token = crypto.randomUUID();
    const noteLines = [
      `📩 Lead from ${source}`,
      message ? `Message: ${message}` : '',
    ].filter(Boolean).join('\n');

    const { data: newClient } = await supabase.from('crm_clients').insert([{
      first_name,
      last_name,
      email,
      phone: phone ?? '',
      type: clientType,
      notes: noteLines,
      agent_id: adminId,
      assigned_agent_ids: [],
      lead_source: source,
      tags: ['New Lead', ...extraTags],
      unsubscribe_token,
      ...(asset_types ? { asset_types } : {}),
      ...(budget ? { budget } : {}),
      ...(size_range ? { size_range } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
    }]).select('id').single();
    clientId = newClient?.id;
  }

  // ── Notify team via email ─────────────────────────────────────────────────
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
      to: NOTIFICATION_EMAIL,
      subject: `📬 New Lead from ${source}: ${first_name} ${last_name}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:#1a1a2e">New Lead — ${source}</h2>
          <p style="color:#666">${isNew ? '✅ Added as new CRM contact' : '⚠️ Contact already existed — tags updated'}</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Name</td><td style="padding:8px 12px;border:1px solid #eee">${first_name} ${last_name}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:8px 12px;border:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Phone</td><td style="padding:8px 12px;border:1px solid #eee">${phone ?? '—'}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Source</td><td style="padding:8px 12px;border:1px solid #eee">${source}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Type</td><td style="padding:8px 12px;border:1px solid #eee">${clientType}</td></tr>
            ${message ? `<tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Message</td><td style="padding:8px 12px;border:1px solid #eee">${message}</td></tr>` : ''}
          </table>
          <p style="margin-top:16px"><a href="https://www.fairoaksrealtygroup.com/crm" style="background:#c9922c;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">View in CRM →</a></p>
        </div>
      `,
    }).catch(() => {}); // non-fatal
  }

  return NextResponse.json({ success: true, clientId, isNew });
}
