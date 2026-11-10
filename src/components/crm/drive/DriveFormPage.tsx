'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { leaveDrivePage, announceDriveChanged } from './open-tab';
import { useCrmSession } from './useCrmSession';
import { StandaloneShell, PageMessage, Toast, useToast, useIsMobile, SignedOutBanner } from './StandalonePage';

const TransactionDocEditor = dynamic(() => import('../TransactionDocEditor'), { ssr: false });

/** A form saved in My Drive, in its own browser tab (/crm/form/<submission id>) — the same editor (with autosave) as in the CRM.
 *  Which form it is, what it is called and which workspace it belongs to come from the SAVED DOCUMENT, never from the link: the editor saves with
 *  those values, so a hand-edited link must not be able to retitle a document or file it under another form or workspace. (The link's ?bu= is only
 *  a hint for which workspace to sign in to; the server decides what the person may open.) */
export default function DriveFormPage({ submissionId }: { submissionId: string }) {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const bu: 'commercial' | 'residential' = q?.get('bu') === 'residential' ? 'residential' : 'commercial';
  const { state, token, isAdmin, signedOut } = useCrmSession(bu);
  const [meta, setMeta] = useState<{ formId: string; name: string; bu: 'commercial' | 'residential' } | null>(null);
  const formId = meta?.formId ?? '';
  const formName = meta?.name ?? q?.get('name') ?? 'Form';   // the link's name is shown only until the saved title arrives
  const [msg, toast] = useToast();
  const isMobile = useIsMobile();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const valid = /^[0-9a-f-]{36}$/i.test(submissionId);

  useEffect(() => { document.title = `${formName} — My Drive`; }, [formName]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') announceDriveChanged(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', announceDriveChanged);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', announceDriveChanged); };
  }, []);
  useEffect(() => { if (state === 'out') window.location.replace(`/crm/${bu}#transaction-docs`); }, [state, bu]);
  useEffect(() => {
    if (state !== 'ready' || !valid || url) return;
    let off = false;
    const h = token ? { Authorization: `Bearer ${token}` } : undefined;
    (async () => {
      try {
        const sr = await fetch(`/api/crm/form-submissions/${submissionId}`, { headers: h });
        const sj = await sr.json().catch(() => ({})) as { error?: string; submission?: { form_id?: string | null; title?: string | null; business_unit?: string | null; crm_forms?: { name?: string | null } | null } };
        if (off) return;
        const sub = sj.submission;
        if (!sr.ok || !sub) { setErr(sr.status === 404 ? 'That form was not found — it may have been deleted, or it is not one you can open.' : (sj.error || 'Could not open the form')); return; }
        if (!sub.form_id || !/^[0-9a-f-]{36}$/i.test(sub.form_id)) { setErr('This document is not a fillable form — open it from the E-Sign page or the deal it belongs to.'); return; }
        const m = { formId: sub.form_id, name: (sub.title || sub.crm_forms?.name || 'Form').slice(0, 200), bu: (sub.business_unit === 'residential' ? 'residential' : 'commercial') as 'commercial' | 'residential' };
        const ur = await fetch(`/api/crm/forms/${m.formId}/url`, { headers: h });
        const uj = await ur.json().catch(() => ({})) as { url?: string; error?: string };
        if (off) return;
        if (!ur.ok || !uj.url) { setErr(uj.error || 'Could not open the form'); return; }
        setMeta(m); setUrl(uj.url);
      } catch { if (!off) setErr('Could not open the form — check your connection'); }
    })();
    return () => { off = true; };
  }, [state, valid, url, submissionId, token]);

  const back = { label: 'Back to My Drive', onClick: () => leaveDrivePage(bu) };
  if (!valid) return <StandaloneShell><PageMessage action={back}>That is not a form link.</PageMessage></StandaloneShell>;
  if (err) return <StandaloneShell><PageMessage action={back}>{err}</PageMessage></StandaloneShell>;
  if (state !== 'ready' || !url) return <StandaloneShell><PageMessage>{state === 'out' ? 'Signing you in…' : 'Opening…'}</PageMessage></StandaloneShell>;

  return (
    <StandaloneShell>
      <SignedOutBanner show={signedOut} bu={meta?.bu ?? bu} />
      <TransactionDocEditor autoSave form={{ id: formId, name: formName }} url={url} authToken={token} isAdmin={isAdmin} businessUnit={meta?.bu ?? bu} submissionId={submissionId} isMobile={isMobile}
        onToast={toast} onClose={() => leaveDrivePage(bu)} onSaved={announceDriveChanged} />
      <Toast msg={msg} />
    </StandaloneShell>
  );
}
