import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@fairoaksrealtygroup.com';
const FROM_EMAIL = 'onboarding@resend.dev'; // works on free Resend plan; swap to noreply@fairoaksrealtygroup.com after domain verification

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, answers } = body;

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    const answerSummary = Object.entries(answers ?? {})
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : v}`)
      .join('\n');

    // ── Save lead to Supabase ───────────────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('leads').insert([{
        name,
        email,
        phone: phone ?? null,
        source: 'quiz',
        status: 'new',
        quiz_data: answers ?? {},
        message: `Quiz Answers:\n${answerSummary}`,
      }]);
    }

    // ── Auto-create CRM client from quiz lead ──────────────────────────────────
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, serviceKey);
        const { data: adminProfile } = await supabaseAdmin.from('crm_profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
        const adminId = adminProfile?.id;
        if (adminId) {
          const { data: existing } = await supabaseAdmin.from('crm_clients').select('id').eq('email', email).maybeSingle();
          if (!existing) {
            const nameParts = name.trim().split(/\s+/);
            const unsubscribe_token = crypto.randomUUID();
            await supabaseAdmin.from('crm_clients').insert([{
              first_name: nameParts[0] ?? name,
              last_name: nameParts.slice(1).join(' ') ?? '',
              email,
              phone: phone ?? '',
              type: 'Buyer',
              notes: `📩 Website Quiz lead\nQuiz Answers:\n${answerSummary}`,
              agent_id: adminId,
              assigned_agent_ids: [],
              lead_source: 'Website Quiz',
              tags: ['New Lead'],
              unsubscribe_token,
            }]);
          }
        }
      } catch (crmErr) {
        console.error('Quiz CRM sync error:', crmErr);
      }
    }

    // ── Send email notifications via Resend ────────────────────────────────────
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Notify the team
      await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        subject: `🏠 New Quiz Lead: ${name}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px">
            <h2 style="color:#1a1a2e">New Quiz Lead — Fair Oaks Realty Group</h2>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Name</td><td style="padding:8px 12px;border:1px solid #eee">${name}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:8px 12px;border:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Phone</td><td style="padding:8px 12px;border:1px solid #eee">${phone ?? '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Source</td><td style="padding:8px 12px;border:1px solid #eee">Home Finder Quiz</td></tr>
            </table>
            <h3 style="color:#1a1a2e;margin-top:20px">Quiz Answers:</h3>
            <pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">${answerSummary}</pre>
          </div>
        `,
      });

      // Auto-reply to the lead
      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your personalized home recommendations — Fair Oaks Realty Group',
        html: `
          <div style="font-family:sans-serif;max-width:600px">
            <h2 style="color:#1a1a2e">Hi ${name},</h2>
            <p>Thanks for completing our Home Finder Quiz! Based on your answers, one of our local experts will reach out within 24 hours with personalized home recommendations matched to your criteria.</p>
            <p>Want to connect sooner? Call us at <a href="tel:+12103909997">(210) 390-9997</a>.</p>
            <br/>
            <p>— The Fair Oaks Realty Group Team</p>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Quiz lead error:', err);
    return NextResponse.json({ error: 'Failed to submit quiz lead' }, { status: 500 });
  }
}
