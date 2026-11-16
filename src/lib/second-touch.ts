import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdminRole } from '@/lib/crm-auth';

export type SecondTouchResult = { made: number; skipped: number; items: { contact: string; listing: string; to: string }[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** "…lease prospect — Roofing. Outbound prospecting" → "Roofing". Null when the note names no trade. */
export const industryFromNote = (notes: string | null | undefined): string | null => {
  const m = /prospect\s*[—–-]\s*([A-Za-z][A-Za-z&/ ,-]{2,40}?)(?:\.|\s{2}|\n|$)/i.exec(String(notes ?? ''));
  const t = m?.[1]?.trim().replace(/\s+/g, ' ');
  return t && t.length >= 3 && !/^(outbound|veteran|medium|low|high)\b/i.test(t) ? t : null;
};

/**
 * Prepare second-touch email DRAFTS for people we reached out to (🎯 targeted) 30+ days ago who have not written back and have not had a draft yet. Each draft
 * is saved to the LISTING AGENT's Drafts (with their signature) for them to read, edit and send themselves: nothing is ever sent from here. A contact is
 * stamped (second_touch_drafted_at) so it is never prepared twice. Skips: no email, unsubscribed / dead address, new-lead hold, anyone who already replied.
 * `only` limits it to one contact (ignoring the 30-day wait: for a deliberate "do this one now"); `agentId` limits it to listings that agent lists (admins: all).
 */
export async function prepareSecondTouchDrafts(db: SupabaseClient, opts: { unit: string; limit?: number; only?: string; agent?: { id: string; role: string | null } }): Promise<SecondTouchResult> {
  const limit = Math.min(60, Math.max(1, opts.limit ?? 25));
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let q = db.from('crm_clients').select('id, first_name, last_name, business_name, email, notes, targeted_listing_ids, targeted_at, lead_hold')
    .eq('business_unit', opts.unit).not('targeted_listing_ids', 'eq', '{}').is('second_touch_drafted_at', null).is('unsubscribed_at', null).eq('lead_hold', false).not('email', 'is', null).neq('email', '');
  if (opts.only) q = q.eq('id', opts.only); else q = q.lte('targeted_at', cutoff);
  const { data: cands } = await q.order('targeted_at', { ascending: true }).limit(400);
  const out: SecondTouchResult = { made: 0, skipped: 0, items: [] };
  if (!cands?.length) return out;

  const lids = [...new Set(cands.flatMap(c => (c.targeted_listing_ids as string[]) ?? []))];
  const { data: lst } = await db.from('crm_listings').select('id, name, address, listing_agent_id, assigned_agent_ids').in('id', lids);
  const lmap = new Map((lst ?? []).map(l => [l.id as string, l]));
  const agentIds = [...new Set((lst ?? []).map(l => l.listing_agent_id as string | null).filter((x): x is string => !!x))];
  const { data: profs } = agentIds.length ? await db.from('crm_profiles').select('id, email_signature').in('id', agentIds) : { data: [] };
  const sig = new Map((profs ?? []).map(p => [p.id as string, String(p.email_signature ?? '')]));

  // Anyone who has written back since being marked is not "no reply": the daily replies job moves them to "asked" instead.
  const replied = new Set<string>();
  const ids = cands.map(c => c.id as string);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: em } = await db.from('crm_deal_emails').select('client_id, email_date').eq('direction', 'received').in('client_id', ids.slice(i, i + 200)).limit(1000);
    for (const e of em ?? []) { const c = cands.find(x => x.id === e.client_id); if (c && String(e.email_date ?? '') >= String(c.targeted_at ?? '').slice(0, 10)) replied.add(e.client_id as string); }
  }

  for (const c of cands) {
    if (out.made >= limit) break;
    if (replied.has(c.id as string)) { out.skipped++; continue; }
    const lid = ((c.targeted_listing_ids as string[]) ?? []).find(id => {
      const l = lmap.get(id); if (!l) return false;
      if (!opts.agent || isAdminRole(opts.agent.role)) return !!l.listing_agent_id;
      return l.listing_agent_id === opts.agent.id || ((l.assigned_agent_ids as string[] | null) ?? []).includes(opts.agent.id);
    });
    const l = lid ? lmap.get(lid) : undefined;
    const agent = (l?.listing_agent_id as string | null) ?? null;
    if (!l || !agent) { out.skipped++; continue; }
    const label = String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'the property');
    const first = String(c.first_name ?? '').trim();
    const trade = industryFromNote(c.notes as string | null);
    const name = (c.business_name as string) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
    const body = `<p>Hi ${esc(first || 'there')},</p><p>I reached out a few weeks ago about ${esc(label)}${trade ? ` and thought it could suit a ${esc(trade.toLowerCase())} business like yours` : ''}. I wanted to follow up in case the timing is better now.</p><p>Is space like this still on your radar? I'm happy to send details or set up a time to walk it.</p>${sig.get(agent) ? `<br>${sig.get(agent)}` : ''}`;
    const { error } = await db.from('crm_email_drafts').upsert({
      user_id: agent, draft_key: `secondtouch:${c.id}:${lid}`, subject: `Following up on ${label}`, to_emails: String(c.email), more_to: '', cc_emails: '', bcc_emails: '', body_html: body,
      context: { kind: 'dock', label: `Second touch: ${name}` }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,draft_key' });
    if (error) { out.skipped++; continue; }
    await db.from('crm_clients').update({ second_touch_drafted_at: new Date().toISOString() }).eq('id', c.id as string);
    out.made++; out.items.push({ contact: name, listing: label, to: String(c.email) });
  }
  return out;
}
