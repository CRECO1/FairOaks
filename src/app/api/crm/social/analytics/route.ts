import { NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET() {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const supabase = adminClient();

  // Get the agent's connection IDs first (Supabase doesn't support
  // filtering on a joined table column directly in .eq())
  const { data: userConnections } = await supabase
    .from('social_connections')
    .select('id, platform, account_name, platform_account_id, followers_count')
    .eq('agent_id', user.id)
    .eq('is_active', true);

  if (!userConnections?.length) {
    return NextResponse.json({ analytics: [] });
  }

  const connectionIds = userConnections.map(c => c.id);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get the most recent analytics row per connection (latest daily snapshot)
  const { data, error } = await supabase
    .from('social_analytics')
    .select('*, connection:social_connections(id, platform, account_name, platform_account_id, followers_count)')
    .in('connection_id', connectionIds)
    .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: false });

  if (error) {
    console.error('[analytics] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }

  // Deduplicate — keep only the most recent row per connection
  const seen = new Set<string>();
  const latest = (data ?? []).filter(row => {
    if (seen.has(row.connection_id)) return false;
    seen.add(row.connection_id);
    return true;
  });

  // Merge in live follower count from connection if analytics row is older
  const enriched = latest.map(row => ({
    ...row,
    followers: row.followers || row.connection?.followers_count || 0,
    platform:  row.connection?.platform    ?? row.platform,
    account_name: row.connection?.account_name ?? '',
  }));

  return NextResponse.json({ analytics: enriched });
}
