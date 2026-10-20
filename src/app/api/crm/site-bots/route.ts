import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Crawler visits (AI assistants + search engines) logged by the fairoaksranchplaza.com middleware (table site_bot_hits). Admin-only.
const AI = new Set(['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Amazonbot', 'Bytespider', 'CCBot', 'meta-externalagent', 'DuckAssistBot', 'MistralAI-User', 'YouBot', 'cohere-ai']);

export async function GET(req: NextRequest) {
  if (!(await getCrmAdmin(req))) return unauthorized();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data, error } = await adminClient().from('site_bot_hits').select('bot, path, created_at').eq('site', 'fairoaksranchplaza.com').gte('created_at', since).order('created_at', { ascending: false }).limit(10000);
  if (error) { console.error('[site-bots]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  const rows = data ?? [];
  const week = Date.now() - 7 * 86400_000;
  const by: Record<string, { bot: string; ai: boolean; d7: number; d30: number; last: string }> = {};
  const paths: Record<string, number> = {};
  for (const r of rows) {
    const b = (by[r.bot] ??= { bot: r.bot, ai: AI.has(r.bot), d7: 0, d30: 0, last: r.created_at });
    b.d30++; if (new Date(r.created_at).getTime() >= week) b.d7++;
    if (AI.has(r.bot)) paths[r.path] = (paths[r.path] ?? 0) + 1;
  }
  return NextResponse.json({
    bots: Object.values(by).sort((a, b) => b.d30 - a.d30),
    topPaths: Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([path, hits]) => ({ path, hits })),
    recent: rows.slice(0, 12),
    total30: rows.length,
  });
}
