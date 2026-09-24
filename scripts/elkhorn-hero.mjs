/**
 * Elkhorn Point campaign emails — put the property rendering behind the headline.
 *
 * The 15 line-of-business email bodies live in Supabase (crm_campaigns.email_body),
 * not in this repo, so this rewrites them in place:
 *
 *   1. the solid black header row becomes a hero row carrying a purpose-cut
 *      rendering of the property, with the same eyebrow + headline over it;
 *   2. the standalone rendering <img> row under the gold band is dropped — the
 *      hero is the visual now, and the old row showed the same picture twice.
 *
 * The hero asset is a dedicated crop (see HERO_IMAGE below and the spec in
 * scripts/elkhorn-hero-block.html), not the split composite the templates used.
 * It must be exported with the shading baked in along the left/bottom, because
 * Outlook's Word engine draws the image through VML and ignores the CSS scrim.
 * If the asset you upload is NOT pre-shaded, pass --mso-black so Outlook keeps
 * the old black header instead of risking unreadable type over a bright sky.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/elkhorn-hero.mjs                       # dry run, reports only
 *     node scripts/elkhorn-hero.mjs --apply               # write the rewritten bodies
 *     node scripts/elkhorn-hero.mjs --apply --id=<uuid>   # one campaign
 *     node scripts/elkhorn-hero.mjs --out=/tmp/elkhorn    # dump the HTML to eyeball
 *     node scripts/elkhorn-hero.mjs --image=https://...   # different hero asset
 *
 * Nothing is written unless --apply is passed, and heroize() is idempotent, so a
 * re-run over already-converted bodies is a no-op.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The purpose-cut hero. Upload this to elkhornpoint.com before sending. */
const HERO_IMAGE = 'https://elkhornpoint.com/hero-elkhorn-point.jpg';
/** The split composite the templates currently carry — used to find them. */
const SPLIT_RENDERING = 'https://elkhornpoint.com/rendering-split.jpg';
const HERO_ALT =
  'Elkhorn Point — new neighborhood retail center on Dietz Elkhorn Road in Fair Oaks Ranch';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MSO_BLACK = args.includes('--mso-black');
const ONLY_ID = args.find((a) => a.startsWith('--id='))?.slice(5) ?? null;
const OUT_DIR = args.find((a) => a.startsWith('--out='))?.slice(6) ?? null;
const IMAGE = args.find((a) => a.startsWith('--image='))?.slice(8) ?? HERO_IMAGE;

/** The black header row, as the templates currently carry it. */
const HEADER_ROW = /<tr>\s*<td style="background:#1A1A1A;padding:28px 40px;">([\s\S]*?)<\/td>\s*<\/tr>/i;
/** The full-width split rendering row that currently sits under the gold band. */
const IMAGE_ROW = new RegExp(`<tr>\\s*<td[^>]*>\\s*<img src="${SPLIT_RENDERING}"[\\s\\S]*?<\\/td>\\s*<\\/tr>`, 'i');

/**
 * Outlook desktop can't paint a CSS background image, so it gets the hero through
 * VML. --mso-black opts out and leaves Outlook on the original black header.
 */
function msoHero(eyebrow, headline, image) {
  if (MSO_BLACK) {
    return `<!--[if mso]>
        <tr>
          <td style="background:#1A1A1A;padding:28px 40px;">
            <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#C9922C;font-weight:700;">${eyebrow}</p>
            <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:700;line-height:1.3;">${headline}</h1>
          </td>
        </tr>
        <![endif]-->`;
  }
  return `<!--[if mso]>
        <tr>
          <td style="padding:0;">
            <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:315px;">
              <v:fill type="frame" src="${image}" color="#1A1A1A" />
              <v:textbox inset="40px,72px,40px,64px">
                <div>
                  <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#E3B45A;font-weight:700;">${eyebrow}</p>
                  <h1 style="margin:10px 0 0;font-size:25px;color:#ffffff;font-weight:700;line-height:1.3;">${headline}</h1>
                </div>
              </v:textbox>
            </v:rect>
          </td>
        </tr>
        <![endif]-->`;
}

function heroRows(eyebrow, headline, image) {
  return `${msoHero(eyebrow, headline, image)}
        <!--[if !mso]><!-->
        <tr>
          <td background="${image}" style="padding:0;background-color:#1A1A1A;background-image:url('${image}');background-position:center center;background-size:cover;background-repeat:no-repeat;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
              <tr>
                <td style="background-color:rgba(10,10,10,0.38);padding:72px 40px 64px;">
                  <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#E3B45A;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,0.75);">${eyebrow}</p>
                  <h1 style="margin:10px 0 0;font-size:25px;color:#ffffff;font-weight:700;line-height:1.3;text-shadow:0 2px 8px rgba(0,0,0,0.8);">${headline}</h1>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!--<![endif]-->`;
}

/**
 * Rewrites one email body. Returns { html, changed, reason }.
 * Idempotent: a body that already carries the hero is left alone.
 */
export function heroize(html, image = IMAGE) {
  if (!html) return { html, changed: false, reason: 'empty body' };
  if (html.includes('background-size:cover')) return { html, changed: false, reason: 'already has the hero' };

  const header = html.match(HEADER_ROW);
  if (!header) return { html, changed: false, reason: 'no black header row found' };

  const eyebrow = header[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.trim();
  const headline = header[1].match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.trim();
  if (!eyebrow || !headline) return { html, changed: false, reason: 'header row had no eyebrow/headline' };

  let out = html.replace(HEADER_ROW, heroRows(eyebrow, headline, image));
  // The rendering is the hero now — drop the duplicate below the gold band.
  out = out.replace(IMAGE_ROW, '');

  return { html: out, changed: true, reason: `hero applied (${MSO_BLACK ? 'Outlook on black header' : 'Outlook on VML image'})` };
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
    .like('email_body', `%${SPLIT_RENDERING}%`);
  if (ONLY_ID) query = query.eq('id', ONLY_ID);

  const { data: campaigns, error } = await query;
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!campaigns?.length) { console.log('No campaigns reference the split rendering — nothing to do.'); return; }

  if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });

  let changed = 0;
  for (const c of campaigns) {
    const result = heroize(c.email_body, IMAGE);
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
    `\nHero image: ${IMAGE}\n${campaigns.length} campaign(s) matched, ${changed} rewritten${APPLY ? ' and saved' : ' (dry run — pass --apply to save)'}.`
  );
  if (OUT_DIR) console.log(`HTML written to ${OUT_DIR}`);
}

// Only talk to the database when run directly — importing this file just gives you heroize().
if (process.argv[1] && process.argv[1].endsWith('elkhorn-hero.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
