// Run: npx tsx scripts/secure-folders.test.ts
// The rules of secure folders that must never drift: who may see one, how its password is checked, what a guest's pass
// is tied to, which files are accepted, and which stored files the nightly sweep may remove.
import {
  canSeeGiven, indexVisible, cleanItems, signatureMatches, hashPassword, verifyPassword, passwordProblem, normalizePassword,
  makeGuestSession, checkGuestSession, GUEST_SESSION_MINUTES, brandName, teamLabel, requestEmail, folderEmail, sweepLeftovers,
  removeRequestFiles, UNFINISHED_AFTER_MS, SECURE_BUCKET, OFFICE_PHONE,
} from '../src/lib/secure-upload';
import { scryptSync, randomBytes } from 'crypto';

let bad = 0; let n = 0;
const ok = (cond: unknown, what: string) => { n++; if (!cond) { bad++; console.error('FAIL', what); } };

// ── Who may see a folder ─────────────────────────────────────────────────────
const U = { broker: 'b', maker: 'm', owner: 'o', added: 'a', dealAgent: 'd', other: 'x' };
const row = { created_by: U.maker, shared_with: [U.added], deal_id: 'deal1' as string | null };
const deal = { agent_id: 'someone', assigned_agent_ids: [U.dealAgent] };
ok(canSeeGiven({ userId: U.broker, role: 'super_admin' }, row, U.owner, deal), 'broker sees it');
ok(canSeeGiven({ userId: U.maker, role: 'agent' }, row, U.owner, deal), 'maker sees it');
ok(canSeeGiven({ userId: U.owner, role: 'agent' }, row, U.owner, deal), 'contact owner sees it');
ok(canSeeGiven({ userId: U.added, role: 'agent' }, row, U.owner, deal), 'added agent sees it');
ok(canSeeGiven({ userId: U.dealAgent, role: 'agent' }, row, U.owner, deal), 'agent on the deal sees it');
ok(!canSeeGiven({ userId: U.other, role: 'agent' }, row, U.owner, deal), 'another agent does not');
ok(!canSeeGiven({ userId: U.other, role: 'admin' }, row, U.owner, deal), 'an admin who is none of those does not');
ok(!canSeeGiven({ userId: U.dealAgent, role: 'agent' }, { ...row, deal_id: null }, U.owner, deal), 'deal membership means nothing without a deal on the request');
// The My Drive index
const noHidden = new Set<string>();
const folder = { created_by: U.maker, shared_with: [], deal_id: null, client_id: null, business_unit: 'commercial' };
ok(indexVisible({ userId: U.maker, role: 'agent' }, 'commercial', folder, null, null, noHidden), 'own folder listed');
ok(!indexVisible({ userId: U.maker, role: 'agent' }, 'residential', folder, null, null, noHidden), 'a folder stays in its own workspace');
ok(!indexVisible({ userId: U.other, role: 'admin' }, 'commercial', folder, null, null, noHidden), 'someone else’s folder is not listed for an admin');
const req = { created_by: U.maker, shared_with: [], deal_id: 'deal1', client_id: 'c1', business_unit: 'commercial' };
const contact = { agent_id: U.owner, lead_hold: false, business_unit: 'commercial' };
ok(indexVisible({ userId: U.owner, role: 'agent' }, 'commercial', req, contact, deal, noHidden), 'request listed for the contact owner');
ok(!indexVisible({ userId: U.owner, role: 'agent' }, 'commercial', req, contact, deal, new Set(['deal1'])), 'a hidden deal hides its folder');
ok(!indexVisible({ userId: U.owner, role: 'agent' }, 'commercial', req, { ...contact, lead_hold: true }, deal, noHidden), 'a lead on hold is the broker’s alone');
ok(indexVisible({ userId: U.broker, role: 'super_admin' }, 'commercial', req, { ...contact, lead_hold: true }, deal, noHidden), '…and the broker still sees it');
ok(!indexVisible({ userId: U.owner, role: 'agent' }, 'commercial', req, null, deal, noHidden), 'no contact row → not listed');

// ── Passwords ────────────────────────────────────────────────────────────────
ok(normalizePassword(' Maple-River – 4821 ') === 'mapleriver4821', 'capitals, spaces and dashes do not count');
const h = hashPassword('Maple-River-4821');
ok(h.startsWith('scryptn$') && !h.includes('Maple') && !h.includes('maple'), 'stored as a hash, never the text');
for (const typed of ['Maple-River-4821', 'maple river 4821', 'MAPLERIVER4821', '  maple-river-4821\n', 'Maple—River—4821'])
  ok(verifyPassword(typed, h), `accepted as typed: ${JSON.stringify(typed)}`);
for (const typed of ['Maple-River-4822', 'maple river', '', 'mapleriver48211', 'Maple.River.4821'])
  ok(!verifyPassword(typed, h), `refused: ${JSON.stringify(typed)}`);
ok(hashPassword('Maple-River-4821') !== h, 'a fresh salt every time');
// A hash made before the forgiving rule is still checked exactly.
const salt = randomBytes(16);
const old = `scrypt$16384$${salt.toString('base64url')}$${scryptSync('Exact-Text-99', salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url')}`;
ok(verifyPassword('Exact-Text-99', old) && !verifyPassword('exact text 99', old), 'older hashes stay exact');
ok(!verifyPassword('x', null) && !verifyPassword('x', 'nonsense') && !verifyPassword('x', 'scryptn$16384$$'), 'a missing or broken hash never matches');
ok(passwordProblem('Maple-River-4821') === null && passwordProblem('red-gate-77x') === null, 'good passwords pass');
for (const p of ['short', '- - - - -', 'a-b-c-d-e', 'aaaaaaaa', 'a a a a a a a a', 'Password', 'pass word 1', '1234 5678', 'x'.repeat(129), 12345678, null])
  ok(passwordProblem(p) !== null, `refused as a password: ${JSON.stringify(p)}`);

// ── The guest's pass ─────────────────────────────────────────────────────────
const f1 = { id: '11111111-1111-4111-8111-111111111111', pass_hash: h };
const t0 = 1_800_000_000_000;
const pass = makeGuestSession(f1, t0);
ok(checkGuestSession(f1, pass, t0 + 60_000), 'pass works');
ok(!checkGuestSession(f1, pass, t0 + GUEST_SESSION_MINUTES * 60_000 + 1), 'pass runs out');
ok(!checkGuestSession({ ...f1, id: '22222222-2222-4222-8222-222222222222' }, pass, t0 + 1), 'pass is for one folder');
ok(!checkGuestSession({ ...f1, pass_hash: hashPassword('Maple-River-4821') }, pass, t0 + 1), 'changing the password ends the pass');
ok(!checkGuestSession({ ...f1, pass_hash: null }, pass, t0 + 1), 'no password → no pass');
const [exp, sig] = pass.split('.');
ok(!checkGuestSession(f1, `${Number(exp) + 1000}.${sig}`, t0 + 1), 'a stretched expiry is refused');
ok(!checkGuestSession(f1, `${t0 + 9e9}.${sig}`, t0 + 1) && !checkGuestSession(f1, '', t0) && !checkGuestSession(f1, 'abc', t0), 'forged or empty passes are refused');

// ── Files and checklists ─────────────────────────────────────────────────────
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(24).fill(0x20)]);
ok(signatureMatches('pdf', bytes(0x25, 0x50, 0x44, 0x46)) && !signatureMatches('pdf', bytes(0x4d, 0x5a, 0x90, 0x00)), 'a renamed program is not a PDF');
ok(signatureMatches('jpg', bytes(0xff, 0xd8, 0xff)) && signatureMatches('docx', bytes(0x50, 0x4b, 0x03, 0x04)) && !signatureMatches('exe', bytes(0x4d, 0x5a)), 'signatures');
ok(!signatureMatches('csv', new Uint8Array([0x61, 0x00, 0x62])) && !signatureMatches('csv', new Uint8Array([])), 'a CSV is text');
const items = cleanItems([{ key: 'id', label: ' Photo ID ' }, { key: 'id', label: 'Second' }, { key: '../x', label: 'Odd key' }, { label: '' }, 'junk', ...Array.from({ length: 30 }, (_, i) => ({ label: `L${i}` }))]);
ok(items.length === 15 && items[0].label === 'Photo ID' && new Set(items.map(i => i.key)).size === 15 && items.every(i => /^[a-z0-9_-]+$/i.test(i.key)), 'checklists are cleaned');

// ── What people outside the company read ─────────────────────────────────────
ok(brandName('commercial') === 'CRECO' && brandName('residential') === 'Fair Oaks Realty Group' && teamLabel('residential') === 'your Fair Oaks Realty Group agent', 'each workspace speaks as itself');
const em = requestEmail('residential', { name: 'Pat <b>', senderName: 'Sam', url: 'https://example.test/secure/abc', items: [{ key: 'id', label: 'ID <script>' }], expiresAt: new Date(t0).toISOString(), needsPassword: true });
ok(!em.html.includes('CRECO') && em.html.includes('Fair Oaks Realty Group') && !em.html.includes('<script>') && !em.html.includes('<b>') && em.html.includes(OFFICE_PHONE), 'residential request email: own brand, escaped, office line');
const fe = folderEmail('commercial', { folderName: 'Suite 3118', senderName: 'Sam', url: 'https://example.test/secure/abc', expiresAt: new Date(t0).toISOString(), needsPassword: true, canView: true });
ok(fe.html.includes('password') && !/Maple|4821/.test(fe.html), 'the folder email mentions a password and never carries one');

// ── The sweep: only what nothing points at ───────────────────────────────────
// A stand-in for storage + the two tables, so the rule can be checked without touching anything real.
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW = t0; const oldAt = new Date(NOW - UNFINISHED_AFTER_MS - 60_000).toISOString(); const newAt = new Date(NOW - 5 * 60_000).toISOString();
function world(failRequests = false) {
  const objects = new Map<string, string>([   // path → created_at
    [`req-${A}/1_kept.pdf`, oldAt], [`req-${A}/2_unfinished_old.pdf`, oldAt], [`req-${A}/3_unfinished_new.pdf`, newAt],   // A: live
    [`req-${B}/1_orphan.pdf`, oldAt], [`req-${B}/2_orphan.pdf`, newAt],                                                     // B: no row (contact deleted)
    [`req-${C}/1_left.pdf`, oldAt],                                                                                         // C: folder deleted (purged)
    [`req-${D}/1_kept.pdf`, newAt],                                                                                         // D: live, all recorded
    ['not-a-request/readme.txt', oldAt], ['req-junk/x.pdf', oldAt],                                                         // never ours to touch
  ]);
  const requests = [{ id: A, purged_at: null }, { id: C, purged_at: oldAt }, { id: D, purged_at: null }];
  const files = [{ request_id: A, storage_path: `req-${A}/1_kept.pdf` }, { request_id: D, storage_path: `req-${D}/1_kept.pdf` }];
  const log: string[] = []; const bucketsUsed = new Set<string>();
  const storage = { from: (b: string) => { bucketsUsed.add(b); return {
    list: async (prefix: string, o: { limit: number; offset: number }) => {
      const p = prefix ? `${prefix}/` : '';
      const names = new Map<string, { name: string; id: string | null; created_at: string | null }>();
      for (const [path, at] of objects) {
        if (!path.startsWith(p)) continue;
        const rest = path.slice(p.length); const slash = rest.indexOf('/');
        if (slash >= 0) names.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null, created_at: null });
        else names.set(rest, { name: rest, id: `id-${path}`, created_at: at });
      }
      return { data: [...names.values()].sort((x, y) => x.name.localeCompare(y.name)).slice(o.offset, o.offset + o.limit), error: null };
    },
    remove: async (paths: string[]) => { for (const x of paths) objects.delete(x); return { data: [], error: null }; },
  }; } };
  const from = (table: string) => {
    const q: { _eq?: [string, string]; _in?: [string, string[]] } = {};
    const api = {
      select: () => api, eq: (c: string, v: string) => { q._eq = [c, v]; return api; }, in: (c: string, v: string[]) => { q._in = [c, v]; return api; },
      insert: async (r: { request_id: string; detail: string }) => { log.push(`${r.request_id}: ${r.detail}`); return { error: null }; },
      delete: () => ({ eq: async () => ({ error: null }) }),
      then: (res: (v: unknown) => void) => {
        if (table === 'crm_secure_requests') return res(failRequests ? { data: null, error: { message: 'down' } } : { data: requests.filter(r => q._in![1].includes(r.id)), error: null });
        if (table === 'crm_secure_files') return res({ data: files.filter(f => f.request_id === q._eq![1]), error: null });
        return res({ data: [], error: null });
      },
    };
    return api;
  };
  return { db: { storage, from } as never, objects, log, bucketsUsed };
}
(async () => {
  const quietWarn = console.warn; console.warn = () => {};
  // a dry run counts and removes nothing
  let w = world();
  let r = await sweepLeftovers(w.db, { dry: true, deep: true, now: NOW });
  ok(r.deadFolders === 2 && r.deadObjects === 3 && r.unfinished === 1 && w.objects.size === 9, `dry run only counts (${JSON.stringify(r)})`);
  // the every-run pass: dead folders only
  w = world();
  r = await sweepLeftovers(w.db, { now: NOW });
  ok(r.deadFolders === 2 && r.deadObjects === 3 && r.unfinished === 0, 'every run: folders with no live request');
  ok(![...w.objects.keys()].some(k => k.startsWith(`req-${B}/`) || k.startsWith(`req-${C}/`)), '…their files are gone');
  ok(w.objects.has(`req-${A}/2_unfinished_old.pdf`) && w.objects.has(`req-${A}/1_kept.pdf`) && w.objects.has(`req-${D}/1_kept.pdf`), '…and live folders are untouched');
  // the nightly pass
  w = world();
  r = await sweepLeftovers(w.db, { deep: true, now: NOW });
  ok(r.unfinished === 1 && !w.objects.has(`req-${A}/2_unfinished_old.pdf`), 'nightly: an old upload that never finished is removed');
  ok(w.objects.has(`req-${A}/3_unfinished_new.pdf`), '…a recent one is left alone (it may still be on its way)');
  ok(w.objects.has(`req-${A}/1_kept.pdf`) && w.objects.has(`req-${D}/1_kept.pdf`), '…recorded files are never touched');
  ok(w.objects.has('not-a-request/readme.txt') && w.objects.has('req-junk/x.pdf'), '…nor anything that is not a request folder');
  ok(w.log.some(l => l.startsWith(C)) && w.log.some(l => l.startsWith(A)) && !w.log.some(l => l.startsWith(B)), 'cleaning is written to the folder’s log when the folder still has one');
  ok([...w.bucketsUsed].every(b => b === SECURE_BUCKET), 'only the secure bucket is ever touched');
  // if the database cannot answer, nothing is removed
  w = world(true);
  let threw = false;
  try { await sweepLeftovers(w.db, { deep: true, now: NOW }); } catch { threw = true; }
  ok(threw && w.objects.size === 9, 'no clear answer from the database → nothing is removed');
  // deleting a folder empties its whole storage folder, recorded or not
  w = world();
  const removed = await removeRequestFiles(w.db, A);
  ok(removed === 1 && ![...w.objects.keys()].some(k => k.startsWith(`req-${A}/`)) && w.objects.has(`req-${D}/1_kept.pdf`), 'deleting a folder leaves nothing of it in storage');
  console.warn = quietWarn;

  console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} secure-folder checks passed`);
  process.exit(bad ? 1 : 0);
})();
