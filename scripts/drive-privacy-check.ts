/**
 * Who may build a person's private live tracker in My Drive (src/lib/drive-sheet-feeds.ts → feedsAllowed) — no database, no network.
 *   npx tsx scripts/drive-privacy-check.ts
 * Robert's and Brian's trackers (outreach emails, reply rates, activity log, card notes) hold one person's sent mail, calls and notes and are read with
 * the service key, so only that person or the account owner may build them. An `admin` (Brian) is NOT enough: he can't open Robert's sheet, and must not be
 * able to rebuild its data in a sheet of his own. Exits non-zero on the first failed expectation.
 */
import assert from 'node:assert/strict';
import type { DriveContext } from '../src/lib/drive-server';

const PEOPLE: Record<string, string> = { 'robert@crecotx.com': 'id-robert', 'brian@crecotx.com': 'id-brian' };
type Who = { userId: string; role: 'super_admin' | 'admin' | 'agent' };
const dcFor = (w: Who) => ({
  isSuperAdmin: w.role === 'super_admin',
  isAdmin: w.role === 'super_admin' || w.role === 'admin',
  ctx: { userId: w.userId, role: w.role },
  // feedsAllowed only looks a person up by email: from('crm_profiles').select('id').ilike('email', x).maybeSingle()
  admin: { from: () => ({ select: () => ({ ilike: (_c: string, email: string) => ({ maybeSingle: async () => ({ data: PEOPLE[email.toLowerCase()] ? { id: PEOPLE[email.toLowerCase()] } : null }) }) }) }) },
}) as unknown as DriveContext;

const ZACK: Who = { userId: 'id-zack', role: 'super_admin' };
const BRIAN: Who = { userId: 'id-brian', role: 'admin' };
const ROBERT: Who = { userId: 'id-robert', role: 'agent' };
const ED: Who = { userId: 'id-ed', role: 'agent' };
const ROBERT_FEEDS = ['robert_emails', 'robert_summary', 'robert_card_notes', 'robert_activity'] as const;
const BRIAN_FEEDS = ['brian_emails', 'brian_summary'] as const;
const SHARED_FEEDS = ['elkhorn_tenants', 'elkhorn_calls', 'french_pl_tenants', 'french_pl_calls'] as const;

(async () => {
  const mod = await import(process.env.FEEDS_MODULE ?? '../src/lib/drive-sheet-feeds');
  const allowed = mod.feedsAllowed as (keys: string[], dc: DriveContext) => Promise<boolean>;
  let n = 0;
  const ok = async (name: string, fn: () => Promise<void>) => { await fn(); n++; console.log(`  ok  ${name}`); };

  for (const k of ROBERT_FEEDS) await ok(`Brian (admin) cannot build Robert's "${k}"`, async () => assert.equal(await allowed([k], dcFor(BRIAN)), false));
  await ok('Brian cannot sneak Robert\'s feed in next to his own', async () => assert.equal(await allowed(['brian_emails', 'robert_emails'], dcFor(BRIAN)), false));
  for (const k of BRIAN_FEEDS) await ok(`Brian can build his own "${k}"`, async () => assert.equal(await allowed([k], dcFor(BRIAN)), true));
  for (const k of ROBERT_FEEDS) await ok(`Robert can build his own "${k}"`, async () => assert.equal(await allowed([k], dcFor(ROBERT)), true));
  for (const k of BRIAN_FEEDS) await ok(`Robert cannot build Brian's "${k}"`, async () => assert.equal(await allowed([k], dcFor(ROBERT)), false));
  for (const k of [...ROBERT_FEEDS, ...BRIAN_FEEDS]) await ok(`Zack (owner) can build "${k}"`, async () => assert.equal(await allowed([k], dcFor(ZACK)), true));
  for (const k of [...ROBERT_FEEDS, ...BRIAN_FEEDS]) await ok(`Ed (agent) cannot build "${k}"`, async () => assert.equal(await allowed([k], dcFor(ED)), false));
  for (const k of SHARED_FEEDS) for (const [nm, w] of [['Brian', BRIAN], ['Robert', ROBERT], ['Ed', ED], ['Zack', ZACK]] as const)
    await ok(`${nm} can build the shared "${k}"`, async () => assert.equal(await allowed([k], dcFor(w)), true));
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
