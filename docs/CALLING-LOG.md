# Calling Log + AI voice receptionist

CRM section: **Calling Log** (sidebar, under E-Sign; URL hash `#calls`).

One list of every phone call the brokerage sees, with what the caller wanted and
who still needs a call back:

| Source | How it gets in | What you see |
|---|---|---|
| Talkroute calls | `/api/cron/talkroute-sync` every 15 min (API `/v2/call-history`) + Talkroute webhook `new_call_record` / `call_completed` | direction, result (answered / missed / hung up), duration, recording (if Talkroute recorded it) |
| Talkroute voicemails | same cron (`/v2/voice-messages`) + webhook `new_voicemail` | transcript, audio (fresh signed link fetched on play) |
| AI voice bot | Twilio voice webhooks while the call is live | full conversation, AI summary, caller's intent, callback number, urgency; summary emailed to the team |
| Manual | "＋ Log a call" in the section | whatever the agent typed |

Missed calls, voicemails and bot calls land in the **Needs call back** queue until
someone hits **✓ Handled** (which also writes a `call` activity on the linked contact).
Caller IDs are matched to `crm_clients` by phone; unknown callers get a **＋ Contact** button.

## Why the bot isn't on Talkroute itself

Talkroute's public API explicitly excludes voice: no call control, no media streams.
It only exposes account data, call history, voicemails, texts and webhooks. So:

- Talkroute stays the main number and **forwards** to a Twilio number when you want
  the bot to pick up (after hours, no answer, or a menu option).
- The bot runs on **Twilio Programmable Voice** using speech recognition and
  text-to-speech, one turn at a time over plain HTTPS, so it runs on Vercel with no
  websocket server. Claude (`claude-opus-5`, low effort for phone latency) decides
  what to say and when to end or transfer.

## Setup (once)

### 1. Vercel environment variables (project `fair-oaks-realty-group`)

| Var | What |
|---|---|
| `TALKROUTE_API_KEY` | `tr_live_…` from Talkroute → Settings → API (request API access if the tab isn't there) |
| `TALKROUTE_WEBHOOK_SECRET` | any long random string; it becomes `?key=` on the webhook URL because Talkroute doesn't sign payloads |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio console → Account info |
| `ANTHROPIC_API_KEY` | already set |
| `VOICE_PUBLIC_ORIGIN` | optional; defaults to `https://www.fairoaksrealtygroup.com`. Must match the URL Twilio calls or signature checks fail |
| `TWILIO_VOICE` | optional TTS voice, default `Polly.Joanna-Neural` |
| `VOICEBOT_MODEL` | optional, default `claude-opus-5` |

### 2. Twilio number

Buy a local voice number. On the number's Voice configuration:

- **A call comes in** → Webhook, `POST https://www.fairoaksrealtygroup.com/api/voice/inbound`
- **Call status changes** → `POST https://www.fairoaksrealtygroup.com/api/voice/status`

Paste the number into Calling Log → **Setup & voice bot** → *Bot line*.

### 3. Talkroute routing

- Talkroute → Forwarding Numbers → add the Twilio number ("AI receptionist").
- Send calls to it where you want the bot: **Hours → closed destination**, the
  ring group's **no-answer fallback**, or a **menu option** ("press 2 to leave
  details with our assistant"). Any of these can also be flipped from the
  Talkroute API (`PATCH /v2/hours/settings`, `PUT /v2/hours-override`).

### 4. Webhooks + first sync

Calling Log → Setup & voice bot → **Test Talkroute connection**, then
**Register Talkroute webhooks**, then **⟳ Sync Talkroute** (pulls the last 2 days).
The cron keeps it current from then on.

## Files

- `supabase/calling-log.sql` — `crm_call_log`, `crm_call_turns`, `crm_voicebot_settings` (applied 2026-09-15 via the pooler). Named `crm_call_log` because an older, empty, unused `crm_calls` table already exists.
- `src/lib/talkroute.ts` — API client, normalisers, `syncTalkroute()`
- `src/lib/twilio.ts` — signature check, TwiML helpers, recording REST
- `src/lib/voicebot.ts` — settings, contact matching, `nextReply()`, `summarizeCall()`, summary email
- `src/lib/phone.ts` — number normalisation
- `src/app/api/voice/{inbound,turn,status,recording}` — Twilio webhooks (signature-verified)
- `src/app/api/webhooks/talkroute` — Talkroute push (secret-keyed)
- `src/app/api/cron/talkroute-sync` — 15-minute pull
- `src/app/api/crm/calls` (+ `/sync`, `/settings`, `/audio`) — the CRM's API
- `src/components/crm/CallingLog.tsx` — the section

## Safety rails in the bot

- Never quotes prices, availability, terms or appointment times; says an agent will confirm.
- Hard stop after 12 caller turns; silence handling; graceful fallback if Claude errors.
- Transfer only happens if a transfer number is set; otherwise it takes details.
- Switching the bot **off** in settings turns the line into a plain voicemail prompt rather than dropping calls.
- Every Twilio request is signature-checked; recordings are streamed through the CRM's authed proxy, never linked directly.
