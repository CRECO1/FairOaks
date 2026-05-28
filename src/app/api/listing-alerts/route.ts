import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { rateLimit } from '@/lib/ratelimit';

const FROM_EMAIL = process.env.FROM_EMAIL ?? 'onboarding@resend.dev';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, 'leads');
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests — please wait a few minutes.' }, { status: 429 });
    }

    const body = await req.json();
    const { name, email, cities, min_price, max_price, min_beds, min_baths, search } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (typeof name === 'string' && name.length > 200) {
      return NextResponse.json({ error: 'Name too long' }, { status: 400 });
    }
    if (min_price !== undefined && (typeof min_price !== 'number' || min_price < 0)) {
      return NextResponse.json({ error: 'Invalid min_price' }, { status: 400 });
    }
    if (max_price !== undefined && (typeof max_price !== 'number' || max_price < 0)) {
      return NextResponse.json({ error: 'Invalid max_price' }, { status: 400 });
    }
    if (min_beds !== undefined && (typeof min_beds !== 'number' || min_beds < 0)) {
      return NextResponse.json({ error: 'Invalid min_beds' }, { status: 400 });
    }
    if (min_baths !== undefined && (typeof min_baths !== 'number' || min_baths < 0)) {
      return NextResponse.json({ error: 'Invalid min_baths' }, { status: 400 });
    }
    if (search !== undefined && search !== null && typeof search !== 'string') {
      return NextResponse.json({ error: 'Invalid search' }, { status: 400 });
    }

    const safeCities: string[] = Array.isArray(cities) ? cities.slice(0, 20).map(String).filter(c => c.length <= 100) : [];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const safeSearch = typeof search === 'string' ? search.slice(0, 200).trim() : null;

    const { error: dbErr } = await supabase.from('listing_alerts').insert([{
      name: name.trim(),
      email: email.toLowerCase().trim(),
      cities: safeCities,
      min_price: min_price ?? null,
      max_price: max_price ?? null,
      min_beds: min_beds ?? null,
      min_baths: min_baths ?? null,
      search: safeSearch || null,
    }]);

    if (dbErr) {
      console.error('listing_alerts insert error:', dbErr.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Send confirmation email
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const filterParts = [
        safeCities.length > 0 && safeCities[0] !== 'All Areas' ? safeCities.join(', ') : 'All Areas',
        safeSearch ? `"${safeSearch}"` : null,
        min_price ? `$${(min_price / 1000).toFixed(0)}k+` : null,
        max_price ? `up to $${(max_price / 1000).toFixed(0)}k` : null,
        min_beds ? `${min_beds}+ beds` : null,
        min_baths ? `${min_baths}+ baths` : null,
      ].filter(Boolean).join(' · ');

      await resend.emails.send({
        from: `Fair Oaks Realty Group <${FROM_EMAIL}>`,
        to: email,
        subject: '🔔 Your listing alert is set up!',
        html: `
          <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a2e;">
            <div style="margin-bottom: 32px; border-bottom: 2px solid #c9a84c; padding-bottom: 24px;">
              <p style="font-size: 22px; font-weight: bold; margin: 0;">Fair Oaks <span style="color: #c9a84c;">Realty Group</span></p>
            </div>
            <h1 style="font-size: 22px; font-weight: bold; margin: 0 0 8px;">You&rsquo;re all set, ${esc(name)}!</h1>
            <p style="color: #666; margin: 0 0 24px;">We&rsquo;ll email you the moment a new listing matches your search:</p>
            <div style="background: #f8f5ee; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; font-weight: 600;">
              ${esc(filterParts)}
            </div>
            <p style="color: #666; font-size: 14px; margin: 0 0 32px;">
              You&rsquo;ll only hear from us when there&rsquo;s a match — no spam, ever.
              To unsubscribe at any time, simply reply to this email.
            </p>
            <a href="https://www.fairoaksrealtygroup.com/listings" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; border-radius: 8px; padding: 12px 24px; font-weight: 600; font-size: 15px;">Browse Current Listings</a>
            <p style="margin-top: 40px; font-size: 13px; color: #999;">
              Fair Oaks Realty Group · 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015<br />
              <a href="tel:+12103909997" style="color: #c9a84c;">(210) 390-9997</a>
            </p>
          </div>`,
      }).catch(e => console.error('Resend confirmation error:', e));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('listing-alerts POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
