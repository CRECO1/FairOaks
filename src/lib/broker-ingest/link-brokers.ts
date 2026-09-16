/**
 * Link each Property-DB listing's broker text to a real master-list contact
 * (crm_prospective_properties.contact_id → crm_clients), deduped against existing
 * contacts and within the batch. Named individuals + brokerage firms; marketplace
 * names (Crexi/LoopNet/…) are skipped. Idempotent — only touches rows whose
 * contact_id is still null. Run daily after the crawl so new listings self-link.
 */

import { randomUUID } from 'crypto';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
/** Owner/agent for contacts the crawl creates (same CRM user the listings use). */
const AGENT_ID = '47668cbf-25c1-480a-baa0-af65fb663dd7';

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

const MARKET = /crexi|loopnet|commercialcafe|commercialsearch|commercialexchange|catylist|brevitas|biproxi|commercialedge|marketplace|costar|showcase/i;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const isPerson = (s: unknown) => {
  const t = String(s ?? '').trim();
  return !!t && /[a-z]/i.test(t) && t.split(/\s+/).length >= 2 && !MARKET.test(t);
};
function splitName(raw: string) {
  const s = (raw || '').split(',')[0].trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: s, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

async function getAll(base: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}${base}&offset=${from}&limit=1000`, { headers: serviceHeaders() });
    if (!res.ok) break;
    const rows = await res.json();
    if (!rows?.length) break;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export interface LinkBrokersResult {
  scanned: number;
  linkedExisting: number;
  contactsCreated: number;
  linked: number;
  skipped: number;
}

export async function linkBrokerContacts(opts: { commit: boolean }): Promise<LinkBrokersResult> {
  // 1. existing contacts → match indexes
  const existing = await getAll('/rest/v1/crm_clients?select=id,first_name,last_name,business_name,brokerage,phone,cell_phone');
  const byPerson = new Map<string, string>(), byPhone = new Map<string, string>(), byFirm = new Map<string, string>();
  for (const c of existing) {
    const nm = norm(`${c.first_name ?? ''} ${c.last_name ?? ''}`);
    const co = norm(c.business_name || c.brokerage || '');
    if (nm) byPerson.set(nm + '|' + co, String(c.id));
    for (const ph of [c.phone, c.cell_phone]) { const d = digits(ph); if (d.length >= 10) byPhone.set(d.slice(-10), String(c.id)); }
    const bn = norm(c.business_name), bk = norm(c.brokerage);
    if (bn) byFirm.set(bn, String(c.id));
    if (bk && !byFirm.has(bk)) byFirm.set(bk, String(c.id));
  }

  // 2. unlinked broker properties
  const props = await getAll('/rest/v1/crm_prospective_properties?business_unit=eq.commercial&contact_id=is.null&or=(listing_agent_name.not.is.null,listing_company.not.is.null)&select=id,listing_agent_name,listing_company,listing_agent_phone&order=id');

  // 3. resolve each → existing id or a to-create key
  type Rec = Record<string, unknown>;
  const toCreate = new Map<string, { record: Rec; propIds: string[] }>();
  const linkToExisting = new Map<string, string[]>();
  const addExisting = (id: string, pid: string) => { const a = linkToExisting.get(id); if (a) a.push(pid); else linkToExisting.set(id, [pid]); };
  let skipped = 0;

  for (const p of props) {
    const nm = p.listing_agent_name as string, co = p.listing_company as string, ph = digits(p.listing_agent_phone);
    let key: string, record: Rec, existingId: string | undefined;
    if (isPerson(nm)) {
      const { first, last } = splitName(nm);
      const pkey = norm(`${first} ${last}`) + '|' + norm(co);
      existingId = byPerson.get(pkey) || (ph.length >= 10 ? byPhone.get(ph.slice(-10)) : undefined);
      key = 'p:' + pkey;
      record = { first_name: first, last_name: last, business_name: co || '', phone: (p.listing_agent_phone as string) || null, type: 'Broker', business_unit: 'commercial', agent_id: AGENT_ID, assigned_agent_ids: [], lead_source: 'Property DB (broker)', unsubscribe_token: randomUUID() };
    } else if (co && co.trim() && !MARKET.test(co)) {
      const fkey = norm(co);
      existingId = byFirm.get(fkey);
      key = 'f:' + fkey;
      record = { first_name: '', last_name: '', business_name: co.trim(), phone: null, type: 'Broker', business_unit: 'commercial', agent_id: AGENT_ID, assigned_agent_ids: [], lead_source: 'Property DB (broker)', unsubscribe_token: randomUUID() };
    } else { skipped++; continue; }

    if (existingId) { addExisting(existingId, String(p.id)); continue; }
    const t = toCreate.get(key);
    if (t) t.propIds.push(String(p.id)); else toCreate.set(key, { record, propIds: [String(p.id)] });
  }

  const newContacts = [...toCreate.values()];
  const linkedExisting = [...linkToExisting.values()].reduce((a, v) => a + v.length, 0);
  const result: LinkBrokersResult = {
    scanned: props.length, linkedExisting, contactsCreated: 0,
    linked: 0, skipped,
  };
  if (!opts.commit || (!newContacts.length && !linkToExisting.size)) return result;

  // 4. create new contacts (bulk, matched back by unsubscribe_token)
  for (let i = 0; i < newContacts.length; i += 100) {
    const batch = newContacts.slice(i, i + 100);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_clients`, {
      method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(batch.map((x) => x.record)),
    });
    if (!res.ok) { console.error('link-brokers: contact insert failed', res.status, (await res.text()).slice(0, 160)); continue; }
    const rows: Array<{ id: string; unsubscribe_token: string }> = await res.json();
    const byTok = new Map(rows.map((r) => [r.unsubscribe_token, r.id]));
    for (const x of batch) { const id = byTok.get(x.record.unsubscribe_token as string); if (id) { (x as { newId?: string }).newId = id; result.contactsCreated++; } }
  }

  // 5. link properties → contact_id (grouped)
  const groups: Array<{ id: string; pids: string[] }> = [
    ...[...linkToExisting.entries()].map(([id, pids]) => ({ id, pids })),
    ...newContacts.filter((x) => (x as { newId?: string }).newId).map((x) => ({ id: (x as { newId?: string }).newId!, pids: x.propIds })),
  ];
  for (const g of groups) {
    for (let i = 0; i < g.pids.length; i += 150) {
      const chunk = g.pids.slice(i, i + 150);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=in.(${chunk.join(',')})`, {
        method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ contact_id: g.id }),
      });
      if (res.ok) result.linked += chunk.length;
    }
  }
  return result;
}
