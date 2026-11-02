// Run: set -a; . .env.local; set +a; npx tsx scripts/precheck-calendar.test.ts
// Read-only: exercises precheckWrite (calendar traps) against the real contact + teammate emails. Sends and writes nothing.
import { precheckWrite, type AgentCtx } from '@/lib/crm-assistant-tools';
const ctx = { userId: '00000000-0000-0000-0000-000000000000', role: 'super_admin', businessUnit: 'commercial', token: '', origin: 'http://localhost' } as AgentCtx;
const cases: [string, string, Record<string, any>, 'block' | 'pass', RegExp?][] = [
  ['meeting email is blocked', 'send_email', { subject: 'Property Tour Tomorrow – 4946 Center Park Blvd, 1:30 PM', body: 'See you at 1:30 PM tomorrow.' }, 'block', /schedule_event/],
  ['plain email still allowed', 'send_email', { subject: 'Lease draft attached', body: 'Here is the draft lease for your review.' }, 'pass'],
  ['explicit email_only allowed', 'send_email', { subject: 'Meeting recap', body: 'Thanks for the meeting today at 2 PM.', email_only: true }, 'pass'],
  ['guests without a time blocked', 'schedule_event', { title: 'Tour', date: '2026-11-03', attendees: ['robert@crecotx.com'] }, 'block', /start time/],
  ['malformed email blocked', 'schedule_event', { title: 'Tour', date: '2026-11-03', time: '13:30', attendees: ['robert@crecotx'] }, 'block', /valid email/],
  ['unknown address blocked', 'schedule_event', { title: 'Tour', date: '2026-11-03', time: '13:30', attendees: ['nobody-zzz@example.invalid'] }, 'block', /confirm/],
  ['unknown address ok once confirmed', 'schedule_event', { title: 'Tour', date: '2026-11-03', time: '13:30', attendees: ['nobody-zzz@example.invalid'], confirmed_unlisted_emails: true }, 'pass'],
  ['teammates pass', 'schedule_event', { title: 'Tour', date: '2026-11-03', time: '13:30', attendees: ['robert@crecotx.com', 'brian@crecotx.com'] }, 'pass'],
  ['no-guest reminder passes', 'schedule_event', { title: 'Call Lloyd', date: '2026-11-03' }, 'pass'],
];
(async () => {
  let failed = 0;
  for (const [name, tool, input, want, re] of cases) {
    const r = await precheckWrite(tool, input, ctx);
    const ok = want === 'pass' ? r === null : r !== null && (!re || re.test(r));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` -> ${r}`}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
