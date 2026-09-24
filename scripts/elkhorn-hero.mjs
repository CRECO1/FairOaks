/**
 * Elkhorn Point campaign emails — put the rendering behind the headline.
 *
 * The 15 line-of-business email bodies live in Supabase (crm_campaigns.email_body),
 * not in this repo, so this rewrites them in place:
 *
 *   1. the solid black header row becomes a hero row with rendering-split.jpg as the
 *      background and the same eyebrow + headline reversed out over a dark scrim;
 *   2. the standalone rendering <img> row under the gold band is dropped for every
 *      client that can draw the hero, and kept Outlook-only (Word can't do background
 *      images, so Outlook keeps the black header and the image below the gold band).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/elkhorn-hero.mjs --dry-run          # report only (default)
 *     node scripts/elkhorn-hero.mjs --apply            # write the rewritten bodies
 *     node scripts/elkhorn-hero.mjs --apply --id=<uuid>  # one campaign
 *     node scripts/elkhorn-hero.mjs --dry-run --out=/tmp/elkhorn  # dump HTML to eyeball
 *
 * Nothing is written unless --apply is passed. Every body it touches is dumped to
 * --out first if you give it one, so you can diff before committing to a send.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RENDERING = 'https://elkhornpoint.com/rendering-split.jpg';
const RENDERING_ALT =
  'Elkhorn Point — new neighborhood retail center, two ±10,000 SF buildings in Fair Oaks Ranch';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_ID = args.find((a) => a.startsWith('--id='))?.slice(5) ?? null;
const OUT_DIR = args.find((a) => a.startsWith('--out='))?.slice(6) ?? null;

/** The black header row, as the templates currently carry it. */
const HEADER_ROW = /<tr>\s*<td style="background:#1A1A1A;padding:28px 40px;">([\s\S]*?)<\/td>\s*<\/tr>/i;
/** The full-width rendering row that currently sits under the gold band. */
const IMAGE_ROW = new RegExp(`<tr>\\s*<td[^>]*>\\s*<img src="${RENDERING}"[\\s\\S]*?<\\/td>\\s*<\\/tr>`, 'i');

function heroRows(eyebrow, headline) {
  return `<!--[if mso]>
        <tr>
          <td style="background:#1A1A1A;padding:28px 40px;">
            <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#C9922C;font-weight:700;">${eyebrow}</p>
            <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:700;line-height:1.3;">${headline}</h1>
          </td>
        </tr>
        <![endif]-->
        <!--[if !mso]><!-->
        <tr>
          <td background="${RENDERING}" style="padding:0;background-color:#1A1A1A;background-image:url('${RENDERING}');background-position:center center;background-size:cover;background-repeat:no-repeat;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
              <tr>
                <td style="background-color:rgba(10,10,10,0.56);padding:76px 40px 68px;">
                  <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#E3B45A;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,0.75);">${eyebrow}</p>
                  <h1 style="margin:10px 0 0;font-size:25px;color:#ffffff;font-weight:700;line-height:1.3;text-shadow:0 2px 8px rgba(0,0,0,0.8);">${headline}</h1>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!--<![endif]-->`;
}

/** Outlook-only copy of the rendering, kept under the gold band. */
const MSO_IMAGE_ROW = `<!--[if mso]>
        <tr><td style="padding:0;background:#ffffff;line-height:0;font-size:0;"><img src="${RENDERING}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" alt="${RENDERING_ALT}" /></td></tr>
        <![endif]-->`;

/**
 * Rewrites one email body. Returns { html, changed, reason }.
 * Idempotent: a body that already carries the hero is left alone.
 */
export function heroize(html) {
  if (!html) return { html, changed: false, reason: 'empty body' };
  if (html.includes('background-size:cover')) return { html, changed: false, reason: 'already has the hero' };

  const header = html.match(HEADER_ROW);
  if (!header) return { html, changed: false, reason: 'no black header row found' };

  const eyebrow = header[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.trim();
  const headline = header[1].match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.trim();
  if (!eyebrow || !headline) return { html, changed: false, reason: 'header row had no eyebrow/headline' };

  let out = html.replace(HEADER_ROW, heroRows(eyebrow, headline));

  // The rendering is the hero now — keep it below the gold band for Outlook only.
  out = IMAGE_ROW.test(out) ? out.replace(IMAGE_ROW, MSO_IMAGE_ROW) : out;

  return { html: out, changed: true, reason: 'hero applied' };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
    process.exit(1);
  }

  // Imported here rather than at module scope so heroize() can be unit-tested
  // without the app's dependencies installed.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let query = supabase
    .from('crm_campaigns')
    .select('id, name, status, email_subject, email_body')
    .eq('type', 'email')
    .like('email_body', `%${RENDERING}%`);
  if (ONLY_ID) query = query.eq('id', ONLY_ID);

  const { data: campaigns, error } = await query;
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!campaigns?.length) { console.log('No campaigns reference the rendering — nothing to do.'); return; }

  if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });

  let changed = 0;
  for (const c of campaigns) {
    const result = heroize(c.email_body);
    console.log(`${result.changed ? 'rewrite' : '  skip '}  ${c.status.padEnd(9)} ${c.name} — ${result.reason}`);
    if (!result.changed) continue;
    changed++;

    if (OUT_DIR) {
      const slug = c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      writeFileSync(join(OUT_DIR, `${slug}.html`), result.html);
    }

    if (APPLY) {
      const { error: updateErr } = await supabase
        .from('crm_campaigns')
        .update({ email_body: result.html })
        .eq('id', c.id);
      if (updateErr) console.error(`  !! ${c.name}: ${updateErr.message}`);
    }
  }

  console.log(
    `\n${campaigns.length} campaign(s) matched, ${changed} rewritten${APPLY ? ' and saved' : ' (dry run — pass --apply to save)'}.`
  );
  if (OUT_DIR) console.log(`HTML written to ${OUT_DIR}`);
}

// Only talk to the database when run directly — importing this file just gives you heroize().
if (process.argv[1] && process.argv[1].endsWith('elkhorn-hero.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
