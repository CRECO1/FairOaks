import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';
import { adminClient, SUPABASE_URL } from '@/lib/supabase-admin';

// Stripe signature verification needs the raw body + the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Where the new owner is sent to set their password and land in the CRM.
const SET_PASSWORD_REDIRECT = 'https://crm.vultstack.com/manage/login';

export async function POST(req: NextRequest) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe webhook] not configured (missing key or signing secret)');
    return NextResponse.json({ error: 'Billing not configured.' }, { status: 503 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await provisionFromCheckout(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        // Ignore everything else.
        break;
    }
  } catch (err) {
    // Log and 500 so Stripe retries (the handler is idempotent).
    console.error(`[stripe webhook] handler error for ${event.type}:`, err);
    return NextResponse.json({ error: 'Handler error.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// --- pay -> provision org + owner -> email set-password link --------------
async function provisionFromCheckout(session: Stripe.Checkout.Session) {
  if (!stripe) return;
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subscriptionId) {
    console.warn('[provision] checkout.session.completed with no subscription — skipping');
    return;
  }

  const supabase = adminClient();

  // Idempotency: if we already provisioned this subscription, do nothing.
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (existing) {
    console.log('[provision] already provisioned for subscription', subscriptionId);
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];
  const seats = item?.quantity ?? Number(session.metadata?.seats ?? 1);
  const periodEndUnix = subPeriodEnd(subscription);
  const plan = session.metadata?.plan ?? 'starter';
  const period = session.metadata?.period ?? 'monthly';
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

  const email = session.customer_details?.email ?? session.customer_email ?? null;
  if (!email) {
    console.error('[provision] no customer email on session', session.id);
    throw new Error('No customer email');
  }
  const fullName = session.customer_details?.name ?? '';
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  const lastName = rest.join(' ');
  const orgName = fullName || `${email.split('@')[0]}'s Brokerage`;

  // Create the tenant org with billing state.
  const slug = await uniqueSlug(supabase, orgName || email.split('@')[0]);
  const periodEnd = periodEndUnix;
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({
      name: orgName,
      slug,
      status: 'active',
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan,
      billing_period: period,
      seats,
      billing_status: subscription.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      owner_email: email,
    })
    .select('id')
    .single();
  if (orgErr || !org) {
    console.error('[provision] org insert failed:', orgErr);
    throw new Error('Org insert failed');
  }

  // Create the owner auth user + a set-password link (we email it via Resend).
  const actionLink = await createOwnerAndLink(email, firstName || '', lastName);

  // Owner profile, scoped to the new org, with admin rights.
  await supabase.from('crm_profiles').upsert(
    {
      id: actionLink.userId,
      email,
      first_name: firstName || null,
      last_name: lastName || null,
      role: 'admin',
      business_unit: 'residential',
      org_id: org.id,
    },
    { onConflict: 'id' }
  );

  await sendWelcomeEmail(email, firstName || 'there', actionLink.link);
  console.log('[provision] org', org.id, 'owner', email, 'plan', plan, 'seats', seats);
}

// Keep org billing state in sync on plan/seat/status changes & cancellation.
async function syncSubscription(subscription: Stripe.Subscription) {
  const supabase = adminClient();
  const seats = subscription.items.data[0]?.quantity ?? null;
  const periodEnd = subPeriodEnd(subscription);
  const canceled = subscription.status === 'canceled' || subscription.cancel_at_period_end;
  await supabase
    .from('organizations')
    .update({
      seats,
      billing_status: subscription.status,
      status: canceled ? 'canceled' : 'active',
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);
}

// --- helpers --------------------------------------------------------------
// In newer Stripe API versions current_period_end lives on the subscription
// item; older versions had it on the subscription. Check both.
function subPeriodEnd(subscription: Stripe.Subscription): number | undefined {
  const item = subscription.items.data[0] as unknown as { current_period_end?: number };
  const sub = subscription as unknown as { current_period_end?: number };
  return item?.current_period_end ?? sub.current_period_end;
}

async function uniqueSlug(
  supabase: ReturnType<typeof adminClient>,
  base: string
): Promise<string> {
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'brokerage';
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

// Create the auth user (or reuse if it exists) and return a link that lets
// them set a password. Uses Supabase admin generate_link (no email sent here).
async function createOwnerAndLink(
  email: string,
  firstName: string,
  lastName: string
): Promise<{ link: string; userId: string }> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  const gen = async (type: 'invite' | 'recovery') => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        type,
        email,
        redirect_to: SET_PASSWORD_REDIRECT,
        data: { firstName, lastName, role: 'admin' },
      }),
    });
    return { ok: res.ok, body: await res.json() };
  };

  // New customer → invite. If already registered, fall back to a recovery link.
  let r = await gen('invite');
  if (!r.ok) r = await gen('recovery');
  if (!r.ok) {
    console.error('[provision] generate_link failed:', r.body);
    throw new Error('generate_link failed');
  }
  return { link: r.body.action_link as string, userId: (r.body.user?.id ?? r.body.id) as string };
}

async function sendWelcomeEmail(email: string, firstName: string, link: string) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('[provision] RESEND_API_KEY missing — cannot email set-password link');
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: 'VultStack <noreply@fairoaksrealtygroup.com>',
      to: [email],
      subject: 'Welcome to VultStack — set your password to get started',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background:#0c0c0e;">
          <div style="text-align:center; margin-bottom:32px;">
            <h1 style="font-family:Georgia,serif; color:#ffffff; margin:0; font-size:30px;">
              Vult<span style="color:#c9922c;">Stack</span>
            </h1>
            <p style="color:#9ca3af; margin:6px 0 0;">The operating system for modern brokerages</p>
          </div>
          <div style="background:#16161a; border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:32px;">
            <p style="color:#e5e7eb; font-size:16px;">Hi ${firstName},</p>
            <p style="color:#e5e7eb; font-size:16px;">
              Your payment was received and your VultStack workspace is ready.
              Set your password to log in and start onboarding your team.
            </p>
            <div style="text-align:center; margin:32px 0;">
              <a href="${link}"
                style="background:#c9922c; color:#0c0c0e; padding:14px 32px; border-radius:10px;
                       text-decoration:none; font-size:16px; font-weight:700; display:inline-block;">
                Set your password &amp; log in
              </a>
            </div>
            <p style="color:#9ca3af; font-size:13px; text-align:center;">
              This link expires in 24 hours. If the button doesn't work, copy and paste this URL:<br/>
              <span style="color:#c9922c; word-break:break-all;">${link}</span>
            </p>
          </div>
          <p style="color:#6b7280; font-size:12px; text-align:center; margin-top:24px;">
            © ${new Date().getFullYear()} VultStack · You're receiving this because you started a VultStack subscription.
          </p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    console.error('[provision] Resend welcome email failed:', await res.json());
  }
}
