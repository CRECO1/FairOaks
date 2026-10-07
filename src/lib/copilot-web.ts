import type Anthropic from '@anthropic-ai/sdk';

// Outside lookups for the copilot: Anthropic's server-side web search + web fetch.
// They run on Anthropic's side inside the same messages.create call — there is no
// handler in runTool and nothing to confirm, because they read the public web and
// change nothing in the CRM. Per-request caps keep a single question from turning
// into dozens of billed searches.
export const WEB_TOOLS: Anthropic.ToolUnion[] = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 5,
    // Our market — biases "near me" style results toward the brokerage's area.
    user_location: { type: 'approximate', city: 'San Antonio', region: 'Texas', country: 'US', timezone: 'America/Chicago' },
  },
  {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    max_uses: 3,
    // A listing page or article is plenty at this size; whole sites are not.
    max_content_tokens: 20_000,
  },
];

const KEEP = new Set(['text', 'tool_use']);
const CLIENT_SAFE = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use']);

/**
 * Shrinks finished web-research turns before the history goes back to the browser.
 *
 * The panel replays the whole conversation on every turn, and a search result block
 * carries kilobytes of encrypted page content per hit — two searches would trip the
 * route's 120k history ceiling and every later turn would re-bill those tokens. Once
 * a turn is answered, only what was SAID matters: the assistant's text (split into
 * citation fragments by the API) is joined back into one block with a deduplicated
 * Sources list, and the search/fetch/code blocks are dropped. Client tool_use blocks
 * stay — their tool_result answers sit in the next message. Only call this on a
 * completed turn; a paused or mid-loop turn must go back to the API untouched.
 */
export function compactWebTurns(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map(m => {
    if (m.role !== 'assistant' || typeof m.content === 'string') return m;
    const blocks = m.content as Anthropic.ContentBlockParam[];
    if (blocks.every(b => CLIENT_SAFE.has(b.type))) return m;

    const sources = new Map<string, string>();
    let text = '';
    const toolUses: Anthropic.ContentBlockParam[] = [];
    // Adjacent text blocks are one passage split at citations — join them as-is. Text
    // on either side of a search is two passages, so it gets a paragraph break.
    let gap = false;
    for (const b of blocks) {
      if (!KEEP.has(b.type)) { gap = true; continue; }
      if (b.type === 'tool_use') { toolUses.push(b); continue; }
      const tb = b as Anthropic.TextBlockParam;
      text += (gap && text.trim() ? '\n\n' : '') + tb.text;
      gap = false;
      for (const c of tb.citations ?? []) {
        const url = (c as { url?: string }).url;
        if (url && !sources.has(url)) sources.set(url, (c as { title?: string | null }).title || url);
      }
    }
    text = text.trim();
    if (sources.size) {
      text += `\n\nSources:\n${[...sources].slice(0, 8).map(([url, title]) => `• ${title === url ? url : `${title} — ${url}`}`).join('\n')}`;
    }
    const content: Anthropic.ContentBlockParam[] = [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...toolUses,
    ];
    // An assistant turn can't be empty; this only happens if a search ran and the
    // model then said nothing, which the loop never returns, but stay valid anyway.
    return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(searched the web)' }] };
  });
}
