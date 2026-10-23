#!/usr/bin/env node
// Staged Talkroute cutover for the call screen (src/app/api/voice/screen). SAFE BY DEFAULT: every command is a
// DRY RUN that only reads Talkroute and prints what it WOULD change. Nothing is written without --yes.
//
//   TALKROUTE_API_KEY=… node scripts/call-screen-cutover.mjs <command> [--yes] [--window=10] [--route-now] [--keep] [--force]
//
//   status                    read-only: current members / callerId / destination for both lines vs. the known-good snapshot
//   apply-creco               CRECO team group: add "Call screen" as member 1 (8 s), everything else unchanged
//   apply-fairoaks            Fair Oaks team group: callerId -> null AND add "Call screen" as member 1 (8 s)
//   rollback-creco | rollback-fairoaks   put the group back EXACTLY as snapshotted (2026-10-22)
//   rollback-all
//
//   --window=N    TEST MODE. After applying, wait N minutes and then roll back automatically (Ctrl-C rolls back at once).
//                 Without --window the change stays until you run rollback-*. Use --window for the first test call.
//   --route-now   Also point that Talkroute NUMBER at its team group so a test call outside business hours goes through
//                 the team group (after hours the hourly cron sends numbers straight to the bot group, bypassing it).
//                 Rollback restores the number's previous destination. The cron re-asserts its own schedule at :05 every
//                 hour, so keep the test window clear of :05.
//   --keep        with --window: do not auto-roll back at the end
//   --force       skip the "live config still matches the snapshot" guard (don't, unless you've looked)
//
// If anything fails to verify after a write, the script rolls that line back itself and exits non-zero.
import fs from 'node:fs';
import os from 'node:os';

const KEY = process.env.TALKROUTE_API_KEY;
if (!KEY) { console.error('TALKROUTE_API_KEY is not set'); process.exit(2); }
const [cmd, ...flags] = process.argv.slice(2);
const YES = flags.includes('--yes'), ROUTE_NOW = flags.includes('--route-now'), KEEP = flags.includes('--keep'), FORCE = flags.includes('--force');
const WINDOW = Number((flags.find(f => f.startsWith('--window=')) || '').slice(9)) || 0;

const BASE = 'https://api.talkroute.com/api/v2';
const SCREEN = { number: '+18304150086', description: 'Call screen', seconds: 8 };
const BOT_GROUP = '74980a59-5009-4531-bdd2-d4e05877cf08';
const STATE_FILE = `${os.homedir()}/.call-screen-cutover.json`;   // remembers which lines were --route-now'd
function businessOpen(now = new Date()) {   // identical to isBusinessOpen() in src/lib/talkroute.ts: Mon–Sat 8:00–18:00 Central
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  const day = p.find(x => x.type === 'weekday')?.value, hour = Number(p.find(x => x.type === 'hour')?.value) % 24;
  return day !== 'Sun' && hour >= 8 && hour < 18;
}
const readState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {});

// ── Known-good snapshot, captured live 2026-10-22 (full JSON in docs/CALL-SCREEN-CUTOVER.md) ─────────────────────
const LINES = {
  creco: {
    label: 'CRECO 210-817-3443', numberId: '105036', group: 'c24dc035-b8d0-11ee-9d13-246e96bdfb98', callerId: null, maxHoldTime: 180,
    members: [ // device id, name, ring seconds — in sequence order
      { dev: '262146', name: 'Primary Forward Number', secs: 15 }, { dev: '356526', name: 'Brian Blanco', secs: 15 },
      { dev: '353357', name: 'Ed Blanco', secs: 15 }, { dev: '373044', name: 'AI receptionist', secs: 60 } ],
  },
  fairoaks: {
    label: 'Fair Oaks 210-390-9997', numberId: '142802', group: '5063974a-381b-11f1-b25d-246e96bdfb98', callerId: 142802, maxHoldTime: 180,
    members: [ { dev: '262146', name: 'Primary Forward Number', secs: 15 }, { dev: '373044', name: 'AI receptionist', secs: 60 } ],
  },
};

async function tr(method, path, body) {
  if (method !== 'GET' && !YES) { console.log(`   [dry-run] WOULD ${method} ${path} ${body === undefined ? '' : JSON.stringify(body)}`); return { data: null, dry: true }; }
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Talkroute ${r.status} ${method} ${path}: ${text.slice(0, 300)}`);
  return text.trim() ? JSON.parse(text) : {};
}
const list = (members) => members.map((m, i) => ({ enabled: true, forwardingDeviceId: String(m.dev), forwardingSchedule: null, sequencePosition: i + 1, ringTimeout: m.secs }));
const describe = ms => ms.sort((a, b) => a.sequencePosition - b.sequencePosition).map(m => `${m.sequencePosition}. ${m.forwardingDevice?.description || m.forwardingDevice?.number} ${m.ringTimeout}s${m.enabled === false ? ' (OFF)' : ''}`).join('  |  ');

async function live(line) {
  const g = (await tr('GET', `/ring-groups/${line.group}`)).data;
  const members = (await tr('GET', `/ring-groups/${line.group}/members`)).data ?? [];
  const num = (await tr('GET', `/virtual-numbers/${line.numberId}`)).data;
  return { g, members: members.sort((a, b) => a.sequencePosition - b.sequencePosition), dest: num?.destination };
}
const ids = ms => ms.map(m => `${m.forwardingDevice?.id}:${m.ringTimeout}:${m.enabled !== false}`).join(',');
const wantIds = (members) => members.map(m => `${m.dev}:${m.secs}:true`).join(',');

async function status() {
  for (const line of Object.values(LINES)) {
    const s = await live(line);
    const base = ids(s.members) === wantIds(line.members) && (s.g.callerId ?? null) === line.callerId;
    const hasScreen = s.members.some(m => m.forwardingDevice?.number === SCREEN.number);
    console.log(`\n${line.label}\n   members   ${describe(s.members)}\n   callerId  ${s.g.callerId}   maxHoldTime ${s.g.maxHoldTime}\n   number →  ${JSON.stringify(s.dest)}${String(s.dest?.id) === BOT_GROUP ? '  (bot group: after-hours routing, team group is bypassed)' : ''}\n   state     ${hasScreen ? 'CALL SCREEN IS ACTIVE' : base ? 'matches the known-good snapshot' : 'DIFFERS from snapshot (someone changed it)'}`);
  }
}

async function ensureScreenDevice() {
  const devs = (await tr('GET', '/forwarding-numbers?pageSize=100')).data ?? [];
  const hit = devs.find(d => d.number === SCREEN.number);
  if (hit) {
    if (hit.announceAndVoicemailEnabled) console.log('   WARNING: "Call screen" has call-announce ON — turn it off (the bot line has it off).');
    return String(hit.id);
  }
  const j = await tr('POST', '/forwarding-numbers', { number: SCREEN.number, description: SCREEN.description, announceAndVoicemailEnabled: false });
  return j.dry ? 'DEVICE_ID_AFTER_CREATE' : String((j.data?.[0] ?? j.data).id);
}

async function apply(key) {
  const line = LINES[key];
  console.log(`\n=== APPLY ${line.label} ${YES ? '' : '(DRY RUN)'} ===`);
  const before = await live(line);
  if (!FORCE && (ids(before.members) !== wantIds(line.members) || (before.g.callerId ?? null) !== line.callerId)) {
    throw new Error(`Live config no longer matches the snapshot — refusing. Run "status", then re-snapshot or use --force.\n   live: ${describe(before.members)} callerId=${before.g.callerId}`);
  }
  if (YES && ROUTE_NOW) fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), [key]: { routedNow: true, at: new Date().toISOString() } }, null, 2));
  const dev = await ensureScreenDevice();
  const members = [{ dev, name: SCREEN.description, secs: SCREEN.seconds }, ...line.members];
  try {
    if (key === 'fairoaks') await tr('PATCH', `/ring-groups/${line.group}`, { callerId: null });
    await tr('PUT', `/ring-groups/${line.group}/members`, list(members));
    if (ROUTE_NOW) await tr('PATCH', `/virtual-numbers/${line.numberId}`, { destination: { type: 'ring_group', id: line.group } });
    if (!YES) return;
    const after = await live(line);
    const okMembers = after.members[0]?.forwardingDevice?.number === SCREEN.number && after.members[0]?.ringTimeout === SCREEN.seconds && ids(after.members.slice(1)) === wantIds(line.members);
    const okCaller = key !== 'fairoaks' || (after.g.callerId ?? null) === null;
    const okDest = !ROUTE_NOW || String(after.dest?.id) === line.group;
    if (!okMembers || !okCaller || !okDest) throw new Error(`verification failed (members ${okMembers}, callerId ${okCaller}, destination ${okDest}) — rolling back`);
    console.log(`   APPLIED: ${describe(after.members)}  callerId=${after.g.callerId}${ROUTE_NOW ? `  number→team group` : ''}`);
  } catch (e) { console.error('   ' + e.message); if (YES) await rollback(key); throw e; }
}

async function rollback(key) {
  const line = LINES[key];
  console.log(`\n=== ROLLBACK ${line.label} ${YES ? '' : '(DRY RUN)'} ===`);
  await tr('PUT', `/ring-groups/${line.group}/members`, list(line.members));
  await tr('PATCH', `/ring-groups/${line.group}`, { callerId: line.callerId });
  // Only if this line's number was re-pointed for the test: put it where the hourly cron would have it right now
  // (team group in business hours, bot group otherwise) — a deterministic rule, never a stale saved value.
  const routed = readState()[key]?.routedNow;
  const wantDest = businessOpen() ? line.group : BOT_GROUP;
  if (routed || ROUTE_NOW) await tr('PATCH', `/virtual-numbers/${line.numberId}`, { destination: { type: 'ring_group', id: wantDest } });
  if (YES && routed) { const st = readState(); delete st[key]; fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }
  if (!YES) return;
  const after = await live(line);
  const ok = ids(after.members) === wantIds(line.members) && (after.g.callerId ?? null) === line.callerId;
  console.log(ok ? `   RESTORED: ${describe(after.members)}  callerId=${after.g.callerId}  number→${JSON.stringify(after.dest)}` : '   !!! ROLLBACK DID NOT VERIFY — check Talkroute dashboard NOW: ' + describe(after.members));
  if (!ok) process.exitCode = 1;
}

async function main() {
  if (cmd === 'status') return status();
  const m = /^(apply|rollback)-(creco|fairoaks|all)$/.exec(cmd || '');
  if (!m) { console.error('commands: status | apply-creco | apply-fairoaks | rollback-creco | rollback-fairoaks | rollback-all'); process.exit(2); }
  const keys = m[2] === 'all' ? Object.keys(LINES) : [m[2]];
  if (m[1] === 'rollback') { for (const k of keys) await rollback(k); return; }
  for (const k of keys) await apply(k);
  if (YES && WINDOW) {
    let done = false;
    const back = async (why) => { if (done) return; done = true; console.log(`\n${why} — rolling back`); for (const k of keys) await rollback(k); process.exit(process.exitCode || 0); };
    process.on('SIGINT', () => back('Ctrl-C'));
    if (KEEP) { console.log('\n--keep: leaving it applied.'); return; }
    console.log(`\nTEST WINDOW OPEN for ${WINDOW} min — place the test calls now. Ctrl-C rolls back immediately.`);
    for (let left = WINDOW * 60; left > 0 && !done; left -= 30) { await new Promise(r => setTimeout(r, Math.min(30, left) * 1000)); if (!done) console.log(`   …${Math.max(0, left - 30)} s left`); }
    await back('Window over');
  } else if (YES) console.log('\nApplied WITHOUT an auto-rollback timer. To undo: node scripts/call-screen-cutover.mjs rollback-' + (keys.length > 1 ? 'all' : keys[0]) + ' --yes');
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
