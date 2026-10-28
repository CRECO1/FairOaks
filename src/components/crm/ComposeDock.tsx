'use client';

import React, { useEffect, useRef, useState } from 'react';
import EmailComposer, { loadFollowUp, type Suggestion } from './EmailComposer';
import type { CrmAttachItem } from '@/lib/crm-attachments';
import DraftsSection from './DraftsSection';
import { gmailSignatureBlock } from '@/lib/agent-signature';
import { listDrafts, onDraftsChanged, type EmailDraft } from '@/lib/email-drafts';

// The Gmail-style Compose window: docked bottom-right on desktop, full-screen on a phone, reachable from
// every page, minimisable so you can keep working in the CRM while it waits. It writes to ANYONE — the
// send route files the email under the matching CRM contact (or creates one), so it is still logged,
// tracked and shown on that contact's card.

export type ComposeRequest = { nonce: number; to?: string; name?: string; subject?: string; cc?: string; bcc?: string; body?: string; resumeKey?: string; view?: 'drafts'; crmFiles?: CrmAttachItem[]; dealId?: string | null; clientId?: string | null; threadId?: string | null; inReplyTo?: string | null } | null;

export default function ComposeDock(props: {
  request: ComposeRequest;
  isMobile: boolean;
  userId: string;
  accessToken: string;
  agentName: string;
  signature?: string | null;
  suggest: (q: string) => Suggestion[];
  nameFor: (email: string) => string | undefined;
  notify: (msg: string) => void;
  onSyncSignature: () => void;
  onSent: () => void;
  onResumeDraft: (d: EmailDraft) => void;
}) {
  const { request, isMobile } = props;
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [full, setFull] = useState(false);
  const [instance, setInstance] = useState(0);
  // The window has two views, like Gmail's: the message you're writing, and your saved drafts.
  const [view, setView] = useState<'compose' | 'drafts'>('compose');
  const [draftCount, setDraftCount] = useState(0);
  useEffect(() => {
    const refresh = () => setDraftCount(listDrafts().length);
    refresh();
    return onDraftsChanged(refresh);
  }, []);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [individual, setIndividual] = useState(false);
  const [followUp, setFollowUp] = useState(0);
  useEffect(() => { setFollowUp(loadFollowUp()); }, []);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [crmFiles, setCrmFiles] = useState<CrmAttachItem[]>([]);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef<number | null>(null);

  // Someone pressed Compose (or an Email button): open a fresh window, pre-addressed if we were told who to.
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current) return;
    lastNonce.current = request.nonce;
    setTo(request.to ?? ''); setCc(request.cc ?? ''); setBcc(request.bcc ?? '');
    setSubject(request.subject ?? '');
    setAttachments([]); setCrmFiles(request.crmFiles ?? []); setMinimized(false); setFull(false);
    setView(request.view ?? 'compose');
    setInstance(i => i + 1);
    setOpen(true);
    // A Forward / mailto link brings its own body (HTML). Drop it in once the editor exists — unless a saved draft already filled it.
    if (request.body) {
      const html = request.body;
      setTimeout(() => {
        const el = bodyRef.current;
        if (!el || (el.innerText ?? '').trim()) { el?.focus(); return; }
        el.innerHTML = html;
        el.focus();
        const sel = window.getSelection();
        if (sel) { const r = document.createRange(); r.setStart(el, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, 160);
    }
  }, [request]);

  // Keep a phone's browser back/overscroll from fighting the full-screen sheet.
  useEffect(() => {
    if (!open || !isMobile || minimized) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, isMobile, minimized]);

  if (!open) return null;

  const draftKey = request?.resumeKey ?? `dock:${(request?.to ?? 'new').toLowerCase()}${request?.subject ? ':' + request.subject.slice(0, 60) : ''}`;

  async function send() {
    const recipients = to.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (!recipients.length) { props.notify('Add at least one recipient'); return; }
    setSending(true);
    try {
      const messageHtml = bodyRef.current?.innerHTML ?? '';
      const sig = props.signature ?? '';
      const fullBody = sig ? `${messageHtml}${gmailSignatureBlock(sig)}` : messageHtml || '&nbsp;';
      const files = await Promise.all(attachments.map(file => new Promise<{ name: string; mimeType: string; data: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data: (reader.result as string).split(',')[1] });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })));
      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${props.accessToken}` },
        body: JSON.stringify({
          userId: props.userId, toName: request?.name,
          ...(request?.dealId || request?.clientId ? { dealId: request.dealId ?? undefined, clientId: request.clientId ?? undefined } : { resolveClient: true }),
          ...(request?.threadId ? { threadId: request.threadId, inReplyTo: request.inReplyTo ?? undefined } : {}),
          to: recipients.join(', '), cc, bcc, individual: individual && !bcc.trim(),
          subject, body: fullBody, agentName: props.agentName, ccAgentIds: [], attachments: files, crmAttachments: crmFiles.map(f => ({ kind: f.kind, id: f.id })), followUpDays: followUp || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { props.notify('Send failed: ' + (json.error ?? res.status)); return; }
      props.notify(json.followUp?.due ? `Message sent · reminder set for ${json.followUp.label}` : 'Message sent');
      if (bodyRef.current) bodyRef.current.innerHTML = '';
      setOpen(false); setAttachments([]); setCrmFiles([]);
      props.onSent();
    } catch (err) {
      console.error(err);
      props.notify('Send error — check your connection and try again');
    } finally {
      setSending(false);
    }
  }

  const barBtn: React.CSSProperties = { width: isMobile ? 44 : 30, height: isMobile ? 44 : 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontSize: 16, borderRadius: 6, padding: 0, minWidth: 0, minHeight: 0 };
  const shell: React.CSSProperties = isMobile
    ? { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', flexDirection: 'column', background: 'var(--k-fff)', paddingBottom: 'env(safe-area-inset-bottom)' }
    : full
      ? { position: 'fixed', left: '50%', top: '5vh', transform: 'translateX(-50%)', width: 'min(920px, 92vw)', height: '88vh', zIndex: 1200, display: 'flex', flexDirection: 'column', background: 'var(--k-fff)', borderRadius: 12, boxShadow: '0 12px 48px rgba(0,0,0,.35)', overflow: 'hidden' }
      : { position: 'fixed', right: 24, bottom: 0, width: 580, maxWidth: 'calc(100vw - 32px)', height: minimized ? 44 : 'min(640px, calc(100vh - 24px))', zIndex: 1200, display: 'flex', flexDirection: 'column', background: 'var(--k-fff)', borderRadius: '12px 12px 0 0', boxShadow: '0 8px 36px rgba(0,0,0,.30)', overflow: 'hidden', transition: 'height .15s' };

  if (isMobile && minimized) {
    // A phone has no corner to dock in: a minimised message becomes a pill above the tab strip.
    return (
      <button type="button" onClick={() => setMinimized(false)}
        style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))', zIndex: 1200, height: 52, borderRadius: 14, background: '#111', color: '#fff', border: '1px solid rgba(201,146,44,.5)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}>
        <span>✉️</span><span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject.trim() || 'New message'}</span><span style={{ color: '#c9922c' }}>Open</span>
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="New message" style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMobile ? '4px 6px 4px 14px' : '0 6px 0 14px', height: isMobile ? 52 : 44, flexShrink: 0, background: '#111', color: '#fff', cursor: !isMobile && minimized ? 'pointer' : 'default' }}
        onClick={() => { if (!isMobile && minimized) setMinimized(false); }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{view === 'drafts' ? 'Drafts' : (subject.trim() || 'New message')}</span>
        {(draftCount > 0 || view === 'drafts') && (
          <button type="button" onClick={e => { e.stopPropagation(); setView(v => (v === 'drafts' ? 'compose' : 'drafts')); setMinimized(false); }}
            aria-label={view === 'drafts' ? 'Back to your message' : `Drafts (${draftCount})`} title={view === 'drafts' ? 'Back to your message' : 'Your saved drafts'}
            style={{ ...barBtn, width: 'auto', padding: '0 10px', fontSize: 13, fontWeight: 600, gap: 6, color: view === 'drafts' ? '#c9922c' : 'rgba(255,255,255,.85)' }}>
            {view === 'drafts' ? '← Message' : <>✎ Drafts <span style={{ background: '#c9922c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '0 6px', borderRadius: 9, lineHeight: '16px' }}>{draftCount}</span></>}
          </button>
        )}
        <button type="button" onClick={e => { e.stopPropagation(); setMinimized(m => !m); }} aria-label={minimized ? 'Restore' : 'Minimize'} title={minimized ? 'Restore' : 'Minimize'} style={barBtn}>{minimized ? '▢' : '—'}</button>
        {!isMobile && <button type="button" onClick={e => { e.stopPropagation(); setFull(f => !f); setMinimized(false); }} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen'} style={barBtn}>{full ? '⤡' : '⤢'}</button>}
        <button type="button" onClick={e => { e.stopPropagation(); setOpen(false); }} aria-label="Close (keeps your draft)" title="Close — your draft is kept" style={{ ...barBtn, fontSize: 18 }}>✕</button>
      </div>
      {view === 'drafts' && !minimized && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '12px 12px 24px' : '14px 16px 20px', background: 'var(--k-f9fafb)' }}>
          <DraftsSection isMobile={isMobile} onResume={d => { setOpen(false); props.onResumeDraft(d); }} />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: minimized || view === 'drafts' ? 'none' : 'flex', flexDirection: 'column' }}>
        <EmailComposer
          key={`${instance}`}
          variant="dock" isMobile={isMobile} title="New message"
          moreTo={to} setMoreTo={setTo} cc={cc} setCc={setCc} bcc={bcc} setBcc={setBcc}
          individual={individual} setIndividual={setIndividual}
          followUp={followUp} setFollowUp={setFollowUp}
          subject={subject} setSubject={setSubject}
          suggest={props.suggest} nameFor={props.nameFor}
          draftKey={draftKey} notify={props.notify}
          bodyRef={bodyRef} attachments={attachments} setAttachments={setAttachments}
          crmFiles={{ ctx: { email: to.split(/[,;]+/).map(x => x.trim()).filter(Boolean).map(x => x.match(/<([^>]+)>/)?.[1] ?? x)[0], searchable: true }, items: crmFiles, setItems: setCrmFiles }}
          signature={props.signature} onSyncSignature={props.onSyncSignature}
          sending={sending} onSend={send}
          onDiscard={() => { setOpen(false); setAttachments([]); setCrmFiles([]); }}
        />
      </div>
    </div>
  );
}
