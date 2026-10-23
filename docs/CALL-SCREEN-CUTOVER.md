# Call screen — staged Talkroute cutover (NOT LIVE)

**Status 2026-10-22:** code is deployed and inert; the Twilio number exists; **no Talkroute setting has been changed.**

| Piece | State |
|---|---|
| `POST /api/voice/screen` | live in production, reachable only by something calling it |
| Twilio number **+1 830-415-0086** ("Call screen", SID `PNe2d977437024a8957037c2b0cac0301c`) | bought; voice URL → `/api/voice/screen`; fallback URL → a Twilio-hosted bare `<Reject/>` so a Vercel outage can't turn into "application error" + hang-up on a real caller |
| Talkroute forwarding number "Call screen" | **not created yet** (the cutover script creates it, call-announce OFF) |
| Ring groups | **unchanged** |

## What it does
First member of a team ring group. Blocked caller → it answers, says goodbye, hangs up: **no phone rings**. Anyone else →
`<Reject reason="busy"/>` → Talkroute should move to the next member (the team) as if the screen weren't there.
Every doubt (bad signature, withheld caller ID, DB error/slow, Twilio/Vercel down) resolves to "advance".

## ⚠ Two facts that shape the test
1. **After hours the team groups are bypassed.** The hourly cron (`/api/cron/talkroute-hours`, at :05) points both Talkroute
   numbers straight at the bot group (Mon–Sat 8–18 Central is "open"; Sunday closed). A screen in a team group only sees calls
   during business hours. Which is exactly when spam rings Zack's cell. A test outside business hours therefore needs
   `--route-now` (temporarily points the number at the team group), and must stay clear of :05.
2. **NOT PROVEN: that Talkroute advances to the next member when the screen leg returns busy.** If it doesn't, the call dies at
   the screen and EVERY call to that line is lost. That is why the first run is a short, attended, auto-reverting window.

## Known-good snapshot (captured live 2026-10-22 22:58 CDT) — this is the rollback target
Full raw JSON (with staff numbers): `~/.call-screen-snapshot-20261022.json` (not in git). The script embeds the same facts.

**CRECO 210-817-3443 → number 105036 → ring group `c24dc035-b8d0-11ee-9d13-246e96bdfb98`**
strategy sequence · maxHoldTime 180 · maxAttempts 1 · callerId **null** · no-answer → bot group `74980a59…`
| pos | member (device id) | ring |
|---|---|---|
| 1 | Primary Forward Number (262146) | 15 s |
| 2 | Brian Blanco (356526) | 15 s |
| 3 | Ed Blanco (353357) | 15 s |
| 4 | AI receptionist (373044) | 60 s |

**Fair Oaks 210-390-9997 → number 142802 → ring group `5063974a-381b-11f1-b25d-246e96bdfb98`**
sequence · maxHoldTime 180 · callerId **142802** (the Fair Oaks line itself — why the bot sees `From=+12103909997`) · no-answer → bot group
| pos | member | ring |
|---|---|---|
| 1 | Primary Forward Number (262146) | 15 s |
| 2 | AI receptionist (373044) | 60 s |

Both numbers' destination at capture time: bot group `74980a59-5009-4531-bdd2-d4e05877cf08` (after-hours state). In business hours: their team group.

## The change
| Line | Change |
|---|---|
| CRECO | add **Call screen** as member 1 (8 s); the other four members unchanged, shifted down one |
| Fair Oaks | `callerId: 142802 → null` **and** add **Call screen** as member 1 (8 s) |

Fair Oaks side effects of `callerId=null` (visible, intentional): the team's cell shows the real caller instead of the Fair Oaks line, and
the bot starts receiving real caller IDs on that line (greets known contacts by name, no more "unknown caller ID" mode).

## Tool
`scripts/call-screen-cutover.mjs` — **dry run unless `--yes`**, refuses if the live config differs from the snapshot, verifies after
writing, and rolls itself back if verification fails.
```bash
export TALKROUTE_API_KEY=…   # from Vercel production env
node scripts/call-screen-cutover.mjs status                                   # read-only
node scripts/call-screen-cutover.mjs apply-creco --window=10 --route-now      # dry run: prints every call it would make
node scripts/call-screen-cutover.mjs apply-creco --window=10 --route-now --yes   # TEST WINDOW: applies, auto-rolls-back after 10 min, Ctrl-C = roll back now
node scripts/call-screen-cutover.mjs rollback-all --yes                       # undo everything
```

## Coordinated test — CRECO line, off-hours, ~15 minutes, Zack + one operator
**Needs:** a second phone **X** that is not any ring-group member (not 210-355-8683, 210-215-9036, 210-500-6462, 830-251-4660, 830-415-0086);
Brian & Ed told their phones *could* ring (they won't if Zack answers within 15 s); a terminal with the rollback command ready;
a start minute between :10 and :45 (cron runs at :05).

| # | Who | Action | PASS | FAIL → run `rollback-all --yes` at once |
|---|---|---|---|---|
| 0 | op | `status` | both lines "match the known-good snapshot" | anything else — stop, investigate |
| 1 | op | `apply-creco --window=10 --route-now --yes` | prints APPLIED with Call screen at position 1 and `number→team group` | any error (it already rolled back; confirm with `status`) |
| 2 | Zack | **Test A, unblocked:** call 210-817-3443 from X | within ~1–4 s Zack's cell (Primary Forward Number) rings; answering connects normally | busy/fast-busy, dead air, call "failed", or it goes straight to Ava/voicemail without ringing the cell |
| 3 | Zack | Test A2 (optional): call again, let it ring out | rings Zack 15 s → Brian → Ed → Ava answers | any step skipped or the call drops |
| 4 | op | add **X** to the block list (Calling Log → 🚫 Blocked numbers; reason "cutover test") | shows in the list | — |
| 5 | Zack | **Test B, blocked:** call 210-817-3443 from X | hears "We are unable to take your call at this time. Goodbye." and the call ends; **no phone rings** (Zack's cell stays silent) | any phone rings, or he gets Ava |
| 6 | op | remove X from the block list; `status` once the window closes | back to snapshot; number → bot group (after hours) | `rollback-all --yes` |
| 7 | op | Wait for the Talkroute sync, then open the Calling Log | Test A row normal; Test B row tagged 🚫 Blocked and NOT in "answered · needs a note" | if B shows as an answered call needing a note, the event text didn't match "Call screen" — send me that row's `raw.events` |

**Go / no-go:** all PASS → leave CRECO applied (`apply-creco --yes`, no window) and watch the next business day's log; then repeat the same test on Fair Oaks
(`apply-fairoaks`), where Test A2 should additionally be left to ring through to Ava so we can confirm the bot's call row shows **X** (not +12103909997) as the caller —
that proves `callerId=null` unmasks the real number. One FAIL → rolled back, nothing lost, and we use plan B.

## If Talkroute does NOT advance on busy (plan B, in order)
1. Change the reject reason to `rejected` (SIP 603 instead of 486) — one-line change, redeploy, retest.
2. Dashboard-side: Talkroute's own call blocking / anonymous-call rejection for known numbers (handled separately).
3. Drop the screen idea; keep the bot-side block list (already live).

## Panic rollback without the script
Talkroute dashboard → Ring Groups → open the group → delete the "Call screen" member (and for Fair Oaks set Caller ID back to the Fair Oaks line).
Or by API (CRECO shown; `PUT` replaces the whole member list):
```bash
curl -X PUT -H "Authorization: Bearer $TALKROUTE_API_KEY" -H 'Content-Type: application/json' \
  https://api.talkroute.com/api/v2/ring-groups/c24dc035-b8d0-11ee-9d13-246e96bdfb98/members -d '[
 {"enabled":true,"forwardingDeviceId":"262146","forwardingSchedule":null,"sequencePosition":1,"ringTimeout":15},
 {"enabled":true,"forwardingDeviceId":"356526","forwardingSchedule":null,"sequencePosition":2,"ringTimeout":15},
 {"enabled":true,"forwardingDeviceId":"353357","forwardingSchedule":null,"sequencePosition":3,"ringTimeout":15},
 {"enabled":true,"forwardingDeviceId":"373044","forwardingSchedule":null,"sequencePosition":4,"ringTimeout":60}]'
# Fair Oaks:
curl -X PUT … /ring-groups/5063974a-381b-11f1-b25d-246e96bdfb98/members -d '[
 {"enabled":true,"forwardingDeviceId":"262146","forwardingSchedule":null,"sequencePosition":1,"ringTimeout":15},
 {"enabled":true,"forwardingDeviceId":"373044","forwardingSchedule":null,"sequencePosition":2,"ringTimeout":60}]'
curl -X PATCH … /ring-groups/5063974a-381b-11f1-b25d-246e96bdfb98 -d '{"callerId":142802}'
```
The hourly cron only moves each number's destination; it never touches members or callerId, so it neither helps nor hinders a rollback.
