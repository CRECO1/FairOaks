#!/usr/bin/env node
/**
 * broker-backfill.mjs — sweep ALL history for the zack@crecotx.com Gmail connection,
 * extract listings with Claude vision, and dedup-insert into crm_prospective_properties.
 *
 * DRY RUN by default (no writes). Pass --commit to actually insert.
 *
 * Run with tsx so the imported TypeScript under src/ transpiles on the fly:
 *   /opt/homebrew/bin/npx tsx scripts/broker-backfill.mjs
 *   /opt/homebrew/bin/npx tsx scripts/broker-backfill.mjs --window=newer_than:2y --limit=1000
 *   /opt/homebrew/bin/npx tsx scripts/broker-backfill.mjs --commit
 *
 * Flags:
 *   --query="..."     override the default Gmail search query
 *   --window=...      append a Gmail recency filter (e.g. newer_than:2y). Omit = all history.
 *   --limit=N         max messages to scan (default 500)
 *   --commit          write to the DB (otherwise dry run)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- load .env.local manually (no dotenv dependency) ---
function loadEnv() {
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    console.warn('Could not load .env.local:', e.message);
  }
}
loadEnv();

// --- parse args ---
function arg(name, def) {
  const pfx = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pfx));
  if (hit) return hit.slice(pfx.length);
  return def;
}
const commit = process.argv.includes('--commit');
const queryOverride = arg('query', undefined);
const windowArg = arg('window', undefined);
const limit = Number(arg('limit', 500));

// --- sanity checks ---
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\nMissing required env var(s): ${missing.join(', ')}`);
  if (missing.includes('ANTHROPIC_API_KEY')) {
    console.error('Add ANTHROPIC_API_KEY to .env.local (same key the CRECOWEBSITE app uses).');
  }
  process.exit(1);
}

// Imported lazily so env is loaded first. tsx resolves the .ts graph.
const { runPipeline, DEFAULT_QUERY } = await import('../src/lib/broker-ingest/index.ts');

let query = queryOverride ?? DEFAULT_QUERY;
if (windowArg) query += ` ${windowArg}`;

console.log(`\nBroker backfill — ${commit ? 'COMMIT (writing to DB)' : 'DRY RUN (no writes)'}`);
console.log(`Query: ${query}`);
console.log(`Limit: ${limit}`);
console.log(`Model: ${process.env.BROKER_INGEST_MODEL || 'claude-sonnet-4-6'}\n`);

const res = await runPipeline({
  query,
  limit,
  commit,
  onProgress: (m) => console.log(m),
});

console.log('\n=== Results ===');
console.log(`  scanned:         ${res.scanned}`);
console.log(`  listings:        ${res.listings}`);
console.log(`  non-listings:    ${res.nonListings}`);
console.log(`  extract errors:  ${res.extractErrors}`);
console.log(`  dup skipped:     ${res.dupSkipped}`);
console.log(`  no address/name: ${res.skippedNoAddress}`);
console.log(`  model:           ${res.model}`);

if (res.wouldInsert.length) {
  console.log(`\n=== ${commit ? 'Inserted' : 'Would insert'} ${res.wouldInsert.length} new propert${res.wouldInsert.length === 1 ? 'y' : 'ies'} ===`);
  for (const r of res.wouldInsert) {
    const loc = [r.city, r.state, r.zip].filter(Boolean).join(', ');
    console.log(
      `  • ${r.name ?? r.address}${r.address && r.name !== r.address ? ` (${r.address})` : ''}` +
        `${loc ? ` — ${loc}` : ''} [${r.asset_type}${r.size_sf ? `, ${r.size_sf} SF` : ''}]` +
        `${r.asking_rate ? ` — ${r.asking_rate}` : ''}` +
        `${r.listing_company ? ` — ${r.listing_company}` : ''}`,
    );
  }
}

console.log(
  commit
    ? `\nDone. Inserted ${res.inserted} row(s).`
    : `\nDry run complete. Re-run with --commit to insert ${res.wouldInsert.length} row(s).`,
);
