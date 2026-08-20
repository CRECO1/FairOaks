'use client';

// Send a document for signature, in the order the job actually happens:
//
//   1. Set Up Envelope — the document, who signs it, what the email says
//   2. Add Fields      — drag signature / initials / date onto the page, per person
//   3. Review & Send   — see exactly who signs where, then send
//
// Recipients are collected BEFORE the fields on purpose: once the people are known,
// a field is placed against a NAMED person rather than an abstract role, so two
// clients on one document can't collide and the agent sees "Jane Mills — Signature"
// on the page instead of "client".

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TransactionDocEditor, { type EditorRecipient, type EditorField } from '@/components/crm/TransactionDocEditor';
import SignPreviewModal from '@/components/crm/SignPreviewModal';
import type { PickContact } from '@/components/crm/EsignPanel';

const GOLD = '#c9922c';
// One colour per recipient, reused by the toolbar picker and the field chips so the
// page reads at a glance: "everything gold is Jane's".
const COLORS = ['#c9922c', '#2563eb', '#16a34a', '#7c3aed', '#db2777', '#0891b2', '#ea580c'];
const ROLES = [['client', 'Client'], ['landlord', 'Landlord'], ['agent', 'Agent'], ['seller', 'Seller'], ['buyer', 'Buyer'], ['witness', 'Witness'], ['other', 'Other']] as const;
const authOf = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const cName = (c: PickContact) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';

export interface ComposerDoc { id: string; title?: string; url?: string | null; pageCount?: number }
interface Recipient { key: string; name: string; email: string; role: string }
interface DealLite { id: string; client?: string; property?: string }

const INP: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif", color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' };
const LBL: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4, display: 'block' };

// One collapsible section of the setup page.
function Section({ title, open, onToggle, done, children }: { title: string; open: boolean; onToggle: () => void; done?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid #eef0f2' }}>
      <button onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '20px 0', textAlign: 'left', fontFamily: "'DM Sans',sans-serif" }}>
        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 23, fontWeight: 700, color: '#111' }}>{title}</span>
        {done && <span style={{ fontSize: 12.5, color: '#15803d', background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>{done}</span>}
        <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 14, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>⌄</span>
      </button>
      {open && <div style={{ paddingBottom: 24 }}>{children}</div>}
    </div>
  );
}

let _rk = 0;
const newKey = () => `r${++_rk}`;

export default function EsignComposer({
  initialDoc, initialFile, clients = [], deals, agentName, agentEmail, authToken, businessUnit, isAdmin, isMobile,
  onClose, onSent, showToast,
}: {
  initialDoc?: ComposerDoc | null;
  initialFile?: File | null;
  clients?: PickContact[];
  deals?: DealLite[];
  agentName?: string; agentEmail?: string;
  authToken?: string; businessUnit?: string; isAdmin?: boolean; isMobile?: boolean;
  onClose: () => void;
  onSent: () => void;
  showToast?: (m: string) => void;
}) {
  const [step, setStep] = useState<'setup' | 'fields'>('setup');
  const [entered, setEntered] = useState(false);   // has the field editor been opened yet
  const goFields = () => { setEntered(true); setStep('fields'); };
  const [doc, setDoc] = useState<ComposerDoc | null>(initialDoc ?? null);
  const [open, setOpen] = useState<'doc' | 'people' | 'message' | null>(initialDoc ? 'people' : 'doc');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [onlySigner, setOnlySigner] = useState(false);
  const [ordered, setOrdered] = useState(true);
  const [recipients, setRecipients] = useState<Recipient[]>([{ key: newKey(), name: '', email: '', role: 'client' }]);
  const [pick, setPick] = useState<string | null>(null);   // which recipient's name box is showing suggestions

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { if (doc && !subject) setSubject(`Please sign: ${doc.title || 'Document'}`); }, [doc, subject]);

  const [placed, setPlaced] = useState<EditorField[]>([]);
  const [review, setReview] = useState(false);
  const [sending, setSending] = useState(false);

  // ── Import ────────────────────────────────────────────────────────────────
  const importFile = useCallback(async (file: File) => {
    if (!/\.pdf$/i.test(file.name)) { showToast?.('Only PDFs can be sent for signature — save it as a PDF first'); return; }
    setUploading(true);
    try {
      const pre = await fetch('/api/crm/esign-import', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ filename: file.name, file_size: file.size }) });
      const pj = await pre.json().catch(() => ({}));
      if (!pre.ok) { showToast?.(pj.error || 'Could not start the upload'); return; }
      const put = await fetch(pj.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
      if (!put.ok) { showToast?.('The upload failed — try again'); return; }
      const conf = await fetch('/api/crm/esign-import', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authOf(authToken) }, body: JSON.stringify({ storage_path: pj.storagePath, title: file.name }) });
      const cj = await conf.json().catch(() => ({}));
      if (!conf.ok) { showToast?.(cj.error || 'Could not import that document'); return; }
      // Read back the signed URL the editor and the review both render from.
      const s = await fetch(`/api/crm/form-submissions/${cj.submission.id}`, { headers: authOf(authToken) }).then(r => r.json()).catch(() => ({}));
      setDoc({ id: cj.submission.id, title: cj.submission.title, url: s.blankUrl ?? s.filledUrl ?? null, pageCount: cj.page_count });
      setOpen('people');
    } catch { showToast?.('Could not import that document'); }
    finally { setUploading(false); }
  }, [authToken, showToast]);

  const consumed = useRef(false);
  useEffect(() => { if (initialFile && !consumed.current) { consumed.current = true; importFile(initialFile); } }, [initialFile, importFile]);

  // ── Recipients ────────────────────────────────────────────────────────────
  const set = (key: string, p: Partial<Recipient>) => setRecipients(rs => rs.map(r => r.key === key ? { ...r, ...p } : r));
  const move = (i: number, d: -1 | 1) => setRecipients(rs => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const c = [...rs]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const suggestions = (q: string) => q.trim().length < 2 ? [] : clients.filter(c => `${cName(c)} ${c.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);

  const signers = useMemo(() => onlySigner
    ? [{ key: 'me', name: agentName || 'Me', email: agentEmail || '', role: 'agent' }]
    : recipients, [onlySigner, recipients, agentName, agentEmail]);
  const valid = useMemo(() => signers.filter(r => r.name.trim() && r.email.includes('@')), [signers]);
  const editorRecipients: EditorRecipient[] = useMemo(
    () => valid.map((r, i) => ({ key: r.key, name: r.name.trim(), email: r.email.trim(), role: r.role, color: COLORS[i % COLORS.length] })),
    [valid]);

  const blocker = !doc ? 'Add a document first'
    : valid.length === 0 ? 'Add at least one signer with a name and a valid email'
    : !subject.trim() ? 'The email needs a subject'
    : null;

  // ── Send ──────────────────────────────────────────────────────────────────
  // Fields are stored against a recipient key; the signing order is what the
  // envelope is actually built from, so resolve key → position at send time.
  const signerIndex = useMemo(() => new Map(valid.map((r, i) => [r.key, i + 1])), [valid]);
  // A field placed for someone who was later removed is DROPPED, never handed to
  // whoever now holds that role — silently moving a signature is the worst failure
  // this screen could have. The review shows what survives, so it's visible.
  const orphaned = useMemo(
    () => placed.filter(f => ['signature', 'initial', 'date'].includes(f.type) && f.signerKey && !signerIndex.has(f.signerKey)).length,
    [placed, signerIndex]);
  const effective = useMemo(() => placed
    .filter(f => ['signature', 'initial', 'date'].includes(f.type) && (!f.signerKey || signerIndex.has(f.signerKey)))
    .map(f => ({ page: f.page, fx: f.fx, fy: f.fy, fw: f.fw, type: f.type, signerRole: f.signerRole ?? 'client', signerIndex: f.signerKey ? signerIndex.get(f.signerKey)! : null })),
    [placed, signerIndex]);

  const send = useCallback(async () => {
    if (!doc) return;
    setSending(true);
    try {
      // Persist the placements with each field pointing at its signer's position,
      // minus any whose signer is gone.
      const values = placed
        .filter(f => !f.signerKey || signerIndex.has(f.signerKey))
        .map(f => ({ ...f, signerIndex: f.signerKey ? signerIndex.get(f.signerKey)! : null }));
      const up = await fetch(`/api/crm/form-submissions/${doc.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authOf(authToken) },
        body: JSON.stringify({ values, logSummary: `Assigned ${values.length} field(s) to ${valid.length} signer(s) before sending` }),
      });
      if (!up.ok) { showToast?.('Could not save the field assignments'); return; }

      const r = await fetch('/api/crm/envelopes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(authToken) },
        body: JSON.stringify({
          submission_id: doc.id, title: doc.title, message: message || null,
          signers: valid.map((x, i) => ({ signer_role: x.role, name: x.name.trim(), email: x.email.trim(), signing_order: ordered ? i + 1 : 1 })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not send'); return; }
      showToast?.(j.sent ? `📤 Sent to ${valid[0].email} ✓` : 'Signature request created');
      onSent();
    } finally { setSending(false); }
  }, [doc, valid, placed, signerIndex, message, ordered, authToken, showToast, onSent]);

  // ── Step 2: place the fields ──────────────────────────────────────────────
  // The editor stays MOUNTED once it has been opened, with the setup screen drawn
  // over it — going back to fix a recipient would otherwise throw away every field
  // already placed, since the placements live in the editor until they're saved.
  const editor = entered && doc ? (
    <>
        <TransactionDocEditor
          form={{ id: '', name: doc.title || 'Document' }}
          url={doc.url || ''}
          submissionId={doc.id}
          authToken={authToken}
          isAdmin={isAdmin}
          deals={deals}
          businessUnit={businessUnit}
          isMobile={isMobile}
          recipients={editorRecipients}
          onBack={() => setStep('setup')}
          onFieldsChange={setPlaced}
          onSend={f => {
            setPlaced(f);
            const gone = f.filter(x => ['signature', 'initial', 'date'].includes(x.type) && x.signerKey && !signerIndex.has(x.signerKey)).length;
            if (gone) showToast?.(`${gone} field${gone === 1 ? '' : 's'} belonged to a removed signer and won't be sent`);
            setReview(true);
          }}
          onToast={showToast}
          onClose={onClose}
          onSaved={() => {
            // Saving rewrites the PDF, so the review needs the current signed URL.
            fetch(`/api/crm/form-submissions/${doc.id}`, { headers: authOf(authToken) })
              .then(r => r.json())
              .then(j => setDoc(d => d ? { ...d, url: j.filledUrl ?? d.url } : d))
              .catch(() => { /* keep the old link */ });
          }}
        />
    </>
  ) : null;

  // ── Step 1: set up the envelope ───────────────────────────────────────────
  // Both steps render the SAME tree shape — the setup screen is an overlay that
  // appears and disappears above the editor. Returning a different root for each
  // step would make React unmount the editor and take every placed field with it.
  return (
    <>
    {editor}
    {/* Rendered here rather than inside the editor so the send flow is reachable
        without it — see the mobile path below. */}
    {review && doc?.url && (
      <SignPreviewModal url={doc.url} fields={effective} busy={sending}
        signers={editorRecipients.map(r => ({ name: r.name, role: r.role, color: r.color }))}
        signerLabel={role => valid.find(v => v.role === role)?.name || role}
        onClose={() => setReview(false)}
        onConfirm={async () => { await send(); setReview(false); }}
        confirmLabel="📤 Send for signature" />
    )}
    {step === 'setup' && (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 1001, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, padding: isMobile ? '12px 12px calc(12px + env(safe-area-inset-top))' : '14px 20px', borderBottom: '1px solid #eef0f2', flexShrink: 0, paddingTop: isMobile ? 'calc(12px + env(safe-area-inset-top))' : undefined }}>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 19, color: '#6b7280', cursor: 'pointer', padding: 0 }}>✕</button>
        {!isMobile && <span style={{ width: 1, height: 22, background: '#e5e7eb' }} />}
        {!isMobile && <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>Set Up Envelope</div>}
        <span style={{ flex: 1 }} />
        {orphaned > 0 && !isMobile && (
          <span style={{ fontSize: 12.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '4px 10px', fontWeight: 700 }}>
            ⚠ {orphaned} field{orphaned === 1 ? '' : 's'} lost its signer — re-place {orphaned === 1 ? 'it' : 'them'}
          </span>
        )}
        {blocker && !isMobile && <span style={{ fontSize: 12.5, color: '#9ca3af' }}>{blocker}</span>}
        {isMobile && (
          <button onClick={goFields} disabled={!!blocker} title="Easier on a desktop"
            style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 9, padding: '10px 12px', cursor: blocker ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: blocker ? 0.5 : 1 }}>
            ✒ Fields
          </button>
        )}
        <button onClick={() => { if (isMobile) { setPlaced([]); setReview(true); } else goFields(); }} disabled={!!blocker}
          style={{ fontSize: 13.5, fontWeight: 800, color: '#fff', background: blocker ? '#d8d5cf' : GOLD, border: 'none', borderRadius: 9, padding: isMobile ? '10px 13px' : '10px 18px', cursor: blocker ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {isMobile ? 'Review & Send' : 'Next: Add Fields →'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '10px 20px 60px' }}>

          {/* 1 — the document */}
          <Section title="Add document" open={open === 'doc'} onToggle={() => setOpen(o => o === 'doc' ? null : 'doc')}
            done={doc ? `${doc.pageCount ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}` : 'Ready'}` : undefined}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
            {doc ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '1px solid #eef0f2', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
                <span style={{ fontSize: 24 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                  <div style={{ fontSize: 12.5, color: '#9ca3af' }}>{doc.pageCount ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'} · ` : ''}PDF</div>
                </div>
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>Replace</button>
              </div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) importFile(f); }}
                onClick={() => !uploading && fileRef.current?.click()}
                style={{ border: `2px dashed ${dragging ? GOLD : '#e6d3a2'}`, background: dragging ? '#fdf6e9' : '#fafafa', borderRadius: 12, padding: '38px 20px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer' }}>
                <div style={{ fontSize: 30, marginBottom: 6 }}>{uploading ? '⏳' : '⬆'}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>{uploading ? 'Importing…' : 'Drop your PDF here'}</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 3 }}>{uploading ? 'Checking the file…' : 'or click to browse'}</div>
              </div>
            )}
          </Section>

          {/* 2 — who signs */}
          <Section title="Add recipients" open={open === 'people'} onToggle={() => setOpen(o => o === 'people' ? null : 'people')}
            done={valid.length ? `${valid.length} signer${valid.length === 1 ? '' : 's'}` : undefined}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#374151', cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={onlySigner} onChange={e => setOnlySigner(e.target.checked)} />
              I&apos;m the only signer
            </label>
            {onlySigner ? (
              <div style={{ fontSize: 13, color: '#6b7280', background: '#fafafa', border: '1px solid #eef0f2', borderRadius: 10, padding: '13px 15px' }}>
                This goes to <strong>{agentName || 'you'}</strong>{agentEmail ? ` (${agentEmail})` : ''} and nobody else.
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#374151', cursor: 'pointer', marginBottom: 14 }}>
                  <input type="checkbox" checked={ordered} onChange={e => setOrdered(e.target.checked)} />
                  Sign in order — each person is emailed once the one before them signs
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {recipients.map((r, i) => {
                    const color = COLORS[i % COLORS.length];
                    const sugg = pick === r.key ? suggestions(r.name) : [];
                    return (
                      <div key={r.key} style={{ display: 'flex', borderRadius: 12, border: '1px solid #eef0f2', overflow: 'visible', background: '#fff' }}>
                        <div style={{ width: 5, background: color, borderRadius: '12px 0 0 12px', flexShrink: 0 }} />
                        <div style={{ flex: 1, padding: '14px 16px', minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            {ordered && <span style={{ fontSize: 11.5, fontWeight: 800, color, background: `${color}18`, borderRadius: 20, padding: '2px 9px' }}>{i + 1}</span>}
                            <select value={r.role} onChange={e => set(r.key, { role: e.target.value })}
                              style={{ fontSize: 12.5, fontWeight: 700, color: '#374151', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 8px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
                              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <span style={{ flex: 1 }} />
                            {recipients.length > 1 && (
                              <>
                                <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#e5e7eb' : '#9ca3af', fontSize: 13, padding: '2px 4px' }}>▲</button>
                                <button onClick={() => move(i, 1)} disabled={i === recipients.length - 1} title="Move down" style={{ background: 'none', border: 'none', cursor: i === recipients.length - 1 ? 'default' : 'pointer', color: i === recipients.length - 1 ? '#e5e7eb' : '#9ca3af', fontSize: 13, padding: '2px 4px' }}>▼</button>
                                <button onClick={() => setRecipients(rs => rs.filter(x => x.key !== r.key))} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e5b4b4', fontSize: 14, padding: '2px 4px' }}>✕</button>
                              </>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {/* Typing a name searches the CRM and fills the email — no re-typing
                                what we already know about a contact. */}
                            <div style={{ flex: '1 1 220px', position: 'relative', minWidth: 0 }}>
                              <label style={LBL}>Name</label>
                              <input value={r.name} placeholder="Start typing a contact…"
                                onChange={e => { set(r.key, { name: e.target.value }); setPick(r.key); }}
                                onFocus={() => setPick(r.key)}
                                onBlur={() => setTimeout(() => setPick(p => p === r.key ? null : p), 150)}
                                style={INP} />
                              {sugg.length > 0 && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden' }}>
                                  {sugg.map(c => (
                                    <button key={c.id} onMouseDown={e => e.preventDefault()}
                                      onClick={() => { set(r.key, { name: cName(c), email: c.email || '' }); setPick(null); }}
                                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{cName(c)}</div>
                                      {c.email && <div style={{ fontSize: 11.5, color: '#9ca3af' }}>{c.email}</div>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                              <label style={LBL}>Email</label>
                              <input value={r.email} onChange={e => set(r.key, { email: e.target.value })} placeholder="name@company.com" style={INP} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => setRecipients(rs => [...rs, { key: newKey(), name: '', email: '', role: 'client' }])}
                    style={{ fontSize: 13, fontWeight: 700, color: '#a06a12', background: '#fffdf6', border: '1px dashed #e6d3a2', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>＋ Add recipient</button>
                  {agentName && !recipients.some(r => r.email && r.email === agentEmail) && (
                    <button onClick={() => setRecipients(rs => [...rs, { key: newKey(), name: agentName, email: agentEmail || '', role: 'agent' }])}
                      style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>＋ Me (agent)</button>
                  )}
                </div>
              </>
            )}
          </Section>

          {isMobile && (
            <div style={{ fontSize: 12.5, color: '#7c5a12', background: '#fffdf6', border: '1px solid #f0e2c4', borderRadius: 10, padding: '11px 13px', margin: '16px 0 0', lineHeight: 1.5 }}>
              💡 Sending from a phone adds a signature page at the end of the document for
              each signer. To place signatures on specific lines instead, tap <strong>✒ Fields</strong>
              — that works best on a desktop.
            </div>
          )}

          {/* 3 — the email they get */}
          <Section title="Add message" open={open === 'message'} onToggle={() => setOpen(o => o === 'message' ? null : 'message')}
            done={subject.trim() ? 'Ready' : undefined}>
            <label style={LBL}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} placeholder="Please sign: …" style={{ ...INP, marginBottom: 14 }} />
            <label style={LBL}>Message <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} placeholder="A note that goes in the email to every signer…" style={{ ...INP, resize: 'vertical' }} />
          </Section>

        </div>
      </div>
    </div>
    )}
    </>
  );
}
