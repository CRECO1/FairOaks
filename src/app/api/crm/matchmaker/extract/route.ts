import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { canAct, loadTenant, tenantNames } from '@/lib/matchmaker/server';
import { buildExtractInput, EXTRACT_SYSTEM, EXTRACT_TOOL, heuristicExtract, NOTHING_FOUND, sanitizeExtraction, type ExtractedSearch } from '@/lib/matchmaker/extract';

export const maxDuration = 30;

const UUID = /^[0-9a-f-]{36}$/i;
const MODEL = process.env.CRM_ASSISTANT_MODEL || 'claude-sonnet-5';   // the same model the Copilot and email assist already use

/**
 * Turn words into a Matchmaker search. Nothing is saved here — the answer fills the form and the agent checks it, then saves.
 *
 *   POST { text }        what the agent typed or pasted ("3,000 SF office in Boerne, up to $30/SF, by March")
 *   POST { client_id }   read the notes and recent activity on that contact's card (only for someone who can act for the contact)
 *   -> { ok, search, source: 'ai' | 'rules' }
 *
 * Claude reads it with judgement (a square footage in a prospecting note is usually where the prospect IS, not what they want); if Claude
 * cannot be reached the plain-rules reader answers instead, so the button always does something.
 */

// A few a minute per person is plenty — it is a button, not a loop.
const hits = new Map<string, number[]>();
function throttled(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 20;
}

// The area names in the Property DB, for the rules reader (kept ten minutes).
let areaCache: { bu: string; at: number; areas: string[] } | null = null;
async function knownAreas(bu: string | null): Promise<string[]> {
  const key = bu ?? 'all';
  if (areaCache && areaCache.bu === key && Date.now() - areaCache.at < 600_000) return areaCache.areas;
  const db = adminClient();
  const seen = new Set<string>();
  for (let from = 0; from < 6000; from += 1000) {
    let q = db.from('crm_prospective_properties').select('submarket,city').order('id').range(from, from + 999);
    if (bu) q = q.eq('business_unit', bu);
    const { data } = await q;
    for (const r of data ?? []) for (const a of [r.submarket, r.city]) if (typeof a === 'string' && a.trim()) seen.add(a.trim());
    if (!data || data.length < 1000) break;
  }
  const areas = [...seen];
  areaCache = { bu: key, at: Date.now(), areas };
  return areas;
}

const centralToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (throttled(ctx.userId)) return NextResponse.json({ error: 'Slow down a moment — try again in a minute.' }, { status: 429 });
  const b = await req.json().catch(() => null) as { text?: unknown; client_id?: unknown } | null;
  const typed = typeof b?.text === 'string' ? b.text.trim().slice(0, 2500) : '';
  const clientId = typeof b?.client_id === 'string' ? b.client_id : '';
  if (!typed && !UUID.test(clientId)) return NextResponse.json({ error: 'Type what they need, or pick someone whose notes to read.' }, { status: 400 });

  // The words to read: what was typed, or the contact's notes + recent activity.
  let who = ''; let notes = ''; let activity: string[] = [];
  if (!typed) {
    const db = adminClient();
    const { row } = await loadTenant(db, clientId);
    if (!row || !canAct(ctx, row)) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    who = `${tenantNames(row).name} (${row.type ?? 'contact'})`;
    const [n, a] = await Promise.all([
      db.from('crm_clients').select('notes').eq('id', clientId).maybeSingle(),
      db.from('crm_client_activities').select('type,note,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(15),
    ]);
    notes = ((n.data?.notes as string | null) ?? '').slice(0, 12_000);
    activity = (a.data ?? []).map(r => `[${String(r.created_at).slice(0, 10)}] ${r.type}: ${String(r.note ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
    if (!notes.trim() && !activity.length) return NextResponse.json({ ok: true, search: { ...NOTHING_FOUND }, source: 'none', empty: true });
  }
  const readable = typed || [notes, ...activity].join('\n');

  // Claude first.
  let search: ExtractedSearch | null = null;
  let source: 'ai' | 'rules' = 'ai';
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
      const res = await client.messages.create({
        model: MODEL, max_tokens: 700, system: EXTRACT_SYSTEM,
        tools: [EXTRACT_TOOL], tool_choice: { type: 'tool', name: 'report_search' },
        messages: [{ role: 'user', content: buildExtractInput({ who, notes, activity, typed, today: centralToday() }) }],
      });
      const call = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (call) search = sanitizeExtraction(call.input);
    } catch (e) {
      console.error('[matchmaker/extract] Claude unavailable, using the rules reader:', e instanceof Error ? e.message : e);
    }
  }
  // …and the plain rules when Claude could not answer.
  if (!search) {
    source = 'rules';
    search = heuristicExtract(readable, await knownAreas(ctx.businessUnit ?? null));
  }
  return NextResponse.json({ ok: true, search, source, empty: false });
}
