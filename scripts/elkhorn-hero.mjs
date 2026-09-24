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
 * The rendering goes in as a real <img> at the very top, with the headline on a
 * black band directly beneath it. An earlier pass used the image as a CSS
 * background with the type over it; Gmail strips background-image on a <td> and
 * fell back to a black box, so the picture never appeared. A plain <img> renders
 * everywhere, Outlook included, and needs no VML or conditional comments.
 *
 * The hero asset is a dedicated crop (see HERO_IMAGE below and the spec in
 * scripts/elkhorn-hero-block.html), not the split composite the templates used.
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
/** Present only in a body that already carries the image-first hero. */
const HERO_MARKER = 'padding:0;background:#1A1A1A;line-height:0;font-size:0;';
const HERO_ALT =
  'Elkhorn Point — new neighborhood retail center on Dietz Elkhorn Road in Fair Oaks Ranch';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_ID = args.find((a) => a.startsWith('--id='))?.slice(5) ?? null;
const OUT_DIR = args.find((a) => a.startsWith('--out='))?.slice(6) ?? null;
const IMAGE = args.find((a) => a.startsWith('--image='))?.slice(8) ?? HERO_IMAGE;

/** The black header row, as the templates currently carry it. */
const HEADER_ROW = /<tr>\s*<td style="background:#1A1A1A;padding:28px 40px;">([\s\S]*?)<\/td>\s*<\/tr>/i;
/** The full-width split rendering row that currently sits under the gold band. */
const IMAGE_ROW = new RegExp(`<tr>\\s*<td[^>]*>\\s*<img src="${SPLIT_RENDERING}"[\\s\\S]*?<\\/td>\\s*<\\/tr>`, 'i');

function heroRows(eyebrow, headline, image) {
  return `<tr>
          <td style="padding:0;background:#1A1A1A;line-height:0;font-size:0;">
            <img src="${image}" width="600" alt="${HERO_ALT}" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
          </td>
        </tr>
        <tr>
          <td style="background:#1A1A1A;padding:26px 40px 30px;">
            <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#C9922C;font-weight:700;">${eyebrow}</p>
            <h1 style="margin:9px 0 0;font-size:24px;color:#ffffff;font-weight:700;line-height:1.3;">${headline}</h1>
          </td>
        </tr>`;
}

/**
 * Rewrites one email body. Returns { html, changed, reason }.
 * Idempotent: a body that already carries the hero is left alone.
 */
export function heroize(html, image = IMAGE) {
  if (!html) return { html, changed: false, reason: 'empty body' };
  if (html.includes(HERO_MARKER)) return { html, changed: false, reason: 'already has the hero' };

  const header = html.match(HEADER_ROW);
  if (!header) return { html, changed: false, reason: 'no black header row found' };

  const eyebrow = header[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.trim();
  const headline = header[1].match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.trim();
  if (!eyebrow || !headline) return { html, changed: false, reason: 'header row had no eyebrow/headline' };

  // Drop the old full-width rendering row FIRST. The hero we insert below carries
  // an <img> of its own, and when --image is the same file the old row's pattern
  // would match the new hero and delete it instead.
  let out = html.replace(IMAGE_ROW, '');
  // The rendering is the hero now, at the very top.
  out = out.replace(HEADER_ROW, heroRows(eyebrow, headline, image));

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
