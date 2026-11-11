// The wire format for a Copilot turn that reports progress while it works.
//
// One JSON object per line (NDJSON). The browser asks for it with `stream: true`; without that flag
// /api/crm/assistant still answers with one JSON body, so an older tab keeps working across a deploy.
//
// Shared by the route and the panel, so it must stay free of server-only imports.

export type CopilotEvent =
  /** What the Copilot is doing right now ("Searching contacts"). */
  | { t: 'step'; label: string }
  /** A piece of the reply, as it is written. */
  | { t: 'text'; d: string }
  /** A new model round began: text from here on is a new paragraph. */
  | { t: 'round' }
  /** The finished turn: exactly the JSON the non-streaming route returns. */
  | { t: 'done'; payload: unknown }
  | { t: 'error'; error: string };

/** A confirmed write is appended to the log as a tool call with this id prefix (lib/copilot-turn). The panel recognises it so it
 *  doesn't draw a second "added a contact" line above the ✓ that follows. */
export const CONFIRMED_ID_PREFIX = 'toolu_cf_';

export const encodeEvent = (e: CopilotEvent): string => `${JSON.stringify(e)}\n`;

/** Reassembles events from network chunks, which split lines anywhere. A line that is not valid JSON is skipped, never thrown. */
export function ndjsonParser(onEvent: (e: CopilotEvent) => void): { push: (chunk: string) => void; end: () => void } {
  let buf = '';
  const take = (line: string) => {
    const s = line.trim();
    if (!s) return;
    try { const e = JSON.parse(s) as CopilotEvent; if (e && typeof e === 'object' && typeof (e as { t?: unknown }).t === 'string') onEvent(e); }
    catch { /* a torn or foreign line: ignore it */ }
  };
  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    },
    end() { take(buf); buf = ''; },
  };
}

// What to show while each tool runs. Present tense, no trailing dots (the panel adds them).
const STEP: Record<string, string> = {
  search_contacts: 'Searching contacts', get_contact: 'Reading the contact', list_tasks: 'Checking tasks',
  list_deals: 'Checking deals', get_deal: 'Reading the deal', list_deal_files: 'Looking at the deal’s files',
  find_property: 'Looking for the property', list_properties: 'Checking properties', get_property: 'Reading the property',
  list_forms: 'Looking through the forms', autofill_loi: 'Pre-filling the letter of intent', draft_lease: 'Working out the lease terms',
  read_document: 'Reading the document', esign_status: 'Checking e-signature status', get_file_link: 'Getting the file',
  find_drive_items: 'Looking in My Drive', read_drive_doc: 'Reading the document',
  lookup_texas_entity: 'Checking the Texas business record', list_campaign_projects: 'Checking campaigns', count_audience: 'Counting who that reaches',
  open_page: 'Opening that section', open_record: 'Opening it',
  web_search: 'Searching the web', web_fetch: 'Reading a web page',
};

/** The progress line for a tool. A write is never run mid-turn, so it reads as getting the confirmation ready. */
export function stepLabel(tool: string, isWrite = false): string {
  if (isWrite) return 'Getting the confirmation ready';
  // The web tools can run a little code of their own to sift what they found.
  if (tool.includes('code_execution')) return 'Sorting through the results';
  return STEP[tool] ?? 'Working on it';
}

/**
 * An HTTP response that carries a turn's progress as it happens, then its result.
 *
 * `run` gets `emit` for progress and a signal that aborts when the browser goes away (panel closed, tab gone), so a
 * turn nobody is waiting for stops spending. Whatever `run` returns is sent as the final `done` event; if it throws,
 * `onError` supplies the message for an `error` event instead.
 */
export function ndjsonResponse(run: (emit: (e: CopilotEvent) => void, signal: AbortSignal) => Promise<unknown>, onError: (e: unknown) => string): Response {
  const abort = new AbortController();
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let live = true;
      const emit = (e: CopilotEvent) => { if (!live) return; try { controller.enqueue(enc.encode(encodeEvent(e))); } catch { live = false; } };
      try { emit({ t: 'done', payload: await run(emit, abort.signal) }); }
      catch (e) { if (!abort.signal.aborted) emit({ t: 'error', error: onError(e) }); }
      finally { live = false; try { controller.close(); } catch { /* already closed by the browser going away */ } }
    },
    cancel() { abort.abort(); },
  });
  // no-transform + X-Accel-Buffering keep proxies from holding lines back to compress or batch them.
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
