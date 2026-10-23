#!/usr/bin/env node
// Fire a correctly SIGNED fake Twilio "call comes in" at /api/voice/inbound — no real call, no phone.
//
//   TWILIO_AUTH_TOKEN=… VOICE_PUBLIC_ORIGIN=https://<host> node scripts/simulate-inbound-call.mjs <from> [to]
//
//   from   the caller to simulate, any format ("(210) 555-0123", "+12105550123")
//   to     the line it "called" (default: the Fair Oaks line, +12103909997)
//
// VOICE_PUBLIC_ORIGIN must be the same origin the target deployment uses to verify signatures (its own
// VOICE_PUBLIC_ORIGIN / APP origin). A blocked number answers with the goodbye + <Hangup/> and no <Gather>;
// anyone else gets Ava's greeting. NOTE: an unblocked number starts a REAL bot call record in the Calling
// Log, so use a number you will remember to delete — or one that is on the block list.
import crypto from 'node:crypto';

const pathArg = process.argv.find(a => a.startsWith('--path='));
const path = pathArg ? pathArg.slice(7) : '/api/voice/inbound';   // --path=/api/voice/screen to exercise the call screen
const [from, to = '+12103909997'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const token = process.env.TWILIO_AUTH_TOKEN;
const origin = (process.env.VOICE_PUBLIC_ORIGIN || '').replace(/\/$/, '');
if (!from || !token || !origin) { console.error('usage: TWILIO_AUTH_TOKEN=… VOICE_PUBLIC_ORIGIN=https://host node scripts/simulate-inbound-call.mjs <from> [to]'); process.exit(1); }

const url = `${origin}${path}`;
const params = { CallSid: `CAsim${crypto.randomBytes(12).toString('hex')}`, From: from, To: to, CallStatus: 'ringing', Direction: 'inbound', AccountSid: process.env.TWILIO_ACCOUNT_SID || 'ACsim' };
const sig = crypto.createHmac('sha1', token).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params) });
const body = await r.text();
console.log(`HTTP ${r.status}\n${body}\n`);
console.log(/<Hangup\/>/.test(body) && !/<Gather/.test(body) ? '→ BLOCKED (goodbye + hang-up)' : /<Reject/.test(body) ? '→ ADVANCE (rejected so Talkroute moves to the next member)' : /<Gather/.test(body) ? '→ ALLOWED (bot greeting)' : '→ unexpected response');
