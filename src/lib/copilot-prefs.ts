// What an agent has asked the Copilot to remember between chats ("always sign off as Zack", "LOIs default to a
// 60-day due diligence"). A chat is kept 24 hours; these are kept until the agent removes them, and they are
// added to the system prompt of every turn. One row per agent in crm_copilot_prefs (supabase/copilot-prefs.sql),
// service role only.
import type { SupabaseClient } from '@supabase/supabase-js';

export const PREF_MAX = 20;
export const PREF_MAX_CHARS = 300;

const clean = (list: unknown): string[] =>
  (Array.isArray(list) ? list : []).map(x => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).map(s => s.slice(0, PREF_MAX_CHARS)).slice(0, PREF_MAX);

/** The agent's saved preferences. null means the feature is not available (the table is not there yet, or could not be read), which also hides its tools. */
export async function loadCopilotPrefs(db: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data, error } = await db.from('crm_copilot_prefs').select('prefs').eq('user_id', userId).maybeSingle();
  if (error) return null;
  return clean(data?.prefs);
}

export async function saveCopilotPrefs(db: SupabaseClient, userId: string, prefs: string[]): Promise<{ ok: true; prefs: string[] } | { ok: false }> {
  const list = clean(prefs);
  const { error } = await db.from('crm_copilot_prefs').upsert({ user_id: userId, prefs: list, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) { console.error('[copilot-prefs] save', error.message); return { ok: false }; }
  return { ok: true, prefs: list };
}
