'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { leaveDrivePage } from './open-tab';
import { useCrmSession } from './useCrmSession';
import { StandaloneShell, PageMessage, Toast, useToast } from './StandalonePage';

const TransactionDocEditor = dynamic(() => import('../TransactionDocEditor'), { ssr: false });

/** A form saved in My Drive, in its own browser tab (/crm/form/<submission id>?form=<form id>&name=…) — the same editor (with autosave) as in the CRM. */
export default function DriveFormPage({ submissionId }: { submissionId: string }) {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const bu: 'commercial' | 'residential' = q?.get('bu') === 'residential' ? 'residential' : 'commercial';
  const formId = q?.get('form') ?? '';
  const formName = q?.get('name') ?? 'Form';
  const { state, token, isAdmin } = useCrmSession(bu);
  const [msg, toast] = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const valid = /^[0-9a-f-]{36}$/i.test(submissionId) && /^[0-9a-f-]{36}$/i.test(formId);

  useEffect(() => { document.title = `${formName} — My Drive`; }, [formName]);
  useEffect(() => { if (state === 'out') window.location.replace(`/crm/${bu}#transaction-docs`); }, [state, bu]);
  useEffect(() => {
    if (state !== 'ready' || !valid || url) return;
    let off = false;
    fetch(`/api/crm/forms/${formId}/url`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async r => { const j = await r.json().catch(() => ({})); if (off) return; if (!r.ok || !j.url) setErr((j as { error?: string }).error || 'Could not open the form'); else setUrl(j.url as string); })
      .catch(() => { if (!off) setErr('Could not open the form — check your connection'); });
    return () => { off = true; };
  }, [state, valid, url, formId, token]);

  const back = { label: 'Back to My Drive', onClick: () => leaveDrivePage(bu) };
  if (!valid) return <StandaloneShell><PageMessage action={back}>That is not a form link.</PageMessage></StandaloneShell>;
  if (err) return <StandaloneShell><PageMessage action={back}>{err}</PageMessage></StandaloneShell>;
  if (state !== 'ready' || !url) return <StandaloneShell><PageMessage>{state === 'out' ? 'Signing you in…' : 'Opening…'}</PageMessage></StandaloneShell>;

  return (
    <StandaloneShell>
      <TransactionDocEditor autoSave form={{ id: formId, name: formName }} url={url} authToken={token} isAdmin={isAdmin} businessUnit={bu} submissionId={submissionId} isMobile={false}
        onToast={toast} onClose={() => leaveDrivePage(bu)} onSaved={() => {}} />
      <Toast msg={msg} />
    </StandaloneShell>
  );
}
