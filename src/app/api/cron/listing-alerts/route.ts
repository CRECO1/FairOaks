import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: 'RESEND_API_KEY not configured' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Find listings added in the last 25 hours (slightly > 24h to avoid gaps)
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { data: newListings, error: listErr } = await supabase
    .from('listings')
    .select('id, title, slug, price, city, bedrooms, bathrooms, sqft, images')
    .eq('status', 'active')
    .gte('created_at', since);

  if (listErr) {
    console.error('listing-alerts cron fetch listings error:', listErr.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!newListings || newListings.length === 0) {
    return NextResponse.json({ matched: 0, sent: 0 });
  }

  // Fetch all active alerts
  const { data: alerts, error: alertErr } = await supabase
    .from('listing_alerts')
    .select('*')
    .eq('active', true);

  if (alertErr) {
    console.error('listing-alerts cron fetch alerts error:', alertErr.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!alerts || alerts.length === 0) {
    return NextResponse.json({ matched: 0, sent: 0 });
  }

  let sent = 0;

  for (const alert of alerts) {
    // Match listings to this alert
    const matches = newListings.filter(listing => {
      const cityMatch =
        !alert.cities ||
        alert.cities.length === 0 ||
        alert.cities.includes('All Areas') ||
        alert.cities.includes(listing.city);

      const priceMin = alert.min_price != null ? listing.price >= alert.min_price : true;
      const priceMax = alert.max_price != null ? listing.price <= alert.max_price : true;
      const bedsMatch = alert.min_beds != null ? listing.bedrooms >= alert.min_beds : true;

      return cityMatch && priceMin && priceMax && bedsMatch;
    });

    if (matches.length === 0) continue;

    const listingsHtml = matches.map(l => {
      const imgUrl = Array.isArray(l.images) && l.images[0] ? l.images[0] : null;
      const href = `https://www.fairoaksrealtygroup.com/listings/${esc(l.slug)}`;
      return `
        <div style="border: 1px solid #e5e5e5; border-radius: 10px; overflow: hidden; margin-bottom: 16px;">
          ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(l.title)}" style="width: 100%; height: 200px; object-fit: cover; display: block;" />` : ''}
          <div style="padding: 16px 20px;">
            <p style="margin: 0 0 4px; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 0.05em;">${esc(l.city)}, TX</p>
            <h2 style="margin: 0 0 8px; font-size: 18px; font-weight: bold; color: #1a1a2e;">${esc(l.title)}</h2>
            <p style="margin: 0 0 12px; font-size: 22px; font-weight: bold; color: #c9a84c;">${formatPrice(l.price)}</p>
            <p style="margin: 0 0 16px; font-size: 13px; color: #666;">
              ${l.bedrooms} bd · ${l.bathrooms} ba · ${(l.sqft ?? 0).toLocaleString()} sqft
            </p>
            <a href="${href}" style="display: inline-block; background: #1a1a2e; color: #fff; text-decoration: none; border-radius: 6px; padding: 10px 20px; font-weight: 600; font-size: 14px;">View Listing →</a>
          </div>
        </div>`;
    }).join('');

    try {
      await resend.emails.send({
        from: `Fair Oaks Realty Group <${FROM_EMAIL}>`,
        to: alert.email,
        subject: `🏠 ${matches.length} new listing${matches.length > 1 ? 's' : ''} matching your search`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a2e;">
            <div style="margin-bottom: 32px; border-bottom: 2px solid #c9a84c; padding-bottom: 24px;">
              <p style="font-size: 22px; font-weight: bold; margin: 0;">Fair Oaks <span style="color: #c9a84c;">Realty Group</span></p>
            </div>
            <h1 style="font-size: 20px; font-weight: bold; margin: 0 0 8px;">
              Hi ${esc(alert.name)}, we found ${matches.length} new listing${matches.length > 1 ? 's' : ''} for you!
            </h1>
            <p style="color: #666; margin: 0 0 28px; font-size: 15px;">
              These just hit the market and match your saved search.
            </p>
            ${listingsHtml}
            <p style="margin-top: 32px; font-size: 13px; color: #999;">
              You&rsquo;re receiving this because you saved a search on fairoaksrealtygroup.com.<br />
              To unsubscribe, reply to this email with &ldquo;unsubscribe&rdquo;.<br /><br />
              Fair Oaks Realty Group · 8000 Fair Oaks Pkwy Suite 102, Fair Oaks Ranch, TX 78015 ·
              <a href="tel:+12103909997" style="color: #c9a84c;">210-390-9997</a>
            </p>
          </div>`,
      });
      sent++;
    } catch (e) {
      console.error(`Failed to send alert to ${alert.email}:`, e);
    }
  }

  return NextResponse.json({ newListings: newListings.length, alertsChecked: alerts.length, sent });
}
