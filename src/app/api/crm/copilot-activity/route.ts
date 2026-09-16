import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Super-admin-only audit feed of every action the CRECO Copilot took on an agent's
// behalf (crm_activity type='copilot'). Oversight for the owner; agents never see it.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (ctx.role !== 'super_admin') return forbidden('Super admin only');

  const db = adminClient();
  const url = new URL(req.url);
  const agentFilter = url.searchParams.get('agent_id');

  let q = db.from('crm_activity')
    .select('id, agent_id, notes, business_unit, created_at, client_id')
    .eq('type', 'copilot')
    .order('created_at', { ascending: false })
    .limit(300);
  if (agentFilter) q = q.eq('agent_id', agentFilter);

  const { data, error } = await q;
  if (error) { console.error('[copilot-activity]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }

  const rows = data ?? [];
  const agentIds = [...new Set(rows.map(r => r.agent_id).filter(Boolean))] as string[];
  const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))] as string[];
  const [{ data: agents }, { data: clients }] = await Promise.all([
    agentIds.length ? db.from('crm_profiles').select('id, first_name, last_name').in('id', agentIds) : Promise.resolve({ data: [] as any[] }),
    clientIds.length ? db.from('crm_clients').select('id, first_name, last_name, business_name').in('id', clientIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const agentMap = Object.fromEntries((agents ?? []).map(a => [a.id, `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Unknown']));
  const clientMap = Object.fromEntries((clients ?? []).map(c => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || '']));

  return NextResponse.json({
    rows: rows.map(r => ({
      id: r.id,
      agent: r.agent_id ? (agentMap[r.agent_id] ?? 'Unknown') : 'Unknown',
      action: (r.notes ?? '').replace(/^\[Copilot\]\s*/, ''),
      contact: r.client_id ? (clientMap[r.client_id] ?? '') : '',
      business_unit: r.business_unit,
      when: r.created_at,
    })),
    agents: (agents ?? []).map(a => ({ id: a.id, name: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() })),
  });
}
