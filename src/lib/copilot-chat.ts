// The Copilot's chat log: the retention rules shared by the browser (AssistantPanel) and the
// server (/api/crm/assistant/chat), so both prune the same way.
//
// A conversation is kept 24 hours. Messages are Anthropic-shaped, so a tool_use must stay
// next to its tool_result or the API rejects the whole history — pruning therefore only ever
// cuts at the start of a plain user question.

export type ChatBlock = { type: string; [k: string]: unknown };
export type ChatMsg = { role: 'user' | 'assistant'; content: string | ChatBlock[] };

export const KEEP_MS = 24 * 60 * 60 * 1000;
export const PENDING_KEEP_MS = 25 * 60 * 1000;     // approval tickets are valid for 30 minutes server-side
export const SEND_LIMIT_CHARS = 100_000;           // /api/crm/assistant refuses > 120k chars or > 150 messages
export const SEND_LIMIT_MSGS = 120;
export const STORE_LIMIT_CHARS = 450_000;

export function startsQuestion(m: ChatMsg): boolean {
  if (m.role !== 'user') return false;
  if (typeof m.content === 'string') return true;
  return m.content.some(b => b.type === 'text') && !m.content.some(b => b.type === 'tool_result');
}

export function pruneOld<M extends ChatMsg>(messages: M[], stamps: number[], now = Date.now()): { messages: M[]; stamps: number[] } {
  const cut = now - KEEP_MS;
  let from = 0;
  while (from < messages.length && (stamps[from] ?? now) < cut) from++;
  if (from === 0) return { messages, stamps };
  while (from < messages.length && !startsQuestion(messages[from])) from++;
  return { messages: messages.slice(from), stamps: stamps.slice(from) };
}

/** Drop the oldest whole exchanges until what is sent fits the server's request limits. */
export function fitForSend<M extends ChatMsg>(messages: M[]): M[] {
  let out = messages;
  while (out.length > 1 && (out.length > SEND_LIMIT_MSGS || JSON.stringify(out).length > SEND_LIMIT_CHARS)) {
    let i = 1;
    while (i < out.length && !startsQuestion(out[i])) i++;
    if (i >= out.length) break;
    out = out.slice(i);
  }
  return out;
}
