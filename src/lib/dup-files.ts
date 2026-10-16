// Detect a file that is already attached: same size first (cheap, from the DB row), then a byte
// comparison against storage. Name is deliberately ignored — the same image uploaded twice under two
// names ("Floor Plan.png" and "Exhibit A - Floor Plan.png") is still a duplicate.
// Every failure path answers "not a duplicate": this guard may never be the reason an upload is lost.
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

async function sha256(supabase: SupabaseClient, bucket: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return null;
    return crypto.createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex');
  } catch { return null; }
}

/** The first of `candidates` (rows of the same size) whose stored bytes equal those at `newPath`. */
export async function findIdenticalFile<T extends { storage_path: string }>(
  supabase: SupabaseClient, bucket: string, newPath: string, candidates: T[], max = 6,
): Promise<T | null> {
  const others = candidates.filter(c => c.storage_path !== newPath).slice(0, max);
  if (!others.length) return null;
  const mine = await sha256(supabase, bucket, newPath);
  if (!mine) return null;
  for (const c of others) if ((await sha256(supabase, bucket, c.storage_path)) === mine) return c;
  return null;
}
