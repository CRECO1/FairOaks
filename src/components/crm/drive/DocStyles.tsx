'use client';

/** The page typography shared by the live editor, the version preview and the quick-look panel. */
export function DocStyles() {
  return (
    <style>{`
      .drive-doc { outline: none; font-family: 'DM Sans', system-ui, sans-serif; font-size: 15.5px; line-height: 1.7; color: var(--k-1a1a1a); min-height: 50vh; overflow-wrap: anywhere; }
      .drive-doc, .drive-doc:focus, .drive-doc:focus-visible { outline: none !important; box-shadow: none !important; border: none !important; }
      .drive-doc > * + * { margin-top: .6em; }
      .drive-doc h1 { font-size: 1.9em; line-height: 1.25; font-weight: 700; margin: 1em 0 .3em; }
      .drive-doc h2 { font-size: 1.45em; line-height: 1.3; font-weight: 700; margin: 1em 0 .3em; }
      .drive-doc h3 { font-size: 1.15em; line-height: 1.35; font-weight: 700; margin: .9em 0 .2em; }
      .drive-doc p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--k-9ca3af); }
      .drive-doc ul, .drive-doc ol { padding-left: 1.5em; }
      .drive-doc ul { list-style: disc; } .drive-doc ol { list-style: decimal; }
      .drive-doc li > p { margin: 0; }
      .drive-doc ul[data-type="taskList"] { list-style: none; padding-left: .2em; }
      .drive-doc ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
      .drive-doc ul[data-type="taskList"] li > label { flex: 0 0 auto; margin-top: .35em; user-select: none; }
      .drive-doc ul[data-type="taskList"] li > label input { width: 17px; height: 17px; accent-color: #c9922c; cursor: pointer; }
      .drive-doc ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
      .drive-doc ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: var(--k-9ca3af); }
      .drive-doc blockquote { border-left: 3px solid #c9922c; margin-left: 0; padding: 2px 0 2px 14px; color: var(--k-4b5563); }
      .drive-doc hr { border: none; border-top: 1px solid var(--k-e5e7eb); margin: 1.2em 0; }
      .drive-doc a { color: var(--k-1d4ed8); text-decoration: underline; cursor: pointer; }
      .drive-doc mark { background: #fde68a; color: inherit; border-radius: 2px; padding: 0 1px; }
      .drive-doc code { background: var(--k-f3f4f6); border-radius: 4px; padding: 1px 5px; font-size: .9em; }
      .drive-doc pre { background: var(--k-f3f4f6); border-radius: 8px; padding: 10px 12px; overflow-x: auto; }
      .drive-doc table { border-collapse: collapse; table-layout: auto; width: 100%; margin: .8em 0; }
      /* The CRM's global table styles (tiny uppercase headers, bottom-border-only cells) must not leak into documents. */
      .drive-doc table td, .drive-doc table th { border: 1px solid var(--k-d1d5db) !important; padding: 6px 8px !important; vertical-align: top; position: relative; min-width: 64px; font-size: inherit !important; text-transform: none !important; letter-spacing: 0 !important; color: var(--k-1a1a1a) !important; line-height: 1.6; overflow-wrap: break-word; word-break: normal; }
      .drive-doc table th { background: var(--k-f3f4f6) !important; font-weight: 700 !important; text-align: left; }
      .drive-doc table td > p, .drive-doc table th > p { margin: 0; }
      .drive-doc .selectedCell::after { content: ''; position: absolute; inset: 0; background: rgba(201,146,44,.18); pointer-events: none; }
      .drive-doc .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px; background: #c9922c; pointer-events: none; }
      .drive-doc .tableWrapper { overflow-x: auto; }
      .drive-doc .comment-hl { background: rgba(250, 204, 21, .32); border-bottom: 2px solid #eab308; cursor: pointer; border-radius: 2px; }
      .collaboration-cursor__caret { position: relative; margin-left: -1px; margin-right: -1px; border-left: 1px solid #0d0d0d; border-right: 1px solid #0d0d0d; word-break: normal; pointer-events: none; }
      .collaboration-cursor__label { position: absolute; top: -1.45em; left: -1px; font-size: 11px; font-style: normal; font-weight: 600; line-height: normal; user-select: none; color: #fff; padding: 1px 6px; border-radius: 4px 4px 4px 0; white-space: nowrap; }
    `}</style>
  );
}
